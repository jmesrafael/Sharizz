import { useCallback, useRef, useState } from "react";
import type { FilePublic } from "@shared/types";
import { LIMITS } from "@shared/types";
import {
  ApiError,
  abortMultipartUpload,
  completeMultipartUpload,
  initMultipartUpload,
  uploadFile,
  uploadPart,
  uploadThumbnail,
} from "../api/client";
import { clearUploadSession, loadUploadSession, saveUploadSession, type UploadSession } from "../api/uploadSessions";
import { generateThumbnail, needsClientThumbnail } from "../lib/heicThumbnail";

export interface UploadItem {
  key: string;
  file: File;
  folderId: string | null;
  progress: number;
  status: "uploading" | "error";
  error?: string;
}

const MAX_PART_ATTEMPTS = 4;

function partSize(partNumber: number, totalParts: number, totalBytes: number, chunkSize: number): number {
  if (partNumber < totalParts) return chunkSize;
  const remainder = totalBytes % chunkSize;
  return remainder === 0 ? chunkSize : remainder;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function useUploads(
  roomId: string,
  sessionToken: string,
  onUploaded: (file: FilePublic) => void,
  onThumbnailReady?: (fileId: string) => void
) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const abortHandlers = useRef(new Map<string, () => void>());

  const setProgress = useCallback((key: string, percent: number) => {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, progress: Math.min(99, percent) } : it)));
  }, []);

  // Best-effort: only formats browsers can't render natively (HEIC/HEIF)
  // get a thumbnail attempt, and it only succeeds where the browser can
  // actually decode the original (in practice, Safari/iOS). Failure here
  // is silent and harmless — the file just falls back to today's behavior.
  const maybeGenerateThumbnail = useCallback(
    (file: File, uploaded: FilePublic) => {
      if (!needsClientThumbnail(uploaded.mimeType)) return;
      generateThumbnail(file)
        .then((blob) => (blob ? uploadThumbnail(roomId, sessionToken, uploaded.id, blob) : undefined))
        .then(() => onThumbnailReady?.(uploaded.id))
        .catch(() => {});
    },
    [roomId, sessionToken, onThumbnailReady]
  );

  // The item disappears from the progress list the instant it succeeds —
  // the file itself shows up in the gallery grid right away, so a lingering
  // "Complete" bar would just be a second, redundant confirmation.
  const setSuccess = useCallback(
    (key: string, file: File, uploaded: FilePublic) => {
      setItems((prev) => prev.filter((it) => it.key !== key));
      abortHandlers.current.delete(key);
      onUploaded(uploaded);
      maybeGenerateThumbnail(file, uploaded);
    },
    [onUploaded, maybeGenerateThumbnail]
  );

  const setFailed = useCallback((key: string, message: string) => {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, status: "error", error: message } : it)));
  }, []);

  // Large files are split into chunks and sent as an R2 multipart upload.
  // Progress and the completed-part list are persisted after every chunk,
  // so retrying (or reopening the tab) resumes from the next missing part
  // instead of re-sending bytes that already landed.
  const runChunkedUpload = useCallback(
    async (key: string, file: File, folderId: string | null, aborted: { current: boolean }) => {
      let session: UploadSession;
      const existing = loadUploadSession(roomId, file);
      if (existing) {
        session = existing;
      } else {
        const init = await initMultipartUpload(roomId, sessionToken, {
          name: file.name,
          type: file.type,
          size: file.size,
          folderId,
        });
        session = {
          fileId: init.fileId,
          key: init.key,
          uploadId: init.uploadId,
          originalName: init.originalName,
          mimeType: init.mimeType,
          folderId: init.folderId,
          chunkSize: LIMITS.MULTIPART_CHUNK_SIZE_BYTES,
          totalBytes: file.size,
          parts: {},
          createdAt: Date.now(),
        };
        saveUploadSession(roomId, file, session);
      }

      const totalParts = Math.ceil(session.totalBytes / session.chunkSize);
      const partBytesUploaded = (partNumber: number) =>
        Object.keys(session.parts)
          .map(Number)
          .filter((pn) => pn < partNumber)
          .reduce((sum, pn) => sum + partSize(pn, totalParts, session.totalBytes, session.chunkSize), 0);

      const alreadyDone = Object.keys(session.parts).length;
      setProgress(key, Math.round(((alreadyDone * session.chunkSize) / session.totalBytes) * 100));

      for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
        if (aborted.current) throw new Error("Upload cancelled.");
        if (session.parts[partNumber]) continue;

        const start = (partNumber - 1) * session.chunkSize;
        const end = Math.min(start + session.chunkSize, session.totalBytes);
        const blob = file.slice(start, end);
        const bytesBefore = partBytesUploaded(partNumber);

        let lastError: unknown;
        let etag: string | null = null;
        for (let attempt = 1; attempt <= MAX_PART_ATTEMPTS && !aborted.current; attempt++) {
          const { promise, abort } = uploadPart(
            roomId,
            sessionToken,
            session.key,
            session.uploadId,
            partNumber,
            blob,
            (loaded) => setProgress(key, Math.round(((bytesBefore + loaded) / session.totalBytes) * 100))
          );
          abortHandlers.current.set(key, abort);
          try {
            const result = await promise;
            etag = result.etag;
            break;
          } catch (err) {
            lastError = err;
            if (aborted.current) break;
            if (attempt < MAX_PART_ATTEMPTS) await sleep(500 * 2 ** (attempt - 1));
          }
        }

        if (aborted.current) throw new Error("Upload cancelled.");
        if (!etag) {
          throw lastError instanceof Error ? lastError : new Error("This chunk failed to upload.");
        }

        session.parts[partNumber] = etag;
        saveUploadSession(roomId, file, session);
      }

      const uploaded = await completeMultipartUpload(roomId, sessionToken, session.uploadId, {
        key: session.key,
        fileId: session.fileId,
        originalName: session.originalName,
        mimeType: session.mimeType,
        folderId: session.folderId,
        parts: Object.entries(session.parts)
          .map(([partNumber, etag]) => ({ partNumber: Number(partNumber), etag }))
          .sort((a, b) => a.partNumber - b.partNumber),
      });

      clearUploadSession(roomId, file);
      return uploaded;
    },
    [roomId, sessionToken, setProgress]
  );

  const startUpload = useCallback(
    (key: string, file: File, folderId: string | null) => {
      if (file.size <= LIMITS.MULTIPART_THRESHOLD_BYTES) {
        const { abort } = uploadFile(
          roomId,
          sessionToken,
          file,
          {
            onProgress: (percent) => setProgress(key, percent),
            onSuccess: (uploaded) => setSuccess(key, file, uploaded),
            onError: (message) => setFailed(key, message),
          },
          folderId
        );
        abortHandlers.current.set(key, abort);
        return;
      }

      const aborted = { current: false };
      abortHandlers.current.set(key, () => {
        aborted.current = true;
      });

      runChunkedUpload(key, file, folderId, aborted)
        .then((uploaded) => setSuccess(key, file, uploaded))
        .catch((err) => {
          setFailed(key, err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Upload failed. Please try again.");
        });
    },
    [roomId, sessionToken, runChunkedUpload, setProgress, setSuccess, setFailed]
  );

  const enqueueFiles = useCallback(
    (files: File[], folderId: string | null = null) => {
      const newItems: UploadItem[] = files.map((file) => ({
        key: `${file.name}-${file.size}-${crypto.randomUUID()}`,
        file,
        folderId,
        progress: 0,
        status: "uploading",
      }));
      setItems((prev) => [...prev, ...newItems]);
      for (const item of newItems) startUpload(item.key, item.file, item.folderId);
    },
    [startUpload]
  );

  const retry = useCallback(
    (key: string) => {
      setItems((prev) => prev.map((it) => (it.key === key ? { ...it, status: "uploading", error: undefined } : it)));
      const item = items.find((it) => it.key === key);
      if (item) startUpload(key, item.file, item.folderId);
    },
    [items, startUpload]
  );

  // Abandons a failed/in-progress chunked upload for good: stops any
  // in-flight chunk and releases the parts R2 is holding, rather than
  // leaving them to expire on their own.
  const dismiss = useCallback(
    (key: string) => {
      abortHandlers.current.get(key)?.();
      abortHandlers.current.delete(key);
      const item = items.find((it) => it.key === key);
      if (item && item.file.size > LIMITS.MULTIPART_THRESHOLD_BYTES) {
        const session = loadUploadSession(roomId, item.file);
        if (session) {
          clearUploadSession(roomId, item.file);
          abortMultipartUpload(roomId, sessionToken, session.uploadId, session.key).catch(() => {});
        }
      }
      setItems((prev) => prev.filter((it) => it.key !== key));
    },
    [items, roomId, sessionToken]
  );

  return { items, enqueueFiles, retry, dismiss };
}
