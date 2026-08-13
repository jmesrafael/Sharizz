import type {
  ApiErrorBody,
  CreateRoomResponse,
  DeleteRoomResponse,
  ExtendRoomResponse,
  FilePublic,
  FolderPublic,
  MultipartCompleteRequest,
  MultipartInitRequest,
  MultipartInitResponse,
  RoomStateResponse,
  UsageStatus,
} from "@shared/types";

// Empty string means same-origin (relative) requests — correct for
// production, where Cloudflare Pages serves both the API (via
// functions/api/[[path]].ts) and this static app from one origin. Local
// dev overrides this via VITE_API_BASE_URL in frontend/.env, since the
// Vite dev server and `wrangler dev` run on different ports.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

export class ApiError extends Error {
  code: string;
  status: number;
  retryAfterMs?: number;
  attemptsRemaining?: number;
  constructor(body: ApiErrorBody, status: number) {
    super(body.error);
    this.code = body.code;
    this.status = status;
    this.retryAfterMs = body.retryAfterMs;
    this.attemptsRemaining = body.attemptsRemaining;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, init);
  if (!res.ok) {
    let body: ApiErrorBody;
    try {
      body = await res.json();
    } catch {
      throw new ApiError({ error: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" }, res.status);
    }
    throw new ApiError(body, res.status);
  }
  return res.json();
}

export function createRoom(code: string): Promise<CreateRoomResponse> {
  return request("/api/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
}

export function getRoomState(roomId: string, sessionToken: string): Promise<RoomStateResponse> {
  return request(`/api/rooms/${roomId}`, {
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
}

export function deleteRoom(roomId: string, sessionToken: string): Promise<DeleteRoomResponse> {
  return request(`/api/rooms/${roomId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
}

// Used for <a download> links and for <img>/<video> src attributes. The
// session token travels as a query param in the latter case since HTML
// media elements can't send custom headers — same short-lived token, same
// scope as the Authorization header used everywhere else.
export function downloadFileUrl(roomId: string, fileId: string, sessionToken: string): string {
  return `${API_BASE_URL}/api/rooms/${roomId}/files/${fileId}?token=${encodeURIComponent(sessionToken)}`;
}

export function downloadAllUrl(roomId: string, sessionToken: string): string {
  return `${API_BASE_URL}/api/rooms/${roomId}/download-all?token=${encodeURIComponent(sessionToken)}`;
}

export function downloadSelectedUrl(roomId: string, sessionToken: string, fileIds: string[]): string {
  const ids = fileIds.map(encodeURIComponent).join(",");
  return `${API_BASE_URL}/api/rooms/${roomId}/download-selected?fileIds=${ids}&token=${encodeURIComponent(sessionToken)}`;
}

// Small client-generated WebP (or JPEG fallback) derivative — see
// frontend/src/lib/imagePreview.ts. Distinct from downloadFileUrl: this
// never touches the original object.
export function thumbnailUrl(roomId: string, fileId: string, sessionToken: string): string {
  return `${API_BASE_URL}/api/rooms/${roomId}/files/${fileId}/thumbnail?token=${encodeURIComponent(sessionToken)}`;
}

export async function uploadThumbnail(
  roomId: string,
  sessionToken: string,
  fileId: string,
  blob: Blob
): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/rooms/${roomId}/files/${fileId}/thumbnail`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${sessionToken}`, "Content-Type": blob.type },
    body: blob,
  });
  if (!res.ok) {
    let body: ApiErrorBody;
    try {
      body = await res.json();
    } catch {
      throw new ApiError({ error: "Couldn't save the thumbnail.", code: "STORAGE_UNAVAILABLE" }, res.status);
    }
    throw new ApiError(body, res.status);
  }
}

// Fetches the file fully, then hands the browser a blob URL to save — unlike
// a plain <a download> click, this resolves only once the bytes have
// actually arrived, so callers can drive a real "downloading -> downloaded"
// indicator per file instead of firing every download at once and hoping.
export async function downloadFileToDisk(
  roomId: string,
  fileId: string,
  originalName: string,
  sessionToken: string
): Promise<void> {
  const res = await fetch(downloadFileUrl(roomId, fileId, sessionToken));
  if (!res.ok) throw new ApiError({ error: "Download failed.", code: "FILE_NOT_FOUND" }, res.status);

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = originalName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

export function deleteFiles(roomId: string, sessionToken: string, fileIds: string[]): Promise<{ deletedIds: string[] }> {
  return request(`/api/rooms/${roomId}/files`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
    body: JSON.stringify({ fileIds }),
  });
}

export function clearStorage(roomId: string, sessionToken: string): Promise<{ deletedCount: number }> {
  return request(`/api/rooms/${roomId}/clear`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
}

export function getUsageStatus(): Promise<UsageStatus> {
  return request("/api/usage");
}

export function extendRoom(roomId: string, sessionToken: string): Promise<ExtendRoomResponse> {
  return request(`/api/rooms/${roomId}/extend`, {
    method: "POST",
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
}

export function createFolder(
  roomId: string,
  sessionToken: string,
  folderName: string,
  parentFolderId: string | null
): Promise<FolderPublic> {
  return request(`/api/rooms/${roomId}/folders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
    body: JSON.stringify({ folderName, parentFolderId }),
  });
}

export function openRoomEventStream(roomId: string, sessionToken: string): EventSource {
  // EventSource can't set custom headers, so the token travels in the
  // query string for this connection only — it's short-lived and scoped
  // to a single room, same security posture as the Authorization header.
  const url = `${API_BASE_URL}/api/rooms/${roomId}/events?token=${encodeURIComponent(sessionToken)}`;
  return new EventSource(url);
}

export interface UploadHandlers {
  onProgress: (percent: number) => void;
  onSuccess: (file: FilePublic) => void;
  onError: (message: string) => void;
}

export function uploadFile(
  roomId: string,
  sessionToken: string,
  file: File,
  handlers: UploadHandlers,
  folderId: string | null = null
): { abort: () => void } {
  const xhr = new XMLHttpRequest();
  const folderParam = folderId ? `&folderId=${encodeURIComponent(folderId)}` : "";
  const url = `${API_BASE_URL}/api/rooms/${roomId}/files?name=${encodeURIComponent(
    file.name
  )}&type=${encodeURIComponent(file.type)}${folderParam}`;

  xhr.open("PUT", url, true);
  xhr.setRequestHeader("Authorization", `Bearer ${sessionToken}`);
  xhr.setRequestHeader("Content-Type", "application/octet-stream");

  xhr.upload.onprogress = (event) => {
    if (event.lengthComputable) {
      handlers.onProgress(Math.round((event.loaded / event.total) * 100));
    }
  };

  xhr.onload = () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      handlers.onProgress(100);
      handlers.onSuccess(JSON.parse(xhr.responseText));
    } else {
      try {
        const body: ApiErrorBody = JSON.parse(xhr.responseText);
        handlers.onError(body.error);
      } catch {
        handlers.onError("Upload failed. Please try again.");
      }
    }
  };

  xhr.onerror = () => handlers.onError("Network error during upload.");
  xhr.onabort = () => handlers.onError("Upload cancelled.");

  xhr.send(file);

  return { abort: () => xhr.abort() };
}

export function initMultipartUpload(
  roomId: string,
  sessionToken: string,
  init: MultipartInitRequest
): Promise<MultipartInitResponse> {
  return request(`/api/rooms/${roomId}/uploads`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
    body: JSON.stringify(init),
  });
}

export function completeMultipartUpload(
  roomId: string,
  sessionToken: string,
  uploadId: string,
  payload: MultipartCompleteRequest
): Promise<FilePublic> {
  return request(`/api/rooms/${roomId}/uploads/${encodeURIComponent(uploadId)}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
    body: JSON.stringify(payload),
  });
}

export function abortMultipartUpload(
  roomId: string,
  sessionToken: string,
  uploadId: string,
  key: string
): Promise<{ aborted: boolean }> {
  return request(
    `/api/rooms/${roomId}/uploads/${encodeURIComponent(uploadId)}?key=${encodeURIComponent(key)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${sessionToken}` } }
  );
}

// One request per chunk: a dropped connection only loses the in-flight
// chunk, and progress is reported per-chunk so overall upload % stays live
// even on a multi-gigabyte file.
export function uploadPart(
  roomId: string,
  sessionToken: string,
  key: string,
  uploadId: string,
  partNumber: number,
  blob: Blob,
  onProgress: (loaded: number) => void
): { promise: Promise<{ partNumber: number; etag: string }>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const url = `${API_BASE_URL}/api/rooms/${roomId}/uploads/${encodeURIComponent(uploadId)}/parts/${partNumber}?key=${encodeURIComponent(key)}`;

  xhr.open("PUT", url, true);
  xhr.setRequestHeader("Authorization", `Bearer ${sessionToken}`);
  xhr.setRequestHeader("Content-Type", "application/octet-stream");

  xhr.upload.onprogress = (event) => {
    if (event.lengthComputable) onProgress(event.loaded);
  };

  const promise = new Promise<{ partNumber: number; etag: string }>((resolve, reject) => {
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(blob.size);
        resolve(JSON.parse(xhr.responseText));
      } else {
        try {
          const body: ApiErrorBody = JSON.parse(xhr.responseText);
          reject(new ApiError(body, xhr.status));
        } catch {
          reject(new Error("This chunk failed to upload."));
        }
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload."));
    xhr.onabort = () => reject(new Error("Upload cancelled."));
  });

  xhr.send(blob);

  return { promise, abort: () => xhr.abort() };
}
