import type { Env, RoomRow } from "../types";
import type { RoomPublic } from "../../../shared/types";

export async function getRoomById(env: Env, roomId: string): Promise<RoomRow | null> {
  const row = await env.DB.prepare("SELECT * FROM rooms WHERE id = ?").bind(roomId).first<RoomRow>();
  return row ?? null;
}

export function isRoomLive(room: RoomRow, now: number): boolean {
  return room.status === "active" && now < room.expires_at;
}

export function toPublicRoom(room: RoomRow, now: number, storageLimitBytes: number): RoomPublic {
  return {
    id: room.id,
    roomName: room.room_name,
    roomCode: room.room_code,
    createdAt: room.created_at,
    expiresAt: room.expires_at,
    status: isRoomLive(room, now) ? "active" : "expired",
    storageBytesUsed: room.storage_bytes_used,
    storageLimitBytes,
  };
}

export async function insertRoom(
  env: Env,
  params: { id: string; roomName: string; roomCode: string; pinHash: string; createdAt: number; expiresAt: number }
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO rooms (id, room_name, room_code, pin_hash, created_at, expires_at, status, storage_bytes_used)
     VALUES (?, ?, ?, ?, ?, ?, 'active', 0)`
  )
    .bind(params.id, params.roomName, params.roomCode, params.pinHash, params.createdAt, params.expiresAt)
    .run();
}

// Room codes are 4 digits, same shape as the time-gate code, so they fit the
// landing page's existing numeric input. Only 10,000 possible values, so
// uniqueness is checked (and retried on collision) against currently-active
// rooms rather than relied on as a DB constraint — expired rows linger until
// the hourly cron sweep and shouldn't block reuse of their old code.
const ROOM_CODE_GEN_ATTEMPTS = 20;

export async function generateUniqueRoomCode(env: Env, now: number): Promise<string> {
  for (let attempt = 0; attempt < ROOM_CODE_GEN_ATTEMPTS; attempt++) {
    const code = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
    const existing = await getRoomByCode(env, code, now);
    if (!existing) return code;
  }
  throw new Error("Could not generate a unique room code.");
}

export async function getRoomByCode(env: Env, code: string, now: number): Promise<RoomRow | null> {
  const row = await env.DB.prepare(
    "SELECT * FROM rooms WHERE room_code = ? AND status = 'active' AND expires_at > ? ORDER BY created_at DESC LIMIT 1"
  )
    .bind(code, now)
    .first<RoomRow>();
  return row ?? null;
}

export async function incrementRoomStorage(env: Env, roomId: string, deltaBytes: number): Promise<void> {
  await env.DB.prepare("UPDATE rooms SET storage_bytes_used = storage_bytes_used + ? WHERE id = ?")
    .bind(deltaBytes, roomId)
    .run();
}

export async function setRoomStorage(env: Env, roomId: string, bytes: number): Promise<void> {
  await env.DB.prepare("UPDATE rooms SET storage_bytes_used = ? WHERE id = ?").bind(bytes, roomId).run();
}

export async function extendRoomExpiry(env: Env, roomId: string, additionalMs: number): Promise<number> {
  await env.DB.prepare("UPDATE rooms SET expires_at = expires_at + ? WHERE id = ?")
    .bind(additionalMs, roomId)
    .run();
  const row = await env.DB.prepare("SELECT expires_at FROM rooms WHERE id = ?")
    .bind(roomId)
    .first<{ expires_at: number }>();
  return row?.expires_at ?? Date.now() + additionalMs;
}
