import type { Env } from "../types";
import { deleteAllFoldersForRoom } from "./foldersRepo";

// Deletes one room's R2 objects (originals + thumbnails) and D1 rows.
// Shared by the hourly cron sweep and by routes that lazily reap a room the
// moment anyone touches it past expiry — idempotent, tolerates R2 objects
// that are already gone.
export async function deleteRoomData(env: Env, roomId: string): Promise<number> {
  const { results: roomFiles } = await env.DB.prepare(
    "SELECT id, storage_key, thumbnail_key FROM files WHERE room_id = ?"
  )
    .bind(roomId)
    .all<{ id: string; storage_key: string; thumbnail_key: string | null }>();

  await Promise.all(
    roomFiles.flatMap((file) => {
      const keys = [file.storage_key, ...(file.thumbnail_key ? [file.thumbnail_key] : [])];
      return keys.map((key) => env.MEDIA_BUCKET.delete(key).catch(() => {}));
    })
  );

  await env.DB.prepare("DELETE FROM files WHERE room_id = ?").bind(roomId).run();
  await deleteAllFoldersForRoom(env, roomId);
  await env.DB.prepare("DELETE FROM pin_attempts WHERE room_id = ?").bind(roomId).run();
  await env.DB.prepare("DELETE FROM rooms WHERE id = ?").bind(roomId).run();

  return roomFiles.length;
}
