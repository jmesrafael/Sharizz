export interface RoomPublic {
  id: string;
  roomName: string;
  createdAt: number;
  expiresAt: number;
  status: "active" | "expired";
  storageBytesUsed: number;
  storageLimitBytes: number;
}

export interface FilePublic {
  id: string;
  roomId: string;
  folderId: string | null;
  originalName: string;
  mimeType: string;
  fileSize: number;
  uploadedAt: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  // True when a small JPEG preview exists for a format browsers can't
  // render natively (currently HEIC/HEIF). Generated client-side at upload
  // time by whichever browser could decode the original — never derived
  // from it server-side, so it may simply be absent.
  hasThumbnail: boolean;
}

export interface FolderPublic {
  id: string;
  roomId: string;
  parentFolderId: string | null;
  folderName: string;
  createdAt: number;
}

export interface CreateFolderRequest {
  folderName: string;
  parentFolderId?: string | null;
}

export interface CreateRoomRequest {
  code: string;
}

export interface CreateRoomResponse {
  room: RoomPublic;
  sessionToken: string;
}

export interface RoomStateResponse {
  room: RoomPublic;
  files: FilePublic[];
  folders: FolderPublic[];
}

export interface ExtendRoomResponse {
  expiresAt: number;
}

export interface DeleteRoomResponse {
  deleted: true;
}

export interface ApiErrorBody {
  error: string;
  code: ApiErrorCode;
  // Only present on TOO_MANY_ATTEMPTS / INVALID_CODE — the real remaining
  // lockout window in ms (short) and the remaining tries before a lockout,
  // independent of whatever wording the message itself uses.
  retryAfterMs?: number;
  attemptsRemaining?: number;
}

export type ApiErrorCode =
  | "ROOM_NOT_FOUND"
  | "ROOM_EXPIRED"
  | "INVALID_CODE"
  | "TOO_MANY_ATTEMPTS"
  | "UNAUTHORIZED"
  | "FILE_TOO_LARGE"
  | "TOO_MANY_FILES"
  | "ROOM_STORAGE_LIMIT"
  | "INVALID_FILE_TYPE"
  | "FILE_NOT_FOUND"
  | "FOLDER_NOT_FOUND"
  | "INVALID_FOLDER_NAME"
  | "TOO_MANY_FOLDERS"
  | "STORAGE_UNAVAILABLE"
  | "RATE_LIMITED"
  | "VALIDATION_ERROR"
  | "GLOBAL_QUOTA_EXCEEDED"
  | "INTERNAL_ERROR";

// Cloudflare R2's free-tier ceilings. Storage is billed as GB-month (a
// time-integrated average), so tracking current bytes-in-bucket is a
// conservative proxy, not an exact GB-month figure — it trends the same
// direction and errs on the side of warning early.
export const R2_FREE_TIER = {
  STORAGE_BYTES: 10 * 1024 * 1024 * 1024, // 10 GB stored
  CLASS_A_OPS: 1_000_000, // writes (uploads) per month
  CLASS_B_OPS: 10_000_000, // reads (downloads) per month
  WARN_THRESHOLD_PCT: 0.8,
} as const;

export type UsageLevel = "ok" | "warning" | "exceeded";

export interface UsageStatus {
  month: string;
  storageBytes: number;
  storagePct: number;
  classAOps: number;
  classAPct: number;
  classBOps: number;
  classBPct: number;
  level: UsageLevel;
}

export const LIMITS = {
  MAX_FILE_SIZE: 5 * 1024 * 1024 * 1024, // 5 GB per file
  MAX_FILES_PER_ROOM: 500,
  MAX_ROOM_STORAGE: 20 * 1024 * 1024 * 1024, // 20 GB per room
  MAX_FOLDER_NAME_LENGTH: 60,
  MIN_FOLDER_NAME_LENGTH: 1,
  MAX_FOLDERS_PER_ROOM: 100,
  MAX_GATE_ATTEMPTS: 3,
  // The lockout message tells the user "try again in 1 hour" (a deterrent
  // lie, same spirit as the time-code riddle itself), but the real gate
  // only holds for this long — short enough that a genuine user just waits
  // it out, long enough to blunt a brute-force loop.
  GATE_LOCKOUT_MS: 60 * 1000,
  ROOM_LIFETIME_MS: 24 * 60 * 60 * 1000,
  // Session tokens outlive the room's initial expiry on purpose — the room
  // row's expires_at (checked fresh on every request) is the real gate, and
  // it can be pushed out by the hidden extend action. Baking the room's
  // expiry into the token itself would strand already-shared guest links
  // the moment the *original* window closed, even after an extension.
  SESSION_TOKEN_LIFETIME_MS: 30 * 24 * 60 * 60 * 1000,
  DOWNLOAD_ALL_ZIP_MAX_BYTES: 2 * 1024 * 1024 * 1024, // 2 GB — beyond this, use individual downloads
  // Files above this size go through the resumable (chunked) multipart path
  // instead of a single PUT, so a network drop only costs one chunk, not
  // the whole file. R2 requires every part but the last to be >= 5 MB.
  MULTIPART_THRESHOLD_BYTES: 24 * 1024 * 1024, // 24 MB
  MULTIPART_CHUNK_SIZE_BYTES: 8 * 1024 * 1024, // 8 MB
} as const;

// Resumable upload flow: POST /uploads creates the multipart upload, PUT
// /uploads/:uploadId/parts/:partNumber streams each chunk, POST
// /uploads/:uploadId/complete assembles them into the final R2 object. The
// client persists {key, uploadId, parts} locally so a reload or a dropped
// connection can resume from the next missing chunk instead of restarting.
export interface MultipartInitRequest {
  name: string;
  type: string;
  size: number;
  folderId?: string | null;
}

export interface MultipartInitResponse {
  fileId: string;
  key: string;
  uploadId: string;
  originalName: string;
  mimeType: string;
  folderId: string | null;
}

export interface MultipartPart {
  partNumber: number;
  etag: string;
}

export interface MultipartCompleteRequest {
  key: string;
  fileId: string;
  originalName: string;
  mimeType: string;
  folderId: string | null;
  parts: MultipartPart[];
}

export const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp",
  "image/gif",
  "image/tiff",
  "image/x-adobe-dng",
  "video/mp4",
  "video/quicktime",
  "video/x-m4v",
  "video/webm",
]);
