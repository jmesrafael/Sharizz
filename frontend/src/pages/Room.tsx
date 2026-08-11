import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { FilePublic, RoomPublic } from "@shared/types";
import { ApiError, downloadAllUrl, enterRoom, getRoomState } from "../api/client";
import { getSessionToken, saveSessionToken } from "../api/roomSession";
import CountdownTimer from "../components/CountdownTimer";
import CopyLinkButton from "../components/CopyLinkButton";
import FileCard from "../components/FileCard";
import PreviewModal from "../components/PreviewModal";
import UploadProgressList from "../components/UploadProgressList";
import { useUploads } from "../hooks/useUploads";
import { useRoomEvents } from "../hooks/useRoomEvents";

type LoadState =
  | { kind: "loading" }
  | { kind: "needs-pin" }
  | { kind: "ready"; room: RoomPublic; sessionToken: string }
  | { kind: "expired" }
  | { kind: "error"; message: string };

export default function Room() {
  const { roomId = "" } = useParams();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [files, setFiles] = useState<FilePublic[]>([]);
  const [previewFile, setPreviewFile] = useState<FilePublic | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const token = getSessionToken(roomId);
    if (!token) {
      setState({ kind: "needs-pin" });
      return;
    }
    try {
      const data = await getRoomState(roomId, token);
      setState({ kind: "ready", room: data.room, sessionToken: token });
      setFiles(data.files);
    } catch (err) {
      if (err instanceof ApiError && (err.code === "UNAUTHORIZED" || err.code === "ROOM_NOT_FOUND")) {
        setState({ kind: "needs-pin" });
      } else if (err instanceof ApiError && err.code === "ROOM_EXPIRED") {
        setState({ kind: "expired" });
      } else {
        setState({ kind: "error", message: err instanceof ApiError ? err.message : "Something went wrong." });
      }
    }
  }, [roomId]);

  useEffect(() => {
    load();
  }, [load]);

  const onUploaded = useCallback((file: FilePublic) => {
    setFiles((prev) => [...prev, file]);
  }, []);

  const ready = state.kind === "ready";
  const { items, enqueueFiles, retry, dismiss } = useUploads(
    roomId,
    ready ? state.sessionToken : "",
    onUploaded
  );

  useRoomEvents(
    roomId,
    ready ? state.sessionToken : "",
    (updated) => setFiles(updated),
    () => setState({ kind: "expired" })
  );

  if (state.kind === "loading") {
    return (
      <div className="page">
        <div className="container">
          <p className="subtext">Loading room…</p>
        </div>
      </div>
    );
  }

  if (state.kind === "needs-pin") {
    return <PinGate roomId={roomId} onEntered={load} />;
  }

  if (state.kind === "expired") {
    return (
      <div className="page">
        <div className="container">
          <Link to="/" className="brand">
            SHA<span className="brand-mark">RIZZ</span>
          </Link>
          <div className="card">
            <span className="headline" style={{ fontSize: 20 }}>
              This storage room has expired.
            </span>
            <p className="subtext">All files have been permanently deleted.</p>
            <Link to="/" className="btn btn-primary btn-block">
              Back to Sharizz
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="page">
        <div className="container">
          <div className="error-banner">{state.message}</div>
        </div>
      </div>
    );
  }

  const { room, sessionToken } = state;

  return (
    <div className="page">
      <div className="container">
        <div className="room-header">
          <h1 className="room-name">{room.roomName}</h1>
          <p className="subtext">Original files. No compression.</p>
          <CountdownTimer expiresAt={room.expiresAt} />
        </div>

        <div className="share-row">
          <CopyLinkButton roomId={room.id} />
        </div>

        <div className="upload-zone">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,video/*,.heic,.heif"
            style={{ display: "none" }}
            onChange={(e) => {
              const selected = Array.from(e.target.files ?? []);
              if (selected.length > 0) enqueueFiles(selected);
              e.target.value = "";
            }}
          />
          <button type="button" className="btn btn-primary" onClick={() => fileInputRef.current?.click()}>
            + Upload Files
          </button>
        </div>

        <UploadProgressList items={items} onRetry={retry} onDismiss={dismiss} />

        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>Files</h2>
          {files.length === 0 ? (
            <div className="empty-state">No files yet. Upload the first one above.</div>
          ) : (
            <div className="file-list">
              {files.map((file) => (
                <FileCard
                  key={file.id}
                  file={file}
                  roomId={room.id}
                  sessionToken={sessionToken}
                  onPreview={setPreviewFile}
                />
              ))}
            </div>
          )}
        </div>

        {files.length > 1 && (
          <a className="btn btn-secondary btn-block" href={downloadAllUrl(room.id, sessionToken)}>
            Download All
          </a>
        )}
      </div>

      {previewFile && (
        <PreviewModal
          file={previewFile}
          roomId={room.id}
          sessionToken={sessionToken}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </div>
  );
}

function PinGate({ roomId, onEntered }: { roomId: string; onEntered: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { room, sessionToken } = await enterRoom(roomId, pin);
      saveSessionToken(room.id, sessionToken);
      onEntered();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page">
      <div className="container">
        <Link to="/" className="brand">
          SHA<span className="brand-mark">RIZZ</span>
        </Link>
        <h1 className="headline">Enter Room PIN</h1>
        <form className="card" onSubmit={handleSubmit}>
          <div className="field">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="••••"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
              minLength={4}
              maxLength={8}
              autoComplete="off"
              autoFocus
              required
            />
          </div>
          {error && <div className="error-banner">{error}</div>}
          <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
            {submitting ? "Entering…" : "Enter Room"}
          </button>
        </form>
      </div>
    </div>
  );
}
