-- Optional small JPEG derivative for formats browsers can't preview
-- natively (currently HEIC/HEIF). It's generated client-side by whichever
-- browser can actually decode the format (Safari/iOS, the source of most
-- HEIC uploads) and uploaded alongside the original as a second, small R2
-- object — the original file itself is never touched, so downloads always
-- stay byte-for-byte.

ALTER TABLE files ADD COLUMN thumbnail_key TEXT;
ALTER TABLE files ADD COLUMN thumbnail_size INTEGER;
