import { Hono, type Context } from "hono";
import { downloadZip } from "client-zip";
import type { Env } from "../types";
import { getConfig } from "../lib/config";
import { getRoomById, isRoomLive, incrementRoomStorage } from "../lib/roomsRepo";
import {
  countFilesForRoom,
  getFileById,
  insertFile,
  listFilesForRoom,
} from "../lib/filesRepo";
import { requireRoomSession } from "../lib/auth";
import { apiError } from "../lib/errors";
import { generateFileId } from "../lib/ids";
import { buildStorageKey, sanitizeDisplayFilename } from "../lib/sanitize";
import { resolveMimeType } from "../lib/mime";

export const files = new Hono<{ Bindings: Env }>();

async function authorizeRoom(c: Context<{ Bindings: Env }>, roomId: string) {
  const room = await getRoomById(c.env, roomId);
  const now = Date.now();
  if (!room) return { error: apiError(c, "ROOM_NOT_FOUND", "Room not found.") };
  if (!isRoomLive(room, now)) return { error: apiError(c, "ROOM_EXPIRED", "This storage room has expired.") };

  const authorized = await requireRoomSession(c, roomId);
  if (!authorized) return { error: apiError(c, "UNAUTHORIZED", "A valid room session is required.") };

  return { room };
}

// Direct-to-R2 style upload: the browser streams the raw file body straight
// through to this endpoint, which pipes it into R2 without buffering it in
// memory. Metadata travels via query params (not multipart) so we never
// need to parse/buffer the body to read a filename.
files.put("/:id/files", async (c) => {
  const roomId = c.req.param("id");
  const auth = await authorizeRoom(c, roomId);
  if ("error" in auth) return auth.error;

  const config = getConfig(c.env);

  const rawName = c.req.query("name");
  const declaredType = c.req.query("type") ?? "";
  if (!rawName) return apiError(c, "VALIDATION_ERROR", "Missing file name.");

  const originalName = sanitizeDisplayFilename(decodeURIComponent(rawName));
  const mimeType = resolveMimeType(declaredType, originalName);
  if (!mimeType) return apiError(c, "INVALID_FILE_TYPE", "This file type is not supported.");

  const contentLength = Number(c.req.header("Content-Length") ?? "0");
  if (!contentLength || contentLength <= 0) {
    return apiError(c, "VALIDATION_ERROR", "Content-Length header is required.");
  }
  if (contentLength > config.MAX_FILE_SIZE) {
    return apiError(
      c,
      "FILE_TOO_LARGE",
      `Files must be ${Math.floor(config.MAX_FILE_SIZE / (1024 * 1024))} MB or smaller.`
    );
  }

  const fileCount = await countFilesForRoom(c.env, roomId);
  if (fileCount >= config.MAX_FILES_PER_ROOM) {
    return apiError(c, "TOO_MANY_FILES", `Rooms are limited to ${config.MAX_FILES_PER_ROOM} files.`);
  }

  if (auth.room.storage_bytes_used + contentLength > config.MAX_ROOM_STORAGE) {
    return apiError(
      c,
      "ROOM_STORAGE_LIMIT",
      `This room has reached its ${Math.floor(config.MAX_ROOM_STORAGE / (1024 * 1024 * 1024))} GB storage limit.`
    );
  }

  const body = c.req.raw.body;
  if (!body) return apiError(c, "VALIDATION_ERROR", "Request body is required.");

  const fileId = generateFileId();
  const storageKey = buildStorageKey(roomId, fileId, originalName);

  let stored;
  try {
    stored = await c.env.MEDIA_BUCKET.put(storageKey, body, {
      httpMetadata: { contentType: mimeType },
      customMetadata: { roomId, originalName },
    });
  } catch {
    return apiError(c, "STORAGE_UNAVAILABLE", "Upload failed. Please try again.");
  }

  if (!stored) return apiError(c, "STORAGE_UNAVAILABLE", "Upload failed. Please try again.");

  if (stored.size > config.MAX_FILE_SIZE) {
    await c.env.MEDIA_BUCKET.delete(storageKey);
    return apiError(
      c,
      "FILE_TOO_LARGE",
      `Files must be ${Math.floor(config.MAX_FILE_SIZE / (1024 * 1024))} MB or smaller.`
    );
  }

  const uploadedAt = Date.now();
  await insertFile(c.env, {
    id: fileId,
    roomId,
    originalName,
    storageKey,
    mimeType,
    fileSize: stored.size,
    uploadedAt,
  });
  await incrementRoomStorage(c.env, roomId, stored.size);

  return c.json(
    {
      id: fileId,
      roomId,
      originalName,
      mimeType,
      fileSize: stored.size,
      uploadedAt,
      width: null,
      height: null,
      duration: null,
    },
    201
  );
});

files.get("/:id/files/:fileId", async (c) => {
  const roomId = c.req.param("id");
  const fileId = c.req.param("fileId");
  const auth = await authorizeRoom(c, roomId);
  if ("error" in auth) return auth.error;

  const file = await getFileById(c.env, fileId, roomId);
  if (!file) return apiError(c, "FILE_NOT_FOUND", "File not found.");

  const object = await c.env.MEDIA_BUCKET.get(file.storage_key);
  if (!object) return apiError(c, "FILE_NOT_FOUND", "File not found.");

  const headers = new Headers();
  headers.set("Content-Type", file.mime_type);
  headers.set("Content-Length", String(file.file_size));
  headers.set(
    "Content-Disposition",
    `attachment; filename="${file.original_name.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(file.original_name)}`
  );
  headers.set("Cache-Control", "private, no-store");

  return new Response(object.body, { headers });
});

files.get("/:id/download-all", async (c) => {
  const roomId = c.req.param("id");
  const auth = await authorizeRoom(c, roomId);
  if ("error" in auth) return auth.error;

  const config = getConfig(c.env);
  const roomFiles = await listFilesForRoom(c.env, roomId);
  if (roomFiles.length === 0) return apiError(c, "FILE_NOT_FOUND", "This room has no files yet.");

  const totalBytes = roomFiles.reduce((sum, f) => sum + f.file_size, 0);
  if (totalBytes > config.DOWNLOAD_ALL_ZIP_MAX_BYTES) {
    return apiError(
      c,
      "ROOM_STORAGE_LIMIT",
      "This room is too large to zip. Please download files individually."
    );
  }

  const bucket = c.env.MEDIA_BUCKET;

  async function* entries() {
    for (const f of roomFiles) {
      const object = await bucket.get(f.storage_key);
      if (!object) continue; // skip missing objects rather than failing the whole zip
      yield {
        name: f.original_name,
        input: object.body,
        size: f.file_size,
        lastModified: new Date(f.uploaded_at),
      };
    }
  }

  const zipResponse = downloadZip(entries());
  const headers = new Headers(zipResponse.headers);
  headers.set("Content-Disposition", `attachment; filename="sharizz-files.zip"`);
  headers.set("Cache-Control", "private, no-store");

  return new Response(zipResponse.body, { headers, status: 200 });
});
