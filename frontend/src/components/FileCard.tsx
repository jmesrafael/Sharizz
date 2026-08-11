import { useState } from "react";
import type { FilePublic } from "@shared/types";
import { downloadFileUrl } from "../api/client";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = -1;
  do {
    value /= 1024;
    unitIndex++;
  } while (value >= 1024 && unitIndex < units.length - 1);
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function extensionLabel(mimeType: string): string {
  const parts = mimeType.split("/");
  return (parts[1] ?? parts[0] ?? "file").toUpperCase();
}

interface Props {
  file: FilePublic;
  roomId: string;
  sessionToken: string;
  onPreview: (file: FilePublic) => void;
}

export default function FileCard({ file, roomId, sessionToken, onPreview }: Props) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const isImage = file.mimeType.startsWith("image/");
  const url = downloadFileUrl(roomId, file.id, sessionToken);

  return (
    <div className="file-card">
      {isImage && !thumbFailed ? (
        <img className="file-thumb" src={url} alt="" loading="lazy" onError={() => setThumbFailed(true)} />
      ) : (
        <div className="file-thumb-placeholder">{extensionLabel(file.mimeType)}</div>
      )}

      <div className="file-info">
        <span className="file-name">{file.originalName}</span>
        <span className="file-meta">
          {formatBytes(file.fileSize)}
          {file.width && file.height ? ` · ${file.width}×${file.height}` : ""}
        </span>
      </div>

      <div className="file-actions">
        <button type="button" className="btn btn-secondary btn-small" onClick={() => onPreview(file)}>
          Preview
        </button>
        <a className="btn btn-primary btn-small" href={url} download={file.originalName}>
          Download
        </a>
      </div>
    </div>
  );
}
