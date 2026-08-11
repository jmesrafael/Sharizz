import type {
  ApiErrorBody,
  CreateRoomResponse,
  EnterRoomResponse,
  FilePublic,
  RoomStateResponse,
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

export function createRoom(roomName: string, pin: string): Promise<CreateRoomResponse> {
  return request("/api/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomName, pin }),
  });
}

export async function lookupRoomByName(name: string): Promise<string> {
  const { id } = await request<{ id: string }>(`/api/rooms/lookup?name=${encodeURIComponent(name)}`);
  return id;
}

export function enterRoom(roomId: string, pin: string): Promise<EnterRoomResponse> {
  return request(`/api/rooms/${roomId}/enter`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin }),
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
  handlers: UploadHandlers
): { abort: () => void } {
  const xhr = new XMLHttpRequest();
  const url = `${API_BASE_URL}/api/rooms/${roomId}/files?name=${encodeURIComponent(
    file.name
  )}&type=${encodeURIComponent(file.type)}`;

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
