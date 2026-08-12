// Persistent (localStorage, not sessionStorage) record of every room this
// device has created, so the hidden "storage history" panel (10 clicks on
// the room name/date — see StorageHistoryPanel.tsx) still has something to
// show after the tab that created a room is long closed. This is a
// deliberate trade-off: each entry's session token sits on disk indefinitely
// instead of clearing when the tab closes like the live session token in
// roomSession.ts does. Anyone with access to this browser profile can read
// it — acceptable for a single-owner device, not something to build on for
// a shared machine.

const KEY = "sharizz:history";

export interface RoomHistoryEntry {
  id: string;
  roomName: string;
  sessionToken: string;
  createdAt: number;
}

function readAll(): RoomHistoryEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(entries: RoomHistoryEntry[]): void {
  localStorage.setItem(KEY, JSON.stringify(entries));
}

// Newest first — re-adding an id (shouldn't normally happen) replaces
// rather than duplicates.
export function addRoomToHistory(entry: RoomHistoryEntry): void {
  writeAll([entry, ...readAll().filter((r) => r.id !== entry.id)]);
}

export function getRoomHistory(): RoomHistoryEntry[] {
  return readAll();
}

export function removeRoomFromHistory(id: string): void {
  writeAll(readAll().filter((r) => r.id !== id));
}

export function clearRoomHistory(): void {
  localStorage.removeItem(KEY);
}
