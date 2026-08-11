import { Hono, type Context } from "hono";
import { downloadZip } from "client-zip";
import { R2_FREE_TIER } from "../../../shared/types";
import type { Env } from "../types";
import { getConfig } from "../lib/config";
import { getRoomById, isRoomLive, incrementRoomStorage, setRoomStorage } from "../lib/roomsRepo";
import {
  countFilesForRoom,
  deleteAllFilesForRoom,
  deleteFilesByIds,
  getFileById,
  insertFile,
  listFilesByIds,
  listFilesForRoom,
} from "../lib/filesRepo";
import { getFolderById, deleteAllFoldersForRoom } from "../lib/foldersRepo";
import { requireRoomSession } from "../lib/auth";
import { apiError } from "../lib/errors";
import { generateFileId } from "../lib/ids";
import { buildStorageKey, sanitizeDisplayFilename } from "../lib/sanitize";
import { resolveMimeType } from "../lib/mime";
import { getUsageSnapshot, incrementClassAOps, incrementClassBOps } from "../lib/usageRepo";
import type { FileRow } from "../types";

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

  const folderId = c.req.query("folderId") || null;
  if (folderId) {
    const folder = await getFolderById(c.env, folderId, roomId);
    if (!folder) return apiError(c, "FOLDER_NOT_FOUND", "Folder not found.");
  }

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

  // Global stop-loss: refuse new uploads once total stored bytes (or this
  // month's op counts) would clear R2's free tier, so the app never
  // silently starts accruing storage/operation charges.
  const usage = await getUsageSnapshot(c.env);
  if (
    usage.storageBytes + contentLength > R2_FREE_TIER.STORAGE_BYTES ||
    usage.classAOps + 1 > R2_FREE_TIER.CLASS_A_OPS
  ) {
    return apiError(
      c,
      "GLOBAL_QUOTA_EXCEEDED",
      "This app has reached its free storage quota for the month. Please try again later."
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
    folderId,
    originalName,
    storageKey,
    mimeType,
    fileSize: stored.size,
    uploadedAt,
  });
  await incrementRoomStorage(c.env, roomId, stored.size);
  await incrementClassAOps(c.env);

  return c.json(
    {
      id: fileId,
      roomId,
      folderId,
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

  // Range support lets <video>/<img> tags preview large originals (seeking,
  // partial loads) without ever transcoding or resaving the file.
  const rangeHeader = c.req.header("Range");
  const range = parseRange(rangeHeader, file.file_size);

  const object = await c.env.MEDIA_BUCKET.get(file.storage_key, range ? { range } : undefined);
  if (!object) return apiError(c, "FILE_NOT_FOUND", "File not found.");
  await incrementClassBOps(c.env);

  const headers = new Headers();
  headers.set("Content-Type", file.mime_type);
  headers.set("Accept-Ranges", "bytes");
  headers.set(
    "Content-Disposition",
    `attachment; filename="${file.original_name.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(file.original_name)}`
  );
  headers.set("Cache-Control", "private, no-store");

  if (range) {
    const end = Math.min(range.offset + range.length - 1, file.file_size - 1);
    headers.set("Content-Range", `bytes ${range.offset}-${end}/${file.file_size}`);
    headers.set("Content-Length", String(end - range.offset + 1));
    return new Response(object.body, { headers, status: 206 });
  }

  headers.set("Content-Length", String(file.file_size));
  return new Response(object.body, { headers });
});

function parseRange(header: string | undefined, fileSize: number): { offset: number; length: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, startStr, endStr] = match;
  if (startStr === "" && endStr === "") return null;

  let start: number;
  let end: number;
  if (startStr === "") {
    const suffixLength = Number(endStr);
    start = Math.max(fileSize - suffixLength, 0);
    end = fileSize - 1;
  } else {
    start = Number(startStr);
    end = endStr === "" ? fileSize - 1 : Number(endStr);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= fileSize) {
    return null;
  }

  return { offset: start, length: Math.min(end, fileSize - 1) - start + 1 };
}

async function streamZip(
  c: Context<{ Bindings: Env }>,
  roomFiles: FileRow[],
  zipFilename: string
): Promise<Response> {
  const config = getConfig(c.env);
  if (roomFiles.length === 0) return apiError(c, "FILE_NOT_FOUND", "No files to download.");

  const totalBytes = roomFiles.reduce((sum, f) => sum + f.file_size, 0);
  if (totalBytes > config.DOWNLOAD_ALL_ZIP_MAX_BYTES) {
    return apiError(
      c,
      "ROOM_STORAGE_LIMIT",
      "This selection is too large to zip. Please download files individually."
    );
  }

  const bucket = c.env.MEDIA_BUCKET;

  async function* entries() {
    for (const f of roomFiles) {
      const object = await bucket.get(f.storage_key);
      if (!object) continue; // skip missing objects rather than failing the whole zip
      await incrementClassBOps(c.env);
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
  headers.set("Content-Disposition", `attachment; filename="${zipFilename}"`);
  headers.set("Cache-Control", "private, no-store");

  return new Response(zipResponse.body, { headers, status: 200 });
}

files.get("/:id/download-all", async (c) => {
  const roomId = c.req.param("id");
  const auth = await authorizeRoom(c, roomId);
  if ("error" in auth) return auth.error;

  const roomFiles = await listFilesForRoom(c.env, roomId);
  return streamZip(c, roomFiles, "sharizz-files.zip");
});

// Multi-select download: the client passes a comma-separated list of file
// IDs (GET, not POST, so plain <a href> links work without a form/fetch).
files.get("/:id/download-selected", async (c) => {
  const roomId = c.req.param("id");
  const auth = await authorizeRoom(c, roomId);
  if ("error" in auth) return auth.error;

  const idsParam = c.req.query("fileIds") ?? "";
  const fileIds = idsParam
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (fileIds.length === 0) return apiError(c, "VALIDATION_ERROR", "No files selected.");

  const selectedFiles = await listFilesByIds(c.env, roomId, fileIds);
  return streamZip(c, selectedFiles, "sharizz-selected-files.zip");
});

// Bulk delete: removes the given files from R2 and the DB and frees their
// bytes from the room's storage quota. Used for "delete selected" after a
// bulk download, so a room doesn't have to sit on files the recipient
// already saved locally.
files.delete("/:id/files", async (c) => {
  const roomId = c.req.param("id");
  const auth = await authorizeRoom(c, roomId);
  if ("error" in auth) return auth.error;

  let body: { fileIds?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, "VALIDATION_ERROR", "Invalid request body.");
  }

  const fileIds = Array.isArray(body.fileIds) ? body.fileIds.filter((id): id is string => typeof id === "string") : [];
  if (fileIds.length === 0) return apiError(c, "VALIDATION_ERROR", "No files selected.");

  const deleted = await deleteFilesByIds(c.env, roomId, fileIds);
  if (deleted.length === 0) return apiError(c, "FILE_NOT_FOUND", "File not found.");

  await Promise.all(deleted.map((f) => c.env.MEDIA_BUCKET.delete(f.storage_key)));
  const freedBytes = deleted.reduce((sum, f) => sum + f.file_size, 0);
  await incrementRoomStorage(c.env, roomId, -freedBytes);

  return c.json({ deletedIds: deleted.map((f) => f.id), freedBytes }, 200);
});

// Clear storage: wipes every file and folder in the room, freeing the full
// quota. Distinct from letting the room expire — this is an explicit,
// irreversible action the room owner takes (e.g. right after downloading
// everything) rather than waiting out the room's lifetime.
files.delete("/:id/clear", async (c) => {
  const roomId = c.req.param("id");
  const auth = await authorizeRoom(c, roomId);
  if ("error" in auth) return auth.error;

  const allFiles = await deleteAllFilesForRoom(c.env, roomId);
  await Promise.all(allFiles.map((f) => c.env.MEDIA_BUCKET.delete(f.storage_key)));
  await deleteAllFoldersForRoom(c.env, roomId);
  await setRoomStorage(c.env, roomId, 0);

  return c.json({ deletedCount: allFiles.length }, 200);
});
