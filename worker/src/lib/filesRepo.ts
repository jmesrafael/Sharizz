import type { Env, FileRow } from "../types";
import type { FilePublic } from "../../../shared/types";

export function toPublicFile(file: FileRow): FilePublic {
  return {
    id: file.id,
    roomId: file.room_id,
    folderId: file.folder_id,
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

export async function listFilesByIds(env: Env, roomId: string, fileIds: string[]): Promise<FileRow[]> {
  if (fileIds.length === 0) return [];
  const placeholders = fileIds.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    `SELECT * FROM files WHERE room_id = ? AND id IN (${placeholders})`
  )
    .bind(roomId, ...fileIds)
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

export async function deleteFilesByIds(env: Env, roomId: string, fileIds: string[]): Promise<FileRow[]> {
  if (fileIds.length === 0) return [];
  const rows = await listFilesByIds(env, roomId, fileIds);
  if (rows.length === 0) return [];

  const placeholders = rows.map(() => "?").join(",");
  await env.DB.prepare(`DELETE FROM files WHERE room_id = ? AND id IN (${placeholders})`)
    .bind(roomId, ...rows.map((r) => r.id))
    .run();
  return rows;
}

export async function deleteAllFilesForRoom(env: Env, roomId: string): Promise<FileRow[]> {
  const rows = await listFilesForRoom(env, roomId);
  if (rows.length === 0) return [];

  await env.DB.prepare("DELETE FROM files WHERE room_id = ?").bind(roomId).run();
  return rows;
}

export async function insertFile(
  env: Env,
  params: {
    id: string;
    roomId: string;
    folderId: string | null;
    originalName: string;
    storageKey: string;
    mimeType: string;
    fileSize: number;
    uploadedAt: number;
  }
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO files (id, room_id, folder_id, original_name, storage_key, mime_type, file_size, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      params.id,
      params.roomId,
      params.folderId,
      params.originalName,
      params.storageKey,
      params.mimeType,
      params.fileSize,
      params.uploadedAt
    )
    .run();
}
