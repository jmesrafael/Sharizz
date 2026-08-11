import { ALLOWED_MIME_TYPES } from "../../../shared/types";

const EXTENSION_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  heif: "image/heif",
  webp: "image/webp",
  gif: "image/gif",
  tif: "image/tiff",
  tiff: "image/tiff",
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  webm: "video/webm",
};

// iOS Safari sometimes omits/mislabels MIME type for HEIC. Fall back to the
// file extension only when the browser gives us nothing usable — we never
// trust either value for anything beyond an allowlist check.
export function resolveMimeType(declaredType: string, filename: string): string | null {
  const normalized = declaredType.trim().toLowerCase();
  if (normalized && ALLOWED_MIME_TYPES.has(normalized)) return normalized;

  const ext = /\.([A-Za-z0-9]+)$/.exec(filename)?.[1]?.toLowerCase();
  if (ext && EXTENSION_TO_MIME[ext]) return EXTENSION_TO_MIME[ext];

  return null;
}
