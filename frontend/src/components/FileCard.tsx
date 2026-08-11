import { useState } from "react";
import type { FilePublic } from "@shared/types";
import { downloadFileUrl } from "../api/client";

function extensionLabel(mimeType: string): string {
  const parts = mimeType.split("/");
  return (parts[1] ?? parts[0] ?? "file").toUpperCase();
}

interface Props {
  file: FilePublic;
  roomId: string;
  sessionToken: string;
  onPreview: (file: FilePublic) => void;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (fileId: string) => void;
}

export default function FileCard({
  file,
  roomId,
  sessionToken,
  onPreview,
  selectMode = false,
  selected = false,
  onToggleSelect,
}: Props) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const isImage = file.mimeType.startsWith("image/");
  const url = downloadFileUrl(roomId, file.id, sessionToken);

  return (
    <div className={`file-card${selected ? " selected" : ""}`}>
      <button
        type="button"
        className="file-thumb-btn"
        onClick={() => (selectMode ? onToggleSelect?.(file.id) : onPreview(file))}
        aria-label={selectMode ? `Select ${file.originalName}` : `Preview ${file.originalName}`}
      >
        {selectMode && (
          <input
            type="checkbox"
            className="thumb-select-overlay"
            checked={selected}
            onChange={() => onToggleSelect?.(file.id)}
            onClick={(e) => e.stopPropagation()}
            aria-hidden="true"
            tabIndex={-1}
          />
        )}
        {isImage && !thumbFailed ? (
          <img className="file-thumb" src={url} alt="" loading="lazy" onError={() => setThumbFailed(true)} />
        ) : (
          <div className="file-thumb-placeholder">{extensionLabel(file.mimeType)}</div>
        )}
      </button>

      <div className="file-footer">
        <span className="file-name" title={file.originalName}>
          {file.originalName}
        </span>
        {!selectMode && (
          <a className="file-download" href={url} download={file.originalName} title="Download" aria-label="Download">
            ⬇
          </a>
        )}
      </div>
    </div>
  );
}
