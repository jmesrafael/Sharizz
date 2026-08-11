import type { Env } from "../types";
import { deleteRoomData } from "../lib/roomCleanup";

// Runs hourly (see wrangler.toml [triggers]) as a backstop for rooms nobody
// ever revisits after expiry — rooms that ARE touched past expiry get
// reaped immediately by the lazy checks in routes/rooms.ts and
// routes/files.ts instead of waiting for this sweep.
export async function runCleanup(env: Env): Promise<{ roomsDeleted: number; filesDeleted: number }> {
  const now = Date.now();

  const { results: expiredRooms } = await env.DB.prepare(
    "SELECT id FROM rooms WHERE expires_at <= ?"
  )
    .bind(now)
    .all<{ id: string }>();

  let filesDeleted = 0;
  for (const room of expiredRooms) {
    filesDeleted += await deleteRoomData(env, room.id);
  }

  return { roomsDeleted: expiredRooms.length, filesDeleted };
}
