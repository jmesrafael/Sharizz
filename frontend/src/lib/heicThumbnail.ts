// HEIC/HEIF previews only work in browsers whose OS can decode the format
// natively (in practice, Safari/iOS — via CoreImage). createImageBitmap
// fails silently everywhere else, which is exactly the fallback we want:
// no thumbnail gets generated or uploaded, and the file behaves as it does
// today (placeholder icon, "download to view" in the preview modal).
const MAX_DIMENSION = 480;
const JPEG_QUALITY = 0.8;

const THUMBNAIL_MIME_TYPES = new Set(["image/heic", "image/heif"]);

export function needsClientThumbnail(mimeType: string): boolean {
  return THUMBNAIL_MIME_TYPES.has(mimeType);
}

export async function generateThumbnail(file: File): Promise<Blob | null> {
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

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", JPEG_QUALITY);
    });
  } catch {
    return null;
  } finally {
    bitmap.close();
  }
}
