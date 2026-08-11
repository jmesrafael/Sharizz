export interface Env {
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  SESSION_SECRET: string;
  MAX_FILE_SIZE: string;
  MAX_FILES_PER_ROOM: string;
  MAX_ROOM_STORAGE: string;
  MAX_ROOM_NAME_LENGTH: string;
  MAX_PIN_ATTEMPTS: string;
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
}

export interface FileRow {
  id: string;
  room_id: string;
  original_name: string;
  storage_key: string;
  mime_type: string;
  file_size: number;
  uploaded_at: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  checksum: string | null;
}
