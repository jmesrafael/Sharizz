// Session tokens live in sessionStorage only — never localStorage, and
// never the PIN itself. Cleared automatically when the tab closes.

const KEY_PREFIX = "sharizz:session:";

export function saveSessionToken(roomId: string, token: string): void {
  sessionStorage.setItem(KEY_PREFIX + roomId, token);
}

export function getSessionToken(roomId: string): string | null {
  return sessionStorage.getItem(KEY_PREFIX + roomId);
}

export function clearSessionToken(roomId: string): void {
  sessionStorage.removeItem(KEY_PREFIX + roomId);
}
