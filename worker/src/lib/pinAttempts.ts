import type { Env } from "../types";

// Per-room, per-client PIN attempt tracking (D1-backed so it works across
// Worker isolates). A client is identified by a coarse key (IP address) —
// good enough to slow down brute force without needing full accounts.

export async function getAttemptCount(env: Env, roomId: string, clientKey: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT attempts FROM pin_attempts WHERE room_id = ? AND client_key = ?"
  )
    .bind(roomId, clientKey)
    .first<{ attempts: number }>();
  return row?.attempts ?? 0;
}

export interface AttemptRecord {
  attempts: number;
  lastAttemptAt: number;
}

export async function getAttemptRecord(env: Env, roomId: string, clientKey: string): Promise<AttemptRecord> {
  const row = await env.DB.prepare(
    "SELECT attempts, last_attempt_at FROM pin_attempts WHERE room_id = ? AND client_key = ?"
  )
    .bind(roomId, clientKey)
    .first<{ attempts: number; last_attempt_at: number }>();
  return { attempts: row?.attempts ?? 0, lastAttemptAt: row?.last_attempt_at ?? 0 };
}

export async function recordFailedAttempt(env: Env, roomId: string, clientKey: string): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO pin_attempts (room_id, client_key, attempts, first_attempt_at, last_attempt_at)
     VALUES (?, ?, 1, ?, ?)
     ON CONFLICT(room_id, client_key)
     DO UPDATE SET attempts = attempts + 1, last_attempt_at = ?`
  )
    .bind(roomId, clientKey, now, now, now)
    .run();
}

export async function clearAttempts(env: Env, roomId: string, clientKey: string): Promise<void> {
  await env.DB.prepare("DELETE FROM pin_attempts WHERE room_id = ? AND client_key = ?")
    .bind(roomId, clientKey)
    .run();
}

export function getClientKey(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
    "unknown"
  );
}
