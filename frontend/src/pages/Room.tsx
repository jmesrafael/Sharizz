import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { FilePublic, FolderPublic, RoomPublic } from "@shared/types";
import { LIMITS } from "@shared/types";
import {
  ApiError,
  clearStorage,
  createFolder,
  deleteFiles,
  downloadAllUrl,
  downloadSelectedUrl,
  enterRoom,
  getRoomState,
} from "../api/client";
import { getSessionToken, saveSessionToken } from "../api/roomSession";
import CountdownTimer from "../components/CountdownTimer";
import CopyLinkButton from "../components/CopyLinkButton";
import FileCard from "../components/FileCard";
import FolderCard from "../components/FolderCard";
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
  const [folders, setFolders] = useState<FolderPublic[]>([]);
  const [previewFile, setPreviewFile] = useState<FilePublic | null>(null);
  const [tileSize, setTileSize] = useState(140);
  const [folderStack, setFolderStack] = useState<FolderPublic[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [folderError, setFolderError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const dragCounter = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentFolderId = folderStack.length > 0 ? folderStack[folderStack.length - 1].id : null;

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
      setFolders(data.folders);
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
    (update) => {
      setFiles(update.files);
      setFolders(update.folders);
    },
    () => setState({ kind: "expired" })
  );

  const visibleFolders = useMemo(
    () => folders.filter((f) => f.parentFolderId === currentFolderId),
    [folders, currentFolderId]
  );
  const visibleFiles = useMemo(
    () => files.filter((f) => f.folderId === currentFolderId),
    [files, currentFolderId]
  );

  function handleFilesChosen(chosen: File[]) {
    if (chosen.length > 0) enqueueFiles(chosen, currentFolderId);
  }

  function onDragEnter(e: React.DragEvent) {
    e.preventDefault();
    if (!e.dataTransfer.types.includes("Files")) return;
    dragCounter.current += 1;
    setDragActive(true);
  }

  function onDragLeave(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDragActive(false);
    }
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current = 0;
    setDragActive(false);
    const dropped = Array.from(e.dataTransfer.files ?? []);
    handleFilesChosen(dropped);
  }

  function toggleSelect(fileId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  async function handleDeleteSelected() {
    if (!ready || selectedIds.size === 0) return;
    const count = selectedIds.size;
    if (!window.confirm(`Delete ${count} selected file${count === 1 ? "" : "s"}? This can't be undone.`)) return;

    setActionError(null);
    setDeleting(true);
    try {
      const ids = Array.from(selectedIds);
      const { deletedIds } = await deleteFiles(roomId, state.sessionToken, ids);
      const deletedSet = new Set(deletedIds);
      setFiles((prev) => prev.filter((f) => !deletedSet.has(f.id)));
      exitSelectMode();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Couldn't delete the selected files.");
    } finally {
      setDeleting(false);
    }
  }

  async function handleClearStorage() {
    if (!ready) return;
    if (
      !window.confirm(
        "Clear all storage? This permanently deletes every file and folder in this room to free up space. This can't be undone."
      )
    )
      return;

    setActionError(null);
    setClearing(true);
    try {
      await clearStorage(roomId, state.sessionToken);
      setFiles([]);
      setFolders([]);
      setFolderStack([]);
      exitSelectMode();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Couldn't clear storage.");
    } finally {
      setClearing(false);
    }
  }

  async function handleCreateFolder(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setFolderError(null);
    const trimmed = newFolderName.trim();
    if (trimmed.length < LIMITS.MIN_FOLDER_NAME_LENGTH) {
      setFolderError("Folder name is required.");
      return;
    }
    try {
      const folder = await createFolder(roomId, state.sessionToken, trimmed, currentFolderId);
      setFolders((prev) => [...prev, folder]);
      setNewFolderName("");
      setShowNewFolder(false);
    } catch (err) {
      setFolderError(err instanceof ApiError ? err.message : "Couldn't create folder.");
    }
  }

  if (state.kind === "loading") {
    return (
      <div className="page">
        <div className="container">
          <p className="subtext">Loading storage…</p>
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
              This storage has expired.
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
  const hasContent = visibleFiles.length > 0 || visibleFolders.length > 0;

  return (
    <div
      className="page"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {dragActive && (
        <div className="drop-overlay">
          <div className="drop-overlay-inner">Drop files to upload</div>
        </div>
      )}

      <div className="container">
        <div className="room-header">
          <h1 className="room-name">{room.roomName}</h1>
          <p className="subtext">Original files. No compression.</p>
          <CountdownTimer expiresAt={room.expiresAt} />
        </div>

        <div className="share-row">
          <CopyLinkButton roomId={room.id} />
        </div>

        <div className="breadcrumb">
          <button
            type="button"
            className={folderStack.length === 0 ? "current" : ""}
            onClick={() => setFolderStack([])}
          >
            {room.roomName}
          </button>
          {folderStack.map((folder, i) => (
            <span key={folder.id} style={{ display: "contents" }}>
              <span className="breadcrumb-sep">/</span>
              <button
                type="button"
                className={i === folderStack.length - 1 ? "current" : ""}
                onClick={() => setFolderStack(folderStack.slice(0, i + 1))}
              >
                {folder.folderName}
              </button>
            </span>
          ))}
        </div>

        <div className="upload-zone">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,video/*,.heic,.heif"
            style={{ display: "none" }}
            onChange={(e) => {
              handleFilesChosen(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <div className="toolbar-row" style={{ justifyContent: "center" }}>
            <button type="button" className="btn btn-primary" onClick={() => fileInputRef.current?.click()}>
              + Upload Files
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setShowNewFolder((v) => !v)}>
              + New Folder
            </button>
          </div>
          <p className="upload-hint">Drag and drop files anywhere on this page to upload</p>
        </div>

        {showNewFolder && (
          <form className="new-folder-form" onSubmit={handleCreateFolder}>
            <input
              type="text"
              placeholder="Folder name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              maxLength={LIMITS.MAX_FOLDER_NAME_LENGTH}
              autoFocus
            />
            <button type="submit" className="btn btn-primary btn-small">
              Create
            </button>
          </form>
        )}
        {folderError && <div className="error-banner">{folderError}</div>}

        <UploadProgressList items={items} onRetry={retry} onDismiss={dismiss} />

        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Files</h2>
            <div className="toolbar-row" style={{ alignItems: "center" }}>
              {visibleFiles.length > 0 && (
                <div className="grid-controls">
                  <label htmlFor="gridSize">Size</label>
                  <input
                    id="gridSize"
                    type="range"
                    min={90}
                    max={260}
                    step={10}
                    value={tileSize}
                    onChange={(e) => setTileSize(Number(e.target.value))}
                  />
                </div>
              )}
              {files.length > 0 && !selectMode && (
                <button type="button" className="btn btn-secondary btn-small" onClick={() => setSelectMode(true)}>
                  Select
                </button>
              )}
            </div>
          </div>

          {!hasContent ? (
            <div className="empty-state">No files yet. Upload the first one above, or drag files in.</div>
          ) : (
            <div className="file-list" style={{ ["--tile-size" as string]: `${tileSize}px` }}>
              {visibleFolders.map((folder) => (
                <FolderCard key={folder.id} folder={folder} onOpen={(f) => setFolderStack((prev) => [...prev, f])} />
              ))}
              {visibleFiles.map((file) => (
                <FileCard
                  key={file.id}
                  file={file}
                  roomId={room.id}
                  sessionToken={sessionToken}
                  onPreview={setPreviewFile}
                  selectMode={selectMode}
                  selected={selectedIds.has(file.id)}
                  onToggleSelect={toggleSelect}
                />
              ))}
            </div>
          )}
        </div>

        {actionError && <div className="error-banner">{actionError}</div>}

        {files.length > 1 && !selectMode && (
          <a className="btn btn-secondary btn-block" href={downloadAllUrl(room.id, sessionToken)}>
            Download All
          </a>
        )}

        {files.length > 0 && !selectMode && (
          <button type="button" className="btn btn-danger btn-block" onClick={handleClearStorage} disabled={clearing}>
            {clearing ? "Clearing…" : "Clear Storage"}
          </button>
        )}
      </div>

      {selectMode && (
        <div className="select-bar">
          <span className="select-bar-count">{selectedIds.size} selected</span>
          <div className="select-bar-actions">
            <button type="button" className="btn btn-secondary btn-small" onClick={exitSelectMode}>
              Cancel
            </button>
            {selectedIds.size > 0 && (
              <>
                <a
                  className="btn btn-primary btn-small"
                  href={downloadSelectedUrl(room.id, sessionToken, Array.from(selectedIds))}
                >
                  Download ({selectedIds.size})
                </a>
                <button
                  type="button"
                  className="btn btn-danger btn-small"
                  onClick={handleDeleteSelected}
                  disabled={deleting}
                >
                  {deleting ? "Deleting…" : "Delete"}
                </button>
              </>
            )}
          </div>
        </div>
      )}

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
        <h1 className="headline">Enter Storage PIN</h1>
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
            {submitting ? "Entering…" : "Enter Storage"}
          </button>
        </form>
      </div>
    </div>
  );
}
