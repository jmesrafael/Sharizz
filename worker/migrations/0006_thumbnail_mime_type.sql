-- Thumbnails are no longer always JPEG (see lib/imagePreview.ts on the
-- frontend, which prefers WebP for a lighter payload and only falls back to
-- JPEG if the browser can't encode WebP) — the actual format has to travel
-- with the row so the GET route can serve the right Content-Type. NULL means
-- a thumbnail predating this column, which was always JPEG.

ALTER TABLE files ADD COLUMN thumbnail_mime_type TEXT;
