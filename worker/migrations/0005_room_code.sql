-- Persistent per-room join code, distinct from the ephemeral time-gate code
-- used only at creation. Copied from inside a room (Copy Code) and re-typed
-- into the landing page's code field to jump straight back into that room
-- instead of creating a new one. Uniqueness is only enforced app-side among
-- currently-active rooms (see generateUniqueRoomCode) rather than via a DB
-- constraint, since expired rows linger until the hourly cron sweep.

ALTER TABLE rooms ADD COLUMN room_code TEXT;

CREATE INDEX IF NOT EXISTS idx_rooms_room_code ON rooms (room_code);
