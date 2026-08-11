import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { runCleanup } from "../src/cron/cleanup";
import { hashPin } from "../src/lib/pin";

async function insertExpiredRoomWithFile(roomId: string, storageKey: string, putObjectInR2: boolean) {
  const pinHash = await hashPin("1234");
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO rooms (id, room_name, pin_hash, created_at, expires_at, status, storage_bytes_used)
     VALUES (?, ?, ?, ?, ?, 'active', 10)`
  )
    .bind(roomId, `Room-${roomId}`, pinHash, now - 8 * 24 * 60 * 60 * 1000, now - 1000)
    .run();

  await env.DB.prepare(
    `INSERT INTO files (id, room_id, original_name, storage_key, mime_type, file_size, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(`${roomId}-file`, roomId, "IMG.JPG", storageKey, "image/jpeg", 10, now)
    .run();

  if (putObjectInR2) {
    await env.MEDIA_BUCKET.put(storageKey, new TextEncoder().encode("bytes"));
  }
}

describe("expiration cleanup", () => {
  it("deletes expired rooms, their files, and the R2 objects", async () => {
    await insertExpiredRoomWithFile("cleanup-room-1", "rooms/cleanup-room-1/file-1.jpg", true);

    const result = await runCleanup(env);
    expect(result.roomsDeleted).toBeGreaterThanOrEqual(1);

    const room = await env.DB.prepare("SELECT * FROM rooms WHERE id = ?").bind("cleanup-room-1").first();
    expect(room).toBeNull();

    const file = await env.DB.prepare("SELECT * FROM files WHERE room_id = ?").bind("cleanup-room-1").first();
    expect(file).toBeNull();

    const object = await env.MEDIA_BUCKET.get("rooms/cleanup-room-1/file-1.jpg");
    expect(object).toBeNull();
  });

  it("is idempotent — running twice does not error", async () => {
    await insertExpiredRoomWithFile("cleanup-room-2", "rooms/cleanup-room-2/file-1.jpg", true);
    await runCleanup(env);
    await expect(runCleanup(env)).resolves.not.toThrow();
  });

  it("continues cleanup when the R2 object is already missing", async () => {
    await insertExpiredRoomWithFile("cleanup-room-3", "rooms/cleanup-room-3/missing.jpg", false);

    await expect(runCleanup(env)).resolves.not.toThrow();

    const room = await env.DB.prepare("SELECT * FROM rooms WHERE id = ?").bind("cleanup-room-3").first();
    expect(room).toBeNull();
  });

  it("does not touch rooms that have not expired yet", async () => {
    const pinHash = await hashPin("5555");
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO rooms (id, room_name, pin_hash, created_at, expires_at, status, storage_bytes_used)
       VALUES (?, ?, ?, ?, ?, 'active', 0)`
    )
      .bind("active-room", "StillActive", pinHash, now, now + 60_000)
      .run();

    await runCleanup(env);

    const room = await env.DB.prepare("SELECT * FROM rooms WHERE id = ?").bind("active-room").first();
    expect(room).not.toBeNull();
  });
});
