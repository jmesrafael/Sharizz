import { Hono } from "hono";
import type { Env } from "../types";
import type {
  CreateRoomRequest,
  CreateRoomResponse,
  EnterRoomRequest,
  EnterRoomResponse,
  RoomStateResponse,
} from "../../../shared/types";
import { LIMITS } from "../../../shared/types";
import { getConfig } from "../lib/config";
import { hashPin, verifyPin } from "../lib/pin";
import { generateRoomId } from "../lib/ids";
import { validateRoomName, validatePin } from "../lib/sanitize";
import { getRoomById, insertRoom, isRoomLive, toPublicRoom } from "../lib/roomsRepo";
import { listFilesForRoom, toPublicFile } from "../lib/filesRepo";
import { createSessionToken } from "../lib/session";
import { requireRoomSession } from "../lib/auth";
import { apiError } from "../lib/errors";
import { getAttemptCount, recordFailedAttempt, clearAttempts, getClientKey } from "../lib/pinAttempts";

export const rooms = new Hono<{ Bindings: Env }>();

// Resolves a human-friendly room name to its most recently created active
// room ID. Names are not unique and are never treated as a credential —
// the PIN is still required on /enter. Returns only the ID, nothing else.
rooms.get("/lookup", async (c) => {
  const name = c.req.query("name")?.trim();
  if (!name) return apiError(c, "VALIDATION_ERROR", "Missing room name.");

  const now = Date.now();
  const row = await c.env.DB.prepare(
    "SELECT id FROM rooms WHERE room_name = ? AND status = 'active' AND expires_at > ? ORDER BY created_at DESC LIMIT 1"
  )
    .bind(name, now)
    .first<{ id: string }>();

  if (!row) return apiError(c, "ROOM_NOT_FOUND", "Room not found.");
  return c.json({ id: row.id }, 200);
});

rooms.post("/", async (c) => {
  const config = getConfig(c.env);
  let body: Partial<CreateRoomRequest>;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, "VALIDATION_ERROR", "Invalid request body.");
  }

  const roomName = (body.roomName ?? "").toString().trim();
  const pin = (body.pin ?? "").toString();

  const nameError = validateRoomName(roomName, config.MAX_ROOM_NAME_LENGTH);
  if (nameError) return apiError(c, "INVALID_ROOM_NAME", nameError);

  const pinError = validatePin(pin);
  if (pinError) return apiError(c, "INVALID_PIN_FORMAT", pinError);

  const now = Date.now();
  const expiresAt = now + LIMITS.ROOM_LIFETIME_MS;
  const id = generateRoomId();
  const pinHash = await hashPin(pin);

  await insertRoom(c.env, { id, roomName, pinHash, createdAt: now, expiresAt });

  const room = { id, room_name: roomName, pin_hash: pinHash, created_at: now, expires_at: expiresAt, status: "active" as const, storage_bytes_used: 0 };
  const sessionToken = await createSessionToken(c.env.SESSION_SECRET, id, expiresAt);

  const response: CreateRoomResponse = { room: toPublicRoom(room, now), sessionToken };
  return c.json(response, 201);
});

rooms.post("/:id/enter", async (c) => {
  const roomId = c.req.param("id");
  const room = await getRoomById(c.env, roomId);
  const now = Date.now();

  if (!room) return apiError(c, "ROOM_NOT_FOUND", "Room not found.");
  if (!isRoomLive(room, now)) return apiError(c, "ROOM_EXPIRED", "This storage room has expired.");

  const config = getConfig(c.env);
  const clientKey = getClientKey(c.req.raw);
  const attempts = await getAttemptCount(c.env, roomId, clientKey);
  if (attempts >= config.MAX_PIN_ATTEMPTS) {
    return apiError(c, "TOO_MANY_ATTEMPTS", "Too many incorrect attempts. Try again later.");
  }

  let body: Partial<EnterRoomRequest>;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, "VALIDATION_ERROR", "Invalid request body.");
  }
  const pin = (body.pin ?? "").toString();

  const ok = await verifyPin(pin, room.pin_hash);
  if (!ok) {
    await recordFailedAttempt(c.env, roomId, clientKey);
    return apiError(c, "INVALID_PIN", "Incorrect PIN.");
  }

  await clearAttempts(c.env, roomId, clientKey);
  const sessionToken = await createSessionToken(c.env.SESSION_SECRET, roomId, room.expires_at);
  const response: EnterRoomResponse = { room: toPublicRoom(room, now), sessionToken };
  return c.json(response, 200);
});

rooms.get("/:id", async (c) => {
  const roomId = c.req.param("id");
  const room = await getRoomById(c.env, roomId);
  const now = Date.now();

  if (!room) return apiError(c, "ROOM_NOT_FOUND", "Room not found.");
  if (!isRoomLive(room, now)) return apiError(c, "ROOM_EXPIRED", "This storage room has expired.");

  const authorized = await requireRoomSession(c, roomId);
  if (!authorized) return apiError(c, "UNAUTHORIZED", "A valid room session is required.");

  const files = await listFilesForRoom(c.env, roomId);
  const response: RoomStateResponse = {
    room: toPublicRoom(room, now),
    files: files.map(toPublicFile),
  };
  return c.json(response, 200);
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
  if (!isRoomLive(room, now)) return apiError(c, "ROOM_EXPIRED", "This storage room has expired.");

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
            send("expired", {});
            break;
          }

          const files = await listFilesForRoom(env, roomId);
          const signature = files.map((f) => `${f.id}:${f.uploaded_at}`).join(",");
          if (signature !== lastSignature) {
            lastSignature = signature;
            send("files", files.map(toPublicFile));
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
