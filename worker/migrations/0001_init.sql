-- Sharizz initial schema
-- Rooms are temporary; all rows are expected to be purged by cron cleanup
-- within 24 hours + a grace period. Nothing here is meant to be permanent.

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  room_name TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired')),
  storage_bytes_used INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_rooms_expires_at ON rooms (expires_at);
CREATE INDEX IF NOT EXISTS idx_rooms_room_name ON rooms (room_name);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  uploaded_at INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  duration REAL,
  checksum TEXT
);

CREATE INDEX IF NOT EXISTS idx_files_room_id ON files (room_id);

-- Tracks failed PIN attempts per room to enforce MAX_PIN_ATTEMPTS.
-- Keyed by room_id + a coarse client identifier (IP) so a single abusive
-- client can't lock a room out for everyone indefinitely.
CREATE TABLE IF NOT EXISTS pin_attempts (
  room_id TEXT NOT NULL,
  client_key TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  first_attempt_at INTEGER NOT NULL,
  last_attempt_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, client_key)
);
