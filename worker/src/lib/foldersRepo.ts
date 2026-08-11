import type { Env, FolderRow } from "../types";
import type { FolderPublic } from "../../../shared/types";

export function toPublicFolder(folder: FolderRow): FolderPublic {
  return {
    id: folder.id,
    roomId: folder.room_id,
    parentFolderId: folder.parent_folder_id,
    folderName: folder.folder_name,
    createdAt: folder.created_at,
  };
}

export async function listFoldersForRoom(env: Env, roomId: string): Promise<FolderRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM folders WHERE room_id = ? ORDER BY created_at ASC"
  )
    .bind(roomId)
    .all<FolderRow>();
  return results;
}

export async function countFoldersForRoom(env: Env, roomId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) as n FROM folders WHERE room_id = ?")
    .bind(roomId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function getFolderById(env: Env, folderId: string, roomId: string): Promise<FolderRow | null> {
  const row = await env.DB.prepare("SELECT * FROM folders WHERE id = ? AND room_id = ?")
    .bind(folderId, roomId)
    .first<FolderRow>();
  return row ?? null;
}

export async function deleteAllFoldersForRoom(env: Env, roomId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM folders WHERE room_id = ?").bind(roomId).run();
}

export async function insertFolder(
  env: Env,
  params: { id: string; roomId: string; parentFolderId: string | null; folderName: string; createdAt: number }
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO folders (id, room_id, parent_folder_id, folder_name, created_at)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(params.id, params.roomId, params.parentFolderId, params.folderName, params.createdAt)
    .run();
}
