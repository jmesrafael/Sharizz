// Generates a small, fast-loading WebP preview for the grid — the original
// file is never touched by this (see api/client.ts's uploadThumbnail vs.
// downloadFileUrl: two entirely separate objects in R2). Two independent
// reasons a file goes through this path:
//   - It's a format most browsers can't decode natively (HEIC/HEIF) — the
//     preview is the ONLY way it's viewable at all until downloaded.
//   - It's a large photo/video-adjacent image — the preview just makes the
//     grid load fast; the full original is still what downloads and what
//     the lightbox opens first (see PreviewModal.tsx).
// createImageBitmap failing (format the browser truly can't decode, e.g.
// HEIC outside Safari/iOS) is the expected, silent failure mode — the file
// just falls back to today's placeholder-icon / download-to-view behavior.
const MAX_DIMENSION = 480;
const WEBP_QUALITY = 0.8;
const JPEG_QUALITY = 0.8;

export function isPreviewableImage(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

export async function generatePreview(file: File): Promise<Blob | null> {
  if (typeof createImageBitmap !== "function") return null;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }

  try {
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, width, height);

    const toBlob = (type: string, quality: number) =>
      new Promise<Blob | null>((resolve) => canvas.toBlob((blob) => resolve(blob), type, quality));

    // WebP first (lighter at the same visual quality); a handful of very
    // old browsers silently produce no blob for it, so fall back to JPEG
    // rather than losing the preview entirely.
    return (await toBlob("image/webp", WEBP_QUALITY)) ?? (await toBlob("image/jpeg", JPEG_QUALITY));
  } catch {
    return null;
  } finally {
    bitmap.close();
  }
}
