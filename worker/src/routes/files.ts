import { Hono, type Context } from "hono";
import { downloadZip } from "client-zip";
import { R2_FREE_TIER } from "../../../shared/types";
import type { Env, RoomRow } from "../types";
import { getConfig } from "../lib/config";
import { getRoomById, isRoomLive, incrementRoomStorage, setRoomStorage } from "../lib/roomsRepo";
import { deleteRoomData } from "../lib/roomCleanup";
import {
  countFilesForRoom,
  deleteAllFilesForRoom,
  deleteFilesByIds,
  getFileById,
  insertFile,
  listFilesByIds,
  listFilesForRoom,
  setFileThumbnail,
} from "../lib/filesRepo";
import { getFolderById, deleteAllFoldersForRoom } from "../lib/foldersRepo";
import { requireRoomSession } from "../lib/auth";
import { apiError } from "../lib/errors";
import { generateFileId } from "../lib/ids";
import { buildStorageKey, buildThumbnailKey, sanitizeDisplayFilename } from "../lib/sanitize";
import { resolveMimeType } from "../lib/mime";
import { getUsageSnapshot, incrementClassAOps, incrementClassBOps } from "../lib/usageRepo";
import type { FileRow } from "../types";

export const files = new Hono<{ Bindings: Env }>();

// Generous cap for a downscaled JPEG preview — the client targets a ~480px
// max dimension, so a legitimate thumbnail is well under this; it exists
// only to stop the endpoint being used to smuggle in arbitrary blobs.
const THUMBNAIL_MAX_BYTES = 1024 * 1024;

async function authorizeRoom(c: Context<{ Bindings: Env }>, roomId: string) {
  const room = await getRoomById(c.env, roomId);
  const now = Date.now();
  if (!room) return { error: apiError(c, "ROOM_NOT_FOUND", "Room not found.") };
  if (!isRoomLive(room, now)) {
    await deleteRoomData(c.env, roomId);
    return { error: apiError(c, "ROOM_EXPIRED", "This storage room has expired.") };
  }

  const authorized = await requireRoomSession(c, roomId);
  if (!authorized) return { error: apiError(c, "UNAUTHORIZED", "A valid room session is required.") };

  return { room };
}

interface UploadValidation {
  originalName: string;
  mimeType: string;
  folderId: string | null;
}

// Shared by the direct single-shot PUT and the multipart init route so both
// paths enforce the same name/type/quota rules against the same declared size.
async function validateUpload(
  c: Context<{ Bindings: Env }>,
  roomId: string,
  room: RoomRow,
  rawName: string | undefined,
  declaredType: string,
  folderIdParam: string | null,
  size: number
): Promise<{ ok: true; data: UploadValidation } | { ok: false; error: Response }> {
  const config = getConfig(c.env);

  if (!rawName) return { ok: false, error: apiError(c, "VALIDATION_ERROR", "Missing file name.") };
  const originalName = sanitizeDisplayFilename(rawName);
  const mimeType = resolveMimeType(declaredType, originalName);
  if (!mimeType) return { ok: false, error: apiError(c, "INVALID_FILE_TYPE", "This file type is not supported.") };

  const folderId = folderIdParam || null;
  if (folderId) {
    const folder = await getFolderById(c.env, folderId, roomId);
    if (!folder) return { ok: false, error: apiError(c, "FOLDER_NOT_FOUND", "Folder not found.") };
  }

  if (!size || size <= 0) {
    return { ok: false, error: apiError(c, "VALIDATION_ERROR", "A valid file size is required.") };
  }
  if (size > config.MAX_FILE_SIZE) {
    return {
      ok: false,
      error: apiError(
        c,
        "FILE_TOO_LARGE",
        `Files must be ${Math.floor(config.MAX_FILE_SIZE / (1024 * 1024))} MB or smaller.`
      ),
    };
  }

  const fileCount = await countFilesForRoom(c.env, roomId);
  if (fileCount >= config.MAX_FILES_PER_ROOM) {
    return {
      ok: false,
      error: apiError(c, "TOO_MANY_FILES", `Rooms are limited to ${config.MAX_FILES_PER_ROOM} files.`),
    };
  }

  if (room.storage_bytes_used + size > config.MAX_ROOM_STORAGE) {
    return {
      ok: false,
      error: apiError(
        c,
        "ROOM_STORAGE_LIMIT",
        `This room has reached its ${Math.floor(config.MAX_ROOM_STORAGE / (1024 * 1024 * 1024))} GB storage limit.`
      ),
    };
  }

  const usage = await getUsageSnapshot(c.env);
  if (usage.storageBytes + size > R2_FREE_TIER.STORAGE_BYTES || usage.classAOps + 1 > R2_FREE_TIER.CLASS_A_OPS) {
    return {
      ok: false,
      error: apiError(
        c,
        "GLOBAL_QUOTA_EXCEEDED",
        "This app has reached its free storage quota for the month. Please try again later."
      ),
    };
  }

  return { ok: true, data: { originalName, mimeType, folderId } };
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
  const contentLength = Number(c.req.header("Content-Length") ?? "0");

  const validation = await validateUpload(
    c,
    roomId,
    auth.room,
    rawName ? decodeURIComponent(rawName) : undefined,
    declaredType,
    c.req.query("folderId") || null,
    contentLength
  );
  if (!validation.ok) return validation.error;
  const { originalName, mimeType, folderId } = validation.data;

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
      hasThumbnail: false,
    },
    201
  );
});

// Resumable upload flow (for large files): init creates the R2 multipart
// upload and returns the key/uploadId the client needs for every subsequent
// call. Nothing is written to the DB until complete() succeeds, so a
// half-finished upload never shows up as a file.
files.post("/:id/uploads", async (c) => {
  const roomId = c.req.param("id");
  const auth = await authorizeRoom(c, roomId);
  if ("error" in auth) return auth.error;

  let body: { name?: unknown; type?: unknown; size?: unknown; folderId?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, "VALIDATION_ERROR", "Invalid request body.");
  }

  const rawName = typeof body.name === "string" ? body.name : undefined;
  const declaredType = typeof body.type === "string" ? body.type : "";
  const size = typeof body.size === "number" ? body.size : 0;
  const folderId = typeof body.folderId === "string" ? body.folderId : null;

  const validation = await validateUpload(c, roomId, auth.room, rawName, declaredType, folderId, size);
  if (!validation.ok) return validation.error;
  const { originalName, mimeType, folderId: validFolderId } = validation.data;

  const fileId = generateFileId();
  const storageKey = buildStorageKey(roomId, fileId, originalName);

  let upload;
  try {
    upload = await c.env.MEDIA_BUCKET.createMultipartUpload(storageKey, {
      httpMetadata: { contentType: mimeType },
      customMetadata: { roomId, originalName },
    });
  } catch {
    return apiError(c, "STORAGE_UNAVAILABLE", "Couldn't start this upload. Please try again.");
  }

  await incrementClassAOps(c.env);

  return c.json(
    {
      fileId,
      key: storageKey,
      uploadId: upload.uploadId,
      originalName,
      mimeType,
      folderId: validFolderId,
    },
    201
  );
});

// Each chunk is a separate request, so a dropped connection only costs the
// in-flight part — the client retries just that part, or resumes later,
// instead of re-uploading the whole file.
files.put("/:id/uploads/:uploadId/parts/:partNumber", async (c) => {
  const roomId = c.req.param("id");
  const auth = await authorizeRoom(c, roomId);
  if ("error" in auth) return auth.error;

  const uploadId = c.req.param("uploadId");
  const partNumber = Number(c.req.param("partNumber"));
  const key = c.req.query("key");
  if (!key || !key.startsWith(`rooms/${roomId}/`)) return apiError(c, "VALIDATION_ERROR", "Invalid upload key.");
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) {
    return apiError(c, "VALIDATION_ERROR", "Invalid part number.");
  }

  const body = c.req.raw.body;
  if (!body) return apiError(c, "VALIDATION_ERROR", "Request body is required.");

  try {
    const multipartUpload = c.env.MEDIA_BUCKET.resumeMultipartUpload(key, uploadId);
    const part = await multipartUpload.uploadPart(partNumber, body);
    await incrementClassAOps(c.env);
    return c.json({ partNumber, etag: part.etag }, 200);
  } catch {
    return apiError(c, "STORAGE_UNAVAILABLE", "This chunk failed to upload. Please retry.");
  }
});

files.post("/:id/uploads/:uploadId/complete", async (c) => {
  const roomId = c.req.param("id");
  const auth = await authorizeRoom(c, roomId);
  if ("error" in auth) return auth.error;

  const uploadId = c.req.param("uploadId");

  let body: {
    key?: unknown;
    fileId?: unknown;
    originalName?: unknown;
    mimeType?: unknown;
    folderId?: unknown;
    parts?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, "VALIDATION_ERROR", "Invalid request body.");
  }

  const key = typeof body.key === "string" ? body.key : "";
  const fileId = typeof body.fileId === "string" ? body.fileId : "";
  const originalName = typeof body.originalName === "string" ? body.originalName : "";
  const mimeType = typeof body.mimeType === "string" ? body.mimeType : "";
  const folderId = typeof body.folderId === "string" ? body.folderId : null;
  const rawParts = Array.isArray(body.parts) ? body.parts : [];

  if (!key.startsWith(`rooms/${roomId}/`) || !fileId || !originalName || !mimeType || rawParts.length === 0) {
    return apiError(c, "VALIDATION_ERROR", "Invalid completion payload.");
  }

  const parts = rawParts.filter(
    (p): p is { partNumber: number; etag: string } =>
      typeof p === "object" &&
      p !== null &&
      typeof (p as Record<string, unknown>).partNumber === "number" &&
      typeof (p as Record<string, unknown>).etag === "string"
  );
  if (parts.length !== rawParts.length) return apiError(c, "VALIDATION_ERROR", "Invalid parts list.");
  parts.sort((a, b) => a.partNumber - b.partNumber);

  const config = getConfig(c.env);
  let object;
  try {
    const multipartUpload = c.env.MEDIA_BUCKET.resumeMultipartUpload(key, uploadId);
    object = await multipartUpload.complete(parts);
  } catch {
    return apiError(c, "STORAGE_UNAVAILABLE", "Couldn't finish this upload. Please retry.");
  }

  if (object.size > config.MAX_FILE_SIZE) {
    await c.env.MEDIA_BUCKET.delete(key);
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
    storageKey: key,
    mimeType,
    fileSize: object.size,
    uploadedAt,
  });
  await incrementRoomStorage(c.env, roomId, object.size);

  return c.json(
    {
      id: fileId,
      roomId,
      folderId,
      originalName,
      mimeType,
      fileSize: object.size,
      uploadedAt,
      width: null,
      height: null,
      duration: null,
      hasThumbnail: false,
    },
    201
  );
});

// Best-effort cleanup when a resumable upload is abandoned (e.g. the user
// removes the item instead of retrying) — frees the parts R2 is holding.
files.delete("/:id/uploads/:uploadId", async (c) => {
  const roomId = c.req.param("id");
  const auth = await authorizeRoom(c, roomId);
  if ("error" in auth) return auth.error;

  const uploadId = c.req.param("uploadId");
  const key = c.req.query("key");
  if (!key || !key.startsWith(`rooms/${roomId}/`)) return apiError(c, "VALIDATION_ERROR", "Invalid upload key.");

  try {
    const multipartUpload = c.env.MEDIA_BUCKET.resumeMultipartUpload(key, uploadId);
    await multipartUpload.abort();
  } catch {
    // Already completed/aborted/expired — nothing left to clean up.
  }

  return c.json({ aborted: true }, 200);
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

// Accepts a small WebP (or JPEG, if the browser couldn't encode WebP)
// derivative generated client-side (see frontend/src/lib/imagePreview.ts) —
// either because the format needs it to be viewable at all (HEIC/HEIF), or
// just to keep the grid fast for an otherwise-large photo. Purely additive —
// the original object this file's storage_key points to is never read or
// modified here, so downloads always stay byte-for-byte regardless of
// whether a thumbnail exists.
const ALLOWED_THUMBNAIL_MIME_TYPES = new Set(["image/webp", "image/jpeg"]);

files.put("/:id/files/:fileId/thumbnail", async (c) => {
  const roomId = c.req.param("id");
  const fileId = c.req.param("fileId");
  const auth = await authorizeRoom(c, roomId);
  if ("error" in auth) return auth.error;

  const file = await getFileById(c.env, fileId, roomId);
  if (!file) return apiError(c, "FILE_NOT_FOUND", "File not found.");

  const contentType = c.req.header("Content-Type") ?? "";
  if (!ALLOWED_THUMBNAIL_MIME_TYPES.has(contentType)) {
    return apiError(c, "INVALID_FILE_TYPE", "Thumbnail must be image/webp or image/jpeg.");
  }

  const contentLength = Number(c.req.header("Content-Length") ?? "0");
  if (!contentLength || contentLength <= 0) {
    return apiError(c, "VALIDATION_ERROR", "Content-Length header is required.");
  }
  if (contentLength > THUMBNAIL_MAX_BYTES) {
    return apiError(c, "FILE_TOO_LARGE", "Thumbnail is too large.");
  }

  const body = c.req.raw.body;
  if (!body) return apiError(c, "VALIDATION_ERROR", "Request body is required.");

  const thumbnailKey = buildThumbnailKey(roomId, fileId);

  let stored;
  try {
    stored = await c.env.MEDIA_BUCKET.put(thumbnailKey, body, {
      httpMetadata: { contentType },
      customMetadata: { roomId, fileId },
    });
  } catch {
    return apiError(c, "STORAGE_UNAVAILABLE", "Couldn't save the thumbnail.");
  }
  if (!stored) return apiError(c, "STORAGE_UNAVAILABLE", "Couldn't save the thumbnail.");

  if (stored.size > THUMBNAIL_MAX_BYTES) {
    await c.env.MEDIA_BUCKET.delete(thumbnailKey);
    return apiError(c, "FILE_TOO_LARGE", "Thumbnail is too large.");
  }

  // Replacing an existing thumbnail (retry) — free the old bytes before
  // counting the new ones so room storage doesn't drift upward.
  const previousSize = file.thumbnail_size ?? 0;
  await setFileThumbnail(c.env, fileId, roomId, thumbnailKey, stored.size, contentType);
  await incrementRoomStorage(c.env, roomId, stored.size - previousSize);
  await incrementClassAOps(c.env);

  return c.json({ hasThumbnail: true }, 200);
});

files.get("/:id/files/:fileId/thumbnail", async (c) => {
  const roomId = c.req.param("id");
  const fileId = c.req.param("fileId");
  const auth = await authorizeRoom(c, roomId);
  if ("error" in auth) return auth.error;

  const file = await getFileById(c.env, fileId, roomId);
  if (!file || !file.thumbnail_key) return apiError(c, "FILE_NOT_FOUND", "No thumbnail for this file.");

  const object = await c.env.MEDIA_BUCKET.get(file.thumbnail_key);
  if (!object) return apiError(c, "FILE_NOT_FOUND", "No thumbnail for this file.");
  await incrementClassBOps(c.env);

  const headers = new Headers();
  // Rows written before thumbnail_mime_type existed were always JPEG.
  headers.set("Content-Type", file.thumbnail_mime_type ?? "image/jpeg");
  headers.set("Cache-Control", "private, no-store");
  headers.set("Content-Length", String(file.thumbnail_size ?? 0));
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

  await Promise.all(
    deleted.flatMap((f) => [
      c.env.MEDIA_BUCKET.delete(f.storage_key),
      ...(f.thumbnail_key ? [c.env.MEDIA_BUCKET.delete(f.thumbnail_key)] : []),
    ])
  );
  const freedBytes = deleted.reduce((sum, f) => sum + f.file_size + (f.thumbnail_size ?? 0), 0);
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
  await Promise.all(
    allFiles.flatMap((f) => [
      c.env.MEDIA_BUCKET.delete(f.storage_key),
      ...(f.thumbnail_key ? [c.env.MEDIA_BUCKET.delete(f.thumbnail_key)] : []),
    ])
  );
  await deleteAllFoldersForRoom(c.env, roomId);
  await setRoomStorage(c.env, roomId, 0);

  return c.json({ deletedCount: allFiles.length }, 200);
});
