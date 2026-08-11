export interface RoomPublic {
  id: string;
  roomName: string;
  createdAt: number;
  expiresAt: number;
  status: "active" | "expired";
}

export interface FilePublic {
  id: string;
  roomId: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  uploadedAt: number;
  width: number | null;
  height: number | null;
  duration: number | null;
}

export interface CreateRoomRequest {
  roomName: string;
  pin: string;
}

export interface CreateRoomResponse {
  room: RoomPublic;
  sessionToken: string;
}

export interface EnterRoomRequest {
  pin: string;
}

export interface EnterRoomResponse {
  room: RoomPublic;
  sessionToken: string;
}

export interface RoomStateResponse {
  room: RoomPublic;
  files: FilePublic[];
}

export interface ApiErrorBody {
  error: string;
  code: ApiErrorCode;
}

export type ApiErrorCode =
  | "ROOM_NOT_FOUND"
  | "ROOM_EXPIRED"
  | "INVALID_PIN"
  | "TOO_MANY_ATTEMPTS"
  | "UNAUTHORIZED"
  | "INVALID_ROOM_NAME"
  | "INVALID_PIN_FORMAT"
  | "FILE_TOO_LARGE"
  | "TOO_MANY_FILES"
  | "ROOM_STORAGE_LIMIT"
  | "INVALID_FILE_TYPE"
  | "FILE_NOT_FOUND"
  | "STORAGE_UNAVAILABLE"
  | "RATE_LIMITED"
  | "VALIDATION_ERROR"
  | "INTERNAL_ERROR";

export const LIMITS = {
  MAX_FILE_SIZE: 5 * 1024 * 1024 * 1024, // 5 GB per file
  MAX_FILES_PER_ROOM: 500,
  MAX_ROOM_STORAGE: 20 * 1024 * 1024 * 1024, // 20 GB per room
  MAX_ROOM_NAME_LENGTH: 40,
  MIN_ROOM_NAME_LENGTH: 2,
  MAX_PIN_ATTEMPTS: 8,
  PIN_MIN_LENGTH: 4,
  PIN_MAX_LENGTH: 8,
  ROOM_LIFETIME_MS: 7 * 24 * 60 * 60 * 1000,
  DOWNLOAD_ALL_ZIP_MAX_BYTES: 2 * 1024 * 1024 * 1024, // 2 GB — beyond this, use individual downloads
} as const;

export const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp",
  "image/gif",
  "image/tiff",
  "video/mp4",
  "video/quicktime",
  "video/x-m4v",
  "video/webm",
]);
