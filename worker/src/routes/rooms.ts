import { Hono } from "hono";
import type { Env } from "../types";
import type {
  CreateFolderRequest,
  CreateRoomRequest,
  CreateRoomResponse,
  DeleteRoomResponse,
  ExtendRoomResponse,
  RoomStateResponse,
} from "../../../shared/types";
import { LIMITS } from "../../../shared/types";
import { getConfig } from "../lib/config";
import { hashPin } from "../lib/pin";
import { generateFolderId, generateRoomId } from "../lib/ids";
import { validateFolderName } from "../lib/sanitize";
import { isValidTimeCode, friendlyRoomName } from "../lib/timeGate";
import {
  extendRoomExpiry,
  generateUniqueRoomCode,
  getRoomByCode,
  getRoomById,
  insertRoom,
  isRoomLive,
  toPublicRoom,
} from "../lib/roomsRepo";
import { deleteRoomData } from "../lib/roomCleanup";
import { listFilesForRoom, toPublicFile } from "../lib/filesRepo";
import {
  countFoldersForRoom,
  getFolderById,
  insertFolder,
  listFoldersForRoom,
  toPublicFolder,
} from "../lib/foldersRepo";
import { createSessionToken } from "../lib/session";
import { requireRoomSession } from "../lib/auth";
import { apiError } from "../lib/errors";
import { getAttemptRecord, recordFailedAttempt, clearAttempts, getClientKey } from "../lib/pinAttempts";

export const rooms = new Hono<{ Bindings: Env }>();

// There's no account system — the "gate" is a per-IP rate-limited riddle
// (see frontend Home page) instead of a login. This sentinel key lets us
// reuse the existing attempt-tracking table before any room exists yet.
const GATE_KEY = "__gate__";

// The lockout message deliberately overstates the wait ("1 hour") as a
// deterrent, while the real window (config.GATE_LOCKOUT_MS, ~1 minute) is
// short enough that a genuine user can just wait it out. retryAfterMs in
// the response body carries the real remaining time so the frontend can
// disable the form for exactly that long without repeating the lie.
const LOCKOUT_MESSAGE = "Too many incorrect attempts. Try again in 1 hour.";

rooms.post("/", async (c) => {
  const config = getConfig(c.env);
  const clientKey = getClientKey(c.req.raw);

  const record = await getAttemptRecord(c.env, GATE_KEY, clientKey);
  let attempts = record.attempts;

  if (attempts >= config.MAX_GATE_ATTEMPTS) {
    const elapsed = Date.now() - record.lastAttemptAt;
    if (elapsed < config.GATE_LOCKOUT_MS) {
      return apiError(c, "TOO_MANY_ATTEMPTS", LOCKOUT_MESSAGE, {
        retryAfterMs: config.GATE_LOCKOUT_MS - elapsed,
      });
    }
    // Real lockout window has passed — wipe the slate for a fresh set of tries.
    await clearAttempts(c.env, GATE_KEY, clientKey);
    attempts = 0;
  }

  let body: Partial<CreateRoomRequest>;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, "VALIDATION_ERROR", "Invalid request body.");
  }

  const code = (body.code ?? "").toString().trim();
  const now = Date.now();

  // The field is multi-purpose: the current clock time (4 digits) creates
  // a fresh room, while a 6-digit code copied from inside an existing
  // (still-live) room jumps straight back into it instead. Time codes are
  // checked first since they're the more time-sensitive interpretation —
  // the two never collide since isValidTimeCode only matches 4 digits.
  if (isValidTimeCode(code)) {
    await clearAttempts(c.env, GATE_KEY, clientKey);

    const expiresAt = now + LIMITS.ROOM_LIFETIME_MS;
    const id = generateRoomId();
    const roomName = friendlyRoomName(new Date(now));
    const roomCode = await generateUniqueRoomCode(c.env, now);
    // The code itself is no longer a credential once the room exists (guest
    // links carry their own signed session token) — hashed only to satisfy
    // the schema's NOT NULL column.
    const pinHash = await hashPin(code);

    await insertRoom(c.env, { id, roomName, roomCode, pinHash, createdAt: now, expiresAt });

    const room = {
      id,
      room_name: roomName,
      room_code: roomCode,
      pin_hash: pinHash,
      created_at: now,
      expires_at: expiresAt,
      status: "active" as const,
      storage_bytes_used: 0,
    };
    // Deliberately not tied to the room's expiry — see SESSION_TOKEN_LIFETIME_MS.
    const sessionToken = await createSessionToken(c.env.SESSION_SECRET, id, now + LIMITS.SESSION_TOKEN_LIFETIME_MS);

    const response: CreateRoomResponse = {
      room: toPublicRoom(room, now, config.MAX_ROOM_STORAGE),
      sessionToken,
    };
    return c.json(response, 201);
  }

  const existingRoom = await getRoomByCode(c.env, code, now);
  if (existingRoom) {
    await clearAttempts(c.env, GATE_KEY, clientKey);

    const sessionToken = await createSessionToken(
      c.env.SESSION_SECRET,
      existingRoom.id,
      now + LIMITS.SESSION_TOKEN_LIFETIME_MS
    );
    const response: CreateRoomResponse = {
      room: toPublicRoom(existingRoom, now, config.MAX_ROOM_STORAGE),
      sessionToken,
    };
    return c.json(response, 200);
  }

  await recordFailedAttempt(c.env, GATE_KEY, clientKey);
  const remaining = config.MAX_GATE_ATTEMPTS - (attempts + 1);
  if (remaining <= 0) {
    return apiError(c, "TOO_MANY_ATTEMPTS", LOCKOUT_MESSAGE, { retryAfterMs: config.GATE_LOCKOUT_MS });
  }
  return apiError(c, "INVALID_CODE", "Incorrect code.", { attemptsRemaining: remaining });
});

// Hidden extension: clicking the storage-used total 5 times pushes the
// room's deletion out by another ROOM_LIFETIME_MS. No UI hint that this
// exists — see StorageMeter.tsx on the frontend.
rooms.post("/:id/extend", async (c) => {
  const roomId = c.req.param("id");
  const room = await getRoomById(c.env, roomId);
  const now = Date.now();

  if (!room) return apiError(c, "ROOM_NOT_FOUND", "Room not found.");
  if (!isRoomLive(room, now)) {
    await deleteRoomData(c.env, roomId);
    return apiError(c, "ROOM_EXPIRED", "This storage room has expired.");
  }

  const authorized = await requireRoomSession(c, roomId);
  if (!authorized) return apiError(c, "UNAUTHORIZED", "A valid room session is required.");

  const expiresAt = await extendRoomExpiry(c.env, roomId, LIMITS.ROOM_LIFETIME_MS);
  const response: ExtendRoomResponse = { expiresAt };
  return c.json(response, 200);
});

// Immediate full deletion — used by the hidden "storage history" panel
// (10 clicks on the room name/date) to let the room's owner clean up a
// storage right away instead of waiting for it to expire on its own.
rooms.delete("/:id", async (c) => {
  const roomId = c.req.param("id");
  const room = await getRoomById(c.env, roomId);
  if (!room) return apiError(c, "ROOM_NOT_FOUND", "Room not found.");

  const authorized = await requireRoomSession(c, roomId);
  if (!authorized) return apiError(c, "UNAUTHORIZED", "A valid room session is required.");

  await deleteRoomData(c.env, roomId);
  const response: DeleteRoomResponse = { deleted: true };
  return c.json(response, 200);
});

rooms.get("/:id", async (c) => {
  const roomId = c.req.param("id");
  const room = await getRoomById(c.env, roomId);
  const now = Date.now();

  if (!room) return apiError(c, "ROOM_NOT_FOUND", "Room not found.");
  if (!isRoomLive(room, now)) {
    await deleteRoomData(c.env, roomId);
    return apiError(c, "ROOM_EXPIRED", "This storage room has expired.");
  }

  const authorized = await requireRoomSession(c, roomId);
  if (!authorized) return apiError(c, "UNAUTHORIZED", "A valid room session is required.");

  const config = getConfig(c.env);
  const [files, folders] = await Promise.all([
    listFilesForRoom(c.env, roomId),
    listFoldersForRoom(c.env, roomId),
  ]);
  const response: RoomStateResponse = {
    room: toPublicRoom(room, now, config.MAX_ROOM_STORAGE),
    files: files.map(toPublicFile),
    folders: folders.map(toPublicFolder),
  };
  return c.json(response, 200);
});

rooms.post("/:id/folders", async (c) => {
  const roomId = c.req.param("id");
  const room = await getRoomById(c.env, roomId);
  const now = Date.now();

  if (!room) return apiError(c, "ROOM_NOT_FOUND", "Room not found.");
  if (!isRoomLive(room, now)) {
    await deleteRoomData(c.env, roomId);
    return apiError(c, "ROOM_EXPIRED", "This storage room has expired.");
  }

  const authorized = await requireRoomSession(c, roomId);
  if (!authorized) return apiError(c, "UNAUTHORIZED", "A valid room session is required.");

  let body: Partial<CreateFolderRequest>;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, "VALIDATION_ERROR", "Invalid request body.");
  }

  const folderName = (body.folderName ?? "").toString().trim();
  const nameError = validateFolderName(folderName);
  if (nameError) return apiError(c, "INVALID_FOLDER_NAME", nameError);

  const parentFolderId = body.parentFolderId ?? null;
  if (parentFolderId) {
    const parent = await getFolderById(c.env, parentFolderId, roomId);
    if (!parent) return apiError(c, "FOLDER_NOT_FOUND", "Parent folder not found.");
  }

  const folderCount = await countFoldersForRoom(c.env, roomId);
  if (folderCount >= LIMITS.MAX_FOLDERS_PER_ROOM) {
    return apiError(c, "TOO_MANY_FOLDERS", `Rooms are limited to ${LIMITS.MAX_FOLDERS_PER_ROOM} folders.`);
  }

  const id = generateFolderId();
  await insertFolder(c.env, { id, roomId, parentFolderId, folderName, createdAt: now });

  return c.json(
    toPublicFolder({ id, room_id: roomId, parent_folder_id: parentFolderId, folder_name: folderName, created_at: now }),
    201
  );
});

// Lightweight near-real-time updates: the client opens this SSE stream and
// receives a fresh file list whenever it changes (poll-inside-stream on the
// server, so the client itself just listens — no client-side polling loop,
// no Durable Objects/WebSocket infra required).
rooms.get("/:id/events", async (c) => {
  const roomId = c.req.param("id");
  const room = await getRoomById(c.env, roomId);
  const now = Date.now();

  if (!room) return apiError(c, "ROOM_NOT_FOUND", "Room not found.");
  if (!isRoomLive(room, now)) {
    await deleteRoomData(c.env, roomId);
    return apiError(c, "ROOM_EXPIRED", "This storage room has expired.");
  }

  const authorized = await requireRoomSession(c, roomId);
  if (!authorized) return apiError(c, "UNAUTHORIZED", "A valid room session is required.");

  const env = c.env;
  const encoder = new TextEncoder();
  let lastSignature = "";

  const stream = new ReadableStream({
    async start(controller) {
      const POLL_INTERVAL_MS = 3000;
      const MAX_DURATION_MS = 5 * 60 * 1000; // client reconnects after this
      const startedAt = Date.now();

      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        while (Date.now() - startedAt < MAX_DURATION_MS) {
          const currentRoom = await getRoomById(env, roomId);
          if (!currentRoom || !isRoomLive(currentRoom, Date.now())) {
            if (currentRoom) await deleteRoomData(env, roomId);
            send("expired", {});
            break;
          }

          const [files, folders] = await Promise.all([
            listFilesForRoom(env, roomId),
            listFoldersForRoom(env, roomId),
          ]);
          const signature =
            files.map((f) => `${f.id}:${f.uploaded_at}`).join(",") +
            "|" +
            folders.map((f) => f.id).join(",");
          if (signature !== lastSignature) {
            lastSignature = signature;
            send("state", { files: files.map(toPublicFile), folders: folders.map(toPublicFolder) });
          } else {
            send("ping", {});
          }

          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});
