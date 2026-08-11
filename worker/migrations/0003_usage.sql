-- Tracks R2 Class A/B operation counts per calendar month so the app can
-- warn as it approaches Cloudflare's R2 free-tier ceilings. Storage bytes
-- are not tracked here — they're derived on read from SUM(rooms.storage_bytes_used).

CREATE TABLE IF NOT EXISTS usage_counters (
  month TEXT PRIMARY KEY,
  class_a_ops INTEGER NOT NULL DEFAULT 0,
  class_b_ops INTEGER NOT NULL DEFAULT 0
);
