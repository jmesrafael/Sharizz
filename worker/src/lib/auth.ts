import type { Context } from "hono";
import type { Env } from "../types";
import { verifySessionToken } from "./session";

export async function requireRoomSession(c: Context<{ Bindings: Env }>, roomId: string): Promise<boolean> {
  const authHeader = c.req.header("Authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
  // EventSource cannot set custom headers, so the SSE endpoint accepts the
  // token via query string as a fallback — same token, same short lifetime.
  const token = bearerToken ?? c.req.query("token") ?? null;
  if (!token) return false;
  return verifySessionToken(c.env.SESSION_SECRET, token, roomId);
}
