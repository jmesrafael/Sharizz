import type { Env, FileRow } from "../types";
import type { FilePublic } from "../../../shared/types";

export function toPublicFile(file: FileRow): FilePublic {
  return {
    id: file.id,
    roomId: file.room_id,
    originalName: file.original_name,
    mimeType: file.mime_type,
    fileSize: file.file_size,
    uploadedAt: file.uploaded_at,
    width: file.width,
    height: file.height,
    duration: file.duration,
  };
}

export async function listFilesForRoom(env: Env, roomId: string): Promise<FileRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM files WHERE room_id = ? ORDER BY uploaded_at ASC"
  )
    .bind(roomId)
    .all<FileRow>();
  return results;
}

export async function countFilesForRoom(env: Env, roomId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) as n FROM files WHERE room_id = ?")
    .bind(roomId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function getFileById(env: Env, fileId: string, roomId: string): Promise<FileRow | null> {
  const row = await env.DB.prepare("SELECT * FROM files WHERE id = ? AND room_id = ?")
    .bind(fileId, roomId)
    .first<FileRow>();
  return row ?? null;
}

export async function insertFile(
  env: Env,
  params: {
    id: string;
    roomId: string;
    originalName: string;
    storageKey: string;
    mimeType: string;
    fileSize: number;
    uploadedAt: number;
  }
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO files (id, room_id, original_name, storage_key, mime_type, file_size, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      params.id,
      params.roomId,
      params.originalName,
      params.storageKey,
      params.mimeType,
      params.fileSize,
      params.uploadedAt
    )
    .run();
}
