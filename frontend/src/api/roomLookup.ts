import { lookupRoomByName } from "./client";

const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

// Generated room IDs are always 22 base64url characters. Anything else is
// treated as a room name and resolved server-side.
export async function resolveRoomIdentifier(identifier: string): Promise<string> {
  if (ROOM_ID_PATTERN.test(identifier)) return identifier;
  return lookupRoomByName(identifier);
}
