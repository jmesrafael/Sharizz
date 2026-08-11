import type { Context } from "hono";
import type { ApiErrorCode } from "../../../shared/types";

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  ROOM_NOT_FOUND: 404,
  ROOM_EXPIRED: 410,
  INVALID_CODE: 401,
  TOO_MANY_ATTEMPTS: 429,
  UNAUTHORIZED: 401,
  FILE_TOO_LARGE: 413,
  TOO_MANY_FILES: 400,
  ROOM_STORAGE_LIMIT: 400,
  INVALID_FILE_TYPE: 400,
  FILE_NOT_FOUND: 404,
  FOLDER_NOT_FOUND: 404,
  INVALID_FOLDER_NAME: 400,
  TOO_MANY_FOLDERS: 400,
  STORAGE_UNAVAILABLE: 503,
  RATE_LIMITED: 429,
  VALIDATION_ERROR: 400,
  GLOBAL_QUOTA_EXCEEDED: 507,
  INTERNAL_ERROR: 500,
};

export function apiError(c: Context, code: ApiErrorCode, message: string) {
  return c.json({ error: message, code }, STATUS_BY_CODE[code] as never);
}
