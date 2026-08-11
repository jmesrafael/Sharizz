import { useState } from "react";
import type { FilePublic } from "@shared/types";
import { downloadFileUrl } from "../api/client";

interface Props {
  file: FilePublic;
  roomId: string;
  sessionToken: string;
  onClose: () => void;
}

export default function PreviewModal({ file, roomId, sessionToken, onClose }: Props) {
  const [unsupported, setUnsupported] = useState(false);
  const url = downloadFileUrl(roomId, file.id, sessionToken);
  const isImage = file.mimeType.startsWith("image/");
  const isVideo = file.mimeType.startsWith("video/");

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        {!unsupported && isImage && (
          <img src={url} alt={file.originalName} onError={() => setUnsupported(true)} />
        )}
        {!unsupported && isVideo && (
          <video src={url} controls autoPlay onError={() => setUnsupported(true)} />
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
        <button type="button" className="btn btn-secondary btn-block" style={{ marginTop: 12 }} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
