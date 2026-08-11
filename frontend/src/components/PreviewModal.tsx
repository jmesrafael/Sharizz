import { useEffect, useRef, useState } from "react";
import type { FilePublic } from "@shared/types";
import { downloadFileUrl } from "../api/client";

const SWIPE_THRESHOLD_PX = 50;

interface Props {
  files: FilePublic[];
  initialFileId: string;
  roomId: string;
  sessionToken: string;
  selectedIds: Set<string>;
  onToggleSelect: (fileId: string) => void;
  onClose: () => void;
}

export default function PreviewModal({
  files,
  initialFileId,
  roomId,
  sessionToken,
  selectedIds,
  onToggleSelect,
  onClose,
}: Props) {
  const [index, setIndex] = useState(() => Math.max(files.findIndex((f) => f.id === initialFileId), 0));
  const [unsupported, setUnsupported] = useState(false);
  const touchStartX = useRef<number | null>(null);

  const file = files[index];
  const canPrev = index > 0;
  const canNext = index < files.length - 1;

  useEffect(() => {
    setUnsupported(false);
  }, [file?.id]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && canPrev) setIndex((i) => i - 1);
      else if (e.key === "ArrowRight" && canNext) setIndex((i) => i + 1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canPrev, canNext, onClose]);

  if (!file) return null;

  const url = downloadFileUrl(roomId, file.id, sessionToken);
  const isImage = file.mimeType.startsWith("image/");
  const isVideo = file.mimeType.startsWith("video/");
  const selected = selectedIds.has(file.id);

  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
  }

  function onTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null) return;
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (delta > SWIPE_THRESHOLD_PX && canPrev) setIndex((i) => i - 1);
    else if (delta < -SWIPE_THRESHOLD_PX && canNext) setIndex((i) => i + 1);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="lightbox"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div className="lightbox-topbar">
          <button type="button" className="lightbox-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
          <label className="lightbox-select">
            <input type="checkbox" checked={selected} onChange={() => onToggleSelect(file.id)} />
            Select
          </label>
        </div>

        <div className="lightbox-stage">
          {canPrev && (
            <button
              type="button"
              className="lightbox-nav lightbox-nav-prev"
              onClick={() => setIndex((i) => i - 1)}
              aria-label="Previous"
            >
              ‹
            </button>
          )}

          <div className="modal-content">
            {!unsupported && isImage && (
              <img src={url} alt={file.originalName} onError={() => setUnsupported(true)} />
            )}
            {!unsupported && isVideo && (
              <video key={file.id} src={url} controls autoPlay onError={() => setUnsupported(true)} />
            )}
            {(unsupported || (!isImage && !isVideo)) && (
              <div className="card">
                <span className="file-name">{file.originalName}</span>
                <span className="file-meta">
                  This browser can't preview this file type. Download it to view the original.
                </span>
                <a className="btn btn-primary" href={url} download={file.originalName}>
                  Download
                </a>
              </div>
            )}
          </div>

          {canNext && (
            <button
              type="button"
              className="lightbox-nav lightbox-nav-next"
              onClick={() => setIndex((i) => i + 1)}
              aria-label="Next"
            >
              ›
            </button>
          )}
        </div>

        <div className="lightbox-footer">
          <span className="file-name" title={file.originalName}>
            {file.originalName}
          </span>
          <span className="lightbox-counter">
            {index + 1} / {files.length}
          </span>
        </div>
      </div>
    </div>
  );
}
