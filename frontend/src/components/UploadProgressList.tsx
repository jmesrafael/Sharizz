import type { UploadItem } from "../hooks/useUploads";

export default function UploadProgressList({
  items,
  onRetry,
  onDismiss,
}: {
  items: UploadItem[];
  onRetry: (key: string) => void;
  onDismiss: (key: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <div className="upload-progress-list">
      {items.map((item) => (
        <div key={item.key} className="upload-progress-item">
          <div className="progress-track">
            <div
              className={`progress-fill${item.status === "error" ? " error" : ""}`}
              style={{ width: `${item.progress}%` }}
            />
          </div>
          <span className="file-meta upload-progress-status">
            {item.status === "uploading" ? `${item.progress}%` : item.error ?? "Upload failed"}
          </span>
          {item.status === "error" && (
            <div className="upload-progress-actions">
              <button type="button" className="btn btn-secondary btn-small" onClick={() => onRetry(item.key)}>
                Retry
              </button>
              <button type="button" className="btn btn-secondary btn-small" onClick={() => onDismiss(item.key)}>
                Dismiss
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
