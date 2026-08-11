import { useCallback, useRef, useState } from "react";
import type { FilePublic } from "@shared/types";
import { uploadFile } from "../api/client";

export interface UploadItem {
  key: string;
  file: File;
  progress: number;
  status: "uploading" | "success" | "error";
  error?: string;
}

export function useUploads(roomId: string, sessionToken: string, onUploaded: (file: FilePublic) => void) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const abortHandlers = useRef(new Map<string, () => void>());

  const startUpload = useCallback(
    (key: string, file: File) => {
      const { abort } = uploadFile(roomId, sessionToken, file, {
        onProgress: (percent) => {
          setItems((prev) => prev.map((it) => (it.key === key ? { ...it, progress: percent } : it)));
        },
        onSuccess: (uploaded) => {
          setItems((prev) => prev.map((it) => (it.key === key ? { ...it, progress: 100, status: "success" } : it)));
          onUploaded(uploaded);
        },
        onError: (message) => {
          setItems((prev) => prev.map((it) => (it.key === key ? { ...it, status: "error", error: message } : it)));
        },
      });
      abortHandlers.current.set(key, abort);
    },
    [roomId, sessionToken, onUploaded]
  );

  const enqueueFiles = useCallback(
    (files: File[]) => {
      const newItems: UploadItem[] = files.map((file) => ({
        key: `${file.name}-${file.size}-${crypto.randomUUID()}`,
        file,
        progress: 0,
        status: "uploading",
      }));
      setItems((prev) => [...prev, ...newItems]);
      for (const item of newItems) startUpload(item.key, item.file);
    },
    [startUpload]
  );

  const retry = useCallback(
    (key: string) => {
      setItems((prev) => prev.map((it) => (it.key === key ? { ...it, status: "uploading", progress: 0, error: undefined } : it)));
      const item = items.find((it) => it.key === key);
      if (item) startUpload(key, item.file);
    },
    [items, startUpload]
  );

  const dismiss = useCallback((key: string) => {
    setItems((prev) => prev.filter((it) => it.key !== key));
  }, []);

  return { items, enqueueFiles, retry, dismiss };
}
