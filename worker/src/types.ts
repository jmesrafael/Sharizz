export interface Env {
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  SESSION_SECRET: string;
  MAX_FILE_SIZE: string;
  MAX_FILES_PER_ROOM: string;
  MAX_ROOM_STORAGE: string;
  MAX_GATE_ATTEMPTS: string;
  GATE_LOCKOUT_MS?: string;
  DOWNLOAD_ALL_ZIP_MAX_BYTES: string;
}

export interface RoomRow {
  id: string;
  room_name: string;
  pin_hash: string;
  created_at: number;
  expires_at: number;
  status: "active" | "expired";
  storage_bytes_used: number;
  room_code: string;
}

export interface FileRow {
  id: string;
  room_id: string;
  folder_id: string | null;
  original_name: string;
  storage_key: string;
  mime_type: string;
  file_size: number;
  uploaded_at: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  checksum: string | null;
  thumbnail_key: string | null;
  thumbnail_size: number | null;
  thumbnail_mime_type: string | null;
}

export interface FolderRow {
  id: string;
  room_id: string;
  parent_folder_id: string | null;
  folder_name: string;
  created_at: number;
}
