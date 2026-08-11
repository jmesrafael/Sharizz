import type { Env } from "../types";
import { deleteAllFoldersForRoom } from "../lib/foldersRepo";

// Runs hourly (see wrangler.toml [triggers]). Idempotent: safe to run
// repeatedly, tolerates R2 objects that are already missing, and only
// removes D1 rows after their corresponding R2 objects are handled.
export async function runCleanup(env: Env): Promise<{ roomsDeleted: number; filesDeleted: number }> {
  const now = Date.now();

  const { results: expiredRooms } = await env.DB.prepare(
    "SELECT id FROM rooms WHERE expires_at <= ?"
  )
    .bind(now)
    .all<{ id: string }>();

  let filesDeleted = 0;

  for (const room of expiredRooms) {
    const { results: roomFiles } = await env.DB.prepare(
      "SELECT id, storage_key FROM files WHERE room_id = ?"
    )
      .bind(room.id)
      .all<{ id: string; storage_key: string }>();

    for (const file of roomFiles) {
      try {
        await env.MEDIA_BUCKET.delete(file.storage_key);
      } catch {
        // Object already gone or transient R2 error — continue cleanup
        // rather than aborting the whole batch.
      }
    }

    await env.DB.prepare("DELETE FROM files WHERE room_id = ?").bind(room.id).run();
    await deleteAllFoldersForRoom(env, room.id);
    await env.DB.prepare("DELETE FROM pin_attempts WHERE room_id = ?").bind(room.id).run();
    await env.DB.prepare("DELETE FROM rooms WHERE id = ?").bind(room.id).run();

    filesDeleted += roomFiles.length;
  }

  return { roomsDeleted: expiredRooms.length, filesDeleted };
}
