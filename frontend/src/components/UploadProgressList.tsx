import type { UploadItem } from "../hooks/useUploads";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = -1;
  do {
    value /= 1024;
    unitIndex++;
  } while (value >= 1024 && unitIndex < units.length - 1);
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

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
    <div className="card">
      <span className="field label" style={{ fontWeight: 700 }}>
        Uploading {items.length} file{items.length > 1 ? "s" : ""}
      </span>
      <div className="file-list">
        {items.map((item) => (
          <div key={item.key} className="file-card" style={{ flexDirection: "column", alignItems: "stretch" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span className="file-name">{item.file.name}</span>
              <span className="file-meta">{formatBytes(item.file.size)}</span>
            </div>
            <div className="progress-track">
              <div
                className={`progress-fill ${item.status === "success" ? "success" : ""} ${
                  item.status === "error" ? "error" : ""
                }`}
                style={{ width: `${item.progress}%` }}
              />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
              <span className="file-meta">
                {item.status === "uploading" && `${item.progress}%`}
                {item.status === "success" && "Complete"}
                {item.status === "error" && (item.error ?? "Upload failed")}
              </span>
              {item.status === "error" && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="button" className="btn btn-secondary btn-small" onClick={() => onRetry(item.key)}>
                    Retry
                  </button>
                  <button type="button" className="btn btn-secondary btn-small" onClick={() => onDismiss(item.key)}>
                    Dismiss
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
