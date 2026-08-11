import type { Env } from "../types";
import { LIMITS } from "../../../shared/types";

export function getConfig(env: Env) {
  const num = (v: string | undefined, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };

  return {
    MAX_FILE_SIZE: num(env.MAX_FILE_SIZE, LIMITS.MAX_FILE_SIZE),
    MAX_FILES_PER_ROOM: num(env.MAX_FILES_PER_ROOM, LIMITS.MAX_FILES_PER_ROOM),
    MAX_ROOM_STORAGE: num(env.MAX_ROOM_STORAGE, LIMITS.MAX_ROOM_STORAGE),
    MAX_GATE_ATTEMPTS: num(env.MAX_GATE_ATTEMPTS, LIMITS.MAX_GATE_ATTEMPTS),
    DOWNLOAD_ALL_ZIP_MAX_BYTES: num(
      env.DOWNLOAD_ALL_ZIP_MAX_BYTES,
      LIMITS.DOWNLOAD_ALL_ZIP_MAX_BYTES
    ),
  };
}
