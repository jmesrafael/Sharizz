-- Adds simple, one-level-nestable folders for organizing files within a
-- room. Folders are purely a D1-level grouping — R2 storage keys are
-- unaffected (they already use generated IDs, not folder paths).

CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  parent_folder_id TEXT REFERENCES folders (id) ON DELETE CASCADE,
  folder_name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_folders_room_id ON folders (room_id);
CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders (parent_folder_id);

ALTER TABLE files ADD COLUMN folder_id TEXT REFERENCES folders (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_files_folder_id ON files (folder_id);
