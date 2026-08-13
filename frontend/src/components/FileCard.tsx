import { useEffect, useState } from "react";
import type { FilePublic } from "@shared/types";
import { downloadFileUrl, thumbnailUrl } from "../api/client";

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
  downloadStatus?: "downloading" | "done";
}

export default function FileCard({
  file,
  roomId,
  sessionToken,
  onPreview,
  selectMode = false,
  selected = false,
  onToggleSelect,
  downloadStatus,
}: Props) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const isImage = file.mimeType.startsWith("image/");
  const url = downloadFileUrl(roomId, file.id, sessionToken);
  // A generated preview (see lib/imagePreview.ts) is always browser-
  // renderable and much lighter than the original, so prefer it for the
  // grid whenever one exists — both for formats like HEIC/HEIF that most
  // browsers can't decode natively, and just to keep the grid fast for
  // large photos. Falls back to the original when no thumbnail exists.
  const thumbSrc = file.hasThumbnail ? thumbnailUrl(roomId, file.id, sessionToken) : url;

  // If the original failed to render (unsupported format) and a thumbnail
  // shows up moments later — the background upload in useUploads finishes
  // after the file card is already visible — give the new source a fresh try
  // instead of staying stuck on the placeholder.
  useEffect(() => {
    setThumbFailed(false);
  }, [thumbSrc]);

  return (
    <div className={`file-card${selected ? " selected" : ""}`} data-file-id={file.id}>
      <button
        type="button"
        className="file-thumb-btn"
        onClick={() => (selectMode ? onToggleSelect?.(file.id) : onPreview(file))}
        aria-label={selectMode ? `Select ${file.originalName}` : `Preview ${file.originalName}`}
      >
        {downloadStatus && (
          <span className={`download-status-pill ${downloadStatus}`}>
            {downloadStatus === "downloading" ? "Downloading" : "Downloaded"}
          </span>
        )}
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
          <img
            key={thumbSrc}
            className="file-thumb"
            src={thumbSrc}
            alt=""
            loading="lazy"
            draggable={false}
            onError={() => setThumbFailed(true)}
          />
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
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
              <path
                d="M12 3v12m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </a>
        )}
      </div>
    </div>
  );
}
