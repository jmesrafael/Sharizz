import type {
  ApiErrorBody,
  CreateRoomResponse,
  FilePublic,
  FolderPublic,
  RoomStateResponse,
  UsageStatus,
} from "@shared/types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(body: ApiErrorBody, status: number) {
    super(body.error);
    this.code = body.code;
    this.status = status;
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
