import { LIMITS } from "../../../shared/types";

const FOLDER_NAME_PATTERN = /^[^\\/\x00-\x1f]+$/;

export function validateFolderName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < LIMITS.MIN_FOLDER_NAME_LENGTH) return "Folder name is too short.";
  if (trimmed.length > LIMITS.MAX_FOLDER_NAME_LENGTH) {
    return `Folder name must be ${LIMITS.MAX_FOLDER_NAME_LENGTH} characters or fewer.`;
  }
  if (!FOLDER_NAME_PATTERN.test(trimmed)) {
    return "Folder name can't contain slashes or control characters.";
  }
  return null;
}

const CONTROL_CHAR_CODES_MAX = 0x1f;

// Strips path separators and control characters so the name is safe to
// display and to use in a Content-Disposition header. This is for DISPLAY
// only — storage keys always use generated IDs, never the original
// filename, so path traversal via filename is not possible.
export function sanitizeDisplayFilename(name: string): string {
  const noSeparators = name.replace(/[\\/]/g, "_");
  let cleaned = "";
  for (const ch of noSeparators) {
    const code = ch.codePointAt(0) ?? 0;
    if (code > CONTROL_CHAR_CODES_MAX && code !== 0x7f) cleaned += ch;
  }
  const trimmed = cleaned.trim().slice(0, 255);
  return trimmed.length > 0 ? trimmed : "file";
}

export function buildStorageKey(roomId: string, fileId: string, originalName: string): string {
  const ext = getSafeExtension(originalName);
  return `rooms/${roomId}/${fileId}${ext}`;
}

function getSafeExtension(name: string): string {
  const match = /\.[A-Za-z0-9]{1,10}$/.exec(name);
  if (!match) return "";
  return match[0].toLowerCase();
}
