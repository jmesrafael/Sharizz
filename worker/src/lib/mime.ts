// Sharizz stores any file type — this only ever picks a *label* for the
// Content-Type header and for deciding how the frontend renders a file
// (image/video get inline previews, everything else gets a placeholder
// icon and a Download button). It's never used to reject an upload.
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
  dng: "image/x-adobe-dng",
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  webm: "video/webm",
};

// iOS Safari sometimes omits/mislabels MIME type for HEIC — fall back to
// the file extension in that case. Anything else the browser declares is
// trusted as-is; anything neither declares nor maps by extension falls
// back to the generic binary type rather than being rejected.
export function resolveMimeType(declaredType: string, filename: string): string {
  const normalized = declaredType.trim().toLowerCase();
  if (normalized) return normalized;

  const ext = /\.([A-Za-z0-9]+)$/.exec(filename)?.[1]?.toLowerCase();
  if (ext && EXTENSION_TO_MIME[ext]) return EXTENSION_TO_MIME[ext];

  return "application/octet-stream";
}
