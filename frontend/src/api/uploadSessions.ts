// Persists in-progress multipart upload state to localStorage (not
// sessionStorage — it needs to survive a reload or a closed tab) so a
// resumed upload can skip parts that already made it to R2 instead of
// starting the whole file over. Keyed by file identity, not just name, so
// picking a different file with the same name doesn't collide.

export interface UploadSession {
  fileId: string;
  key: string;
  uploadId: string;
  originalName: string;
  mimeType: string;
  folderId: string | null;
  chunkSize: number;
  totalBytes: number;
  parts: Record<number, string>; // partNumber -> etag
  createdAt: number;
}

const KEY_PREFIX = "sharizz:upload:";
const MAX_AGE_MS = 25 * 60 * 60 * 1000; // just past a room's 24h lifetime

function sessionKey(roomId: string, file: File): string {
  return `${KEY_PREFIX}${roomId}:${file.name}:${file.size}:${file.lastModified}`;
}

export function loadUploadSession(roomId: string, file: File): UploadSession | null {
  const raw = localStorage.getItem(sessionKey(roomId, file));
  if (!raw) return null;
  try {
    const session: UploadSession = JSON.parse(raw);
    if (Date.now() - session.createdAt > MAX_AGE_MS) {
      localStorage.removeItem(sessionKey(roomId, file));
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function saveUploadSession(roomId: string, file: File, session: UploadSession): void {
  localStorage.setItem(sessionKey(roomId, file), JSON.stringify(session));
}

export function clearUploadSession(roomId: string, file: File): void {
  localStorage.removeItem(sessionKey(roomId, file));
}
