import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { FilePublic, FolderPublic, RoomPublic } from "@shared/types";
import { LIMITS } from "@shared/types";
import {
  ApiError,
  clearStorage,
  createFolder,
  deleteFiles,
  downloadAllUrl,
  downloadFileToDisk,
  getRoomState,
} from "../api/client";
import { getSessionToken, saveSessionToken } from "../api/roomSession";
import CountdownTimer from "../components/CountdownTimer";
import CopyCodeButton from "../components/CopyCodeButton";
import CopyLinkButton from "../components/CopyLinkButton";
import FileCard from "../components/FileCard";
import FolderCard from "../components/FolderCard";
import NetworkSignal from "../components/NetworkSignal";
import PreviewModal from "../components/PreviewModal";
import StorageHistoryPanel from "../components/StorageHistoryPanel";
import StorageMeter from "../components/StorageMeter";
import UploadProgressList from "../components/UploadProgressList";
import { useUploads } from "../hooks/useUploads";
import { useRoomEvents } from "../hooks/useRoomEvents";

const GRID_SIZES = { small: 120, medium: 180, large: 260 } as const;

type LoadState =
  | { kind: "loading" }
  | { kind: "no-access" }
  | { kind: "ready"; room: RoomPublic; sessionToken: string }
  | { kind: "expired" }
  | { kind: "error"; message: string };

export default function Room() {
  const { roomId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [files, setFiles] = useState<FilePublic[]>([]);
  const [folders, setFolders] = useState<FolderPublic[]>([]);
  const [previewFileId, setPreviewFileId] = useState<string | null>(null);
  const [gridSize, setGridSize] = useState<"small" | "medium" | "large">("medium");
  const [folderStack, setFolderStack] = useState<FolderPublic[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [folderError, setFolderError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [downloadingSelected, setDownloadingSelected] = useState(false);
  const [downloadStatuses, setDownloadStatuses] = useState<Map<string, "downloading" | "done">>(new Map());
  const [actionError, setActionError] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [nameClicks, setNameClicks] = useState(0);
  const nameClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragCounter = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const marqueeDrag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    mode: "select" | "deselect";
    original: Set<string>;
    engaged: boolean;
  } | null>(null);
  const suppressNextClick = useRef(false);

  const currentFolderId = folderStack.length > 0 ? folderStack[folderStack.length - 1].id : null;

  const load = useCallback(async () => {
    // A shared link carries its own access token in the query string, so a
    // recipient never has to solve the gate themselves — pick it up once,
    // stash it in sessionStorage, and scrub it from the visible URL.
    const urlToken = searchParams.get("token");
    if (urlToken) {
      saveSessionToken(roomId, urlToken);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete("token");
        return next;
      }, { replace: true });
    }

    const token = urlToken ?? getSessionToken(roomId);
    if (!token) {
      setState({ kind: "no-access" });
      return;
    }
    try {
      const data = await getRoomState(roomId, token);
      setState({ kind: "ready", room: data.room, sessionToken: token });
      setFiles(data.files);
      setFolders(data.folders);
    } catch (err) {
      if (err instanceof ApiError && (err.code === "UNAUTHORIZED" || err.code === "ROOM_NOT_FOUND")) {
        setState({ kind: "no-access" });
      } else if (err instanceof ApiError && err.code === "ROOM_EXPIRED") {
        setState({ kind: "expired" });
      } else {
        setState({ kind: "error", message: err instanceof ApiError ? err.message : "Something went wrong." });
      }
    }
  }, [roomId, searchParams, setSearchParams]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(
    () => () => {
      if (nameClickTimer.current) clearTimeout(nameClickTimer.current);
    },
    []
  );

  const onUploaded = useCallback((file: FilePublic) => {
    setFiles((prev) => [...prev, file]);
  }, []);

  const onThumbnailReady = useCallback((fileId: string) => {
    setFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, hasThumbnail: true } : f)));
  }, []);

  const handleExtended = useCallback((newExpiresAt: number) => {
    setState((prev) => (prev.kind === "ready" ? { ...prev, room: { ...prev.room, expiresAt: newExpiresAt } } : prev));
  }, []);

  // Secret, like the corner countdown's 5-click extend: 10 clicks on the
  // room name/date reveals every storage this device remembers.
  const NAME_CLICKS_TO_REVEAL = 10;
  const NAME_CLICK_RESET_MS = 2000;

  function handleRoomNameClick() {
    if (nameClickTimer.current) clearTimeout(nameClickTimer.current);
    const next = nameClicks + 1;
    if (next >= NAME_CLICKS_TO_REVEAL) {
      setNameClicks(0);
      setShowHistory(true);
      return;
    }
    setNameClicks(next);
    nameClickTimer.current = setTimeout(() => setNameClicks(0), NAME_CLICK_RESET_MS);
  }

  const ready = state.kind === "ready";
  const { items, enqueueFiles, retry, dismiss } = useUploads(
    roomId,
    ready ? state.sessionToken : "",
    onUploaded,
    onThumbnailReady
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

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function selectAllVisible() {
    setSelectedIds(new Set(visibleFiles.map((f) => f.id)));
  }

  // Lightroom-style marquee select: press on a card (or empty grid space)
  // and drag — every card the rectangle touches gets added to the
  // selection, or removed if the drag started on an already-selected card.
  // Pointer Events unify mouse and touch, so the same code drives both.
  //
  // Move/up listeners go on `window`, not the grid element: relying on the
  // grid's own bubbled events (or element.setPointerCapture) stops tracking
  // the instant the pointer leaves the grid's box during a fast drag, and
  // in practice also proved unreliable with synthetic/automated pointer
  // input. A window-level listener, added only while a drag is in flight,
  // keeps tracking anywhere and is removed the moment the pointer lifts.
  const MARQUEE_THRESHOLD_PX = 6;

  function computeTouchedIds(rect: { left: number; right: number; top: number; bottom: number }): Set<string> {
    const touched = new Set<string>();
    gridRef.current?.querySelectorAll<HTMLElement>("[data-file-id]").forEach((el) => {
      const r = el.getBoundingClientRect();
      const intersects = r.right >= rect.left && r.left <= rect.right && r.bottom >= rect.top && r.top <= rect.bottom;
      if (intersects) {
        const id = el.dataset.fileId;
        if (id) touched.add(id);
      }
    });
    return touched;
  }

  function handleGridPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!selectMode || e.button !== 0) return;
    const targetEl = e.target as HTMLElement;
    if (targetEl.closest(".file-download, .folder-tile, .thumb-select-overlay")) return;

    const card = targetEl.closest<HTMLElement>("[data-file-id]");
    const startId = card?.dataset.fileId ?? null;
    const startSelected = startId ? selectedIds.has(startId) : false;

    const drag = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      mode: (startSelected ? "deselect" : "select") as "select" | "deselect",
      original: new Set(selectedIds),
      engaged: false,
    };
    marqueeDrag.current = drag;

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== drag.pointerId) return;
      const dx = ev.clientX - drag.startX;
      const dy = ev.clientY - drag.startY;
      if (!drag.engaged && Math.hypot(dx, dy) < MARQUEE_THRESHOLD_PX) return;
      if (!drag.engaged) {
        drag.engaged = true;
        suppressNextClick.current = true;
      }

      const rect = {
        left: Math.min(drag.startX, ev.clientX),
        right: Math.max(drag.startX, ev.clientX),
        top: Math.min(drag.startY, ev.clientY),
        bottom: Math.max(drag.startY, ev.clientY),
      };
      setMarquee({ left: rect.left, top: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top });

      const touched = computeTouchedIds(rect);
      const next = new Set(drag.original);
      touched.forEach((id) => {
        if (drag.mode === "select") next.add(id);
        else next.delete(id);
      });
      setSelectedIds(next);
    };

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== drag.pointerId) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      marqueeDrag.current = null;
      setMarquee(null);
      if (drag.engaged) {
        // The browser still fires a trailing click on whatever's under the
        // pointer once it lifts — swallow exactly that one so a drag-end
        // doesn't also toggle a card a second time via its own onClick.
        setTimeout(() => {
          suppressNextClick.current = false;
        }, 0);
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function handleGridClickCapture(e: React.MouseEvent<HTMLDivElement>) {
    if (suppressNextClick.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  // Downloads the selection one file at a time instead of zipping them —
  // each file only starts once the previous one has fully arrived, so the
  // per-card pill (gray "Downloading" -> green "Downloaded") always matches
  // what's actually happening instead of firing every request at once.
  async function handleDownloadSelected() {
    if (!ready || selectedIds.size === 0 || downloadingSelected) return;
    const ids = Array.from(selectedIds);

    setDownloadingSelected(true);
    for (const id of ids) {
      const file = files.find((f) => f.id === id);
      if (!file) continue;

      setDownloadStatuses((prev) => new Map(prev).set(id, "downloading"));
      try {
        await downloadFileToDisk(roomId, id, file.originalName, state.sessionToken);
        setDownloadStatuses((prev) => new Map(prev).set(id, "done"));
      } catch (err) {
        setDownloadStatuses((prev) => {
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
        setActionError(err instanceof ApiError ? err.message : `Couldn't download ${file.originalName}.`);
      }
    }
    setDownloadingSelected(false);
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

  if (state.kind === "no-access") {
    return (
      <div className="page">
        <div className="container">
          <Link to="/" className="brand">
            SHARIZZ
          </Link>
          <div className="card">
            <span className="headline" style={{ fontSize: 20 }}>
              This link is invalid or has expired.
            </span>
            <p className="subtext">Ask whoever shared this storage for a fresh link.</p>
            <Link to="/" className="btn btn-primary btn-block">
              Back to Sharizz
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (state.kind === "expired") {
    return (
      <div className="page">
        <div className="container">
          <Link to="/" className="brand">
            SHARIZZ
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

  if (showHistory) {
    return <StorageHistoryPanel onBack={() => setShowHistory(false)} currentRoomId={roomId} />;
  }

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

      <div className="container container-compact">
        {/* Countdown renders itself fixed to the bottom-right corner, so its
            position in the markup is irrelevant — kept out of the header row. */}
        <CountdownTimer expiresAt={room.expiresAt} />

        <div className="room-header">
          <div className="toolbar-group">
            <NetworkSignal />
            <h1 className="room-name" onClick={handleRoomNameClick}>
              {room.roomName}
            </h1>
          </div>
          <div className="toolbar-group">
            <CopyLinkButton roomId={room.id} sessionToken={sessionToken} />
            <CopyCodeButton code={room.roomCode} />
          </div>
        </div>

        {folderStack.length > 0 && (
          <div className="breadcrumb">
            <button type="button" onClick={() => setFolderStack([])}>
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
        )}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,video/*,.heic,.heif,.dng,.mov"
          style={{ display: "none" }}
          onChange={(e) => {
            handleFilesChosen(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <div className="toolbar-row">
          <div className="toolbar-group">
            <button type="button" className="btn btn-primary btn-small" onClick={() => fileInputRef.current?.click()}>
              + Upload
            </button>
            <button type="button" className="btn btn-secondary btn-small" onClick={() => setShowNewFolder((v) => !v)}>
              + Folder
            </button>
          </div>
          <div className="toolbar-group">
            {visibleFiles.length > 0 && (
              <div className="grid-controls" role="group" aria-label="Grid size">
                {(Object.keys(GRID_SIZES) as Array<keyof typeof GRID_SIZES>).map((size) => (
                  <button
                    key={size}
                    type="button"
                    className={`grid-size-btn${gridSize === size ? " active" : ""}`}
                    onClick={() => setGridSize(size)}
                  >
                    {size === "small" ? "S" : size === "medium" ? "M" : "L"}
                  </button>
                ))}
              </div>
            )}
            {files.length > 0 && !selectMode && (
              <button type="button" className="btn btn-secondary btn-small" onClick={() => setSelectMode(true)}>
                Select
              </button>
            )}
            {selectMode && (
              <>
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={selectAllVisible}
                  disabled={visibleFiles.length === 0}
                >
                  Select All
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={clearSelection}
                  disabled={selectedIds.size === 0}
                >
                  Clear Selection
                </button>
              </>
            )}
          </div>
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

        {!hasContent ? (
          <div className="empty-state">No files yet. Upload the first one above, or drag files in.</div>
        ) : (
          <div
            ref={gridRef}
            className="file-list"
            style={{
              ["--tile-size" as string]: `${GRID_SIZES[gridSize]}px`,
              // Marquee-select needs the drag gesture itself, not a page
              // scroll, once you're in select mode — see handleGridPointerDown.
              touchAction: selectMode ? "none" : undefined,
            }}
            onPointerDown={handleGridPointerDown}
            onClickCapture={handleGridClickCapture}
          >
            {visibleFolders.map((folder) => (
              <FolderCard key={folder.id} folder={folder} onOpen={(f) => setFolderStack((prev) => [...prev, f])} />
            ))}
            {visibleFiles.map((file) => (
              <FileCard
                key={file.id}
                file={file}
                roomId={room.id}
                sessionToken={sessionToken}
                onPreview={(f) => setPreviewFileId(f.id)}
                selectMode={selectMode}
                selected={selectedIds.has(file.id)}
                onToggleSelect={toggleSelect}
                downloadStatus={downloadStatuses.get(file.id)}
              />
            ))}
          </div>
        )}

        {marquee && (
          <div
            className="marquee-select"
            style={{ left: marquee.left, top: marquee.top, width: marquee.width, height: marquee.height }}
          />
        )}

        {actionError && <div className="error-banner">{actionError}</div>}

        {files.length > 0 && !selectMode && (
          <div className="action-row">
            {files.length > 1 && (
              <a className="btn btn-secondary btn-small" href={downloadAllUrl(room.id, sessionToken)}>
                Download All
              </a>
            )}
            <button type="button" className="btn btn-danger btn-small" onClick={handleClearStorage} disabled={clearing}>
              {clearing ? "Clearing…" : "Clear Storage"}
            </button>
          </div>
        )}

        <StorageMeter
          usedBytes={files.reduce((sum, f) => sum + f.fileSize, 0)}
          limitBytes={room.storageLimitBytes}
          roomId={room.id}
          sessionToken={sessionToken}
          onExtended={handleExtended}
        />
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
                <button
                  type="button"
                  className="btn btn-primary btn-small"
                  onClick={handleDownloadSelected}
                  disabled={downloadingSelected}
                >
                  {downloadingSelected ? "Downloading…" : `Download (${selectedIds.size})`}
                </button>
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

      {previewFileId && visibleFiles.some((f) => f.id === previewFileId) && (
        <PreviewModal
          files={visibleFiles}
          initialFileId={previewFileId}
          roomId={room.id}
          sessionToken={sessionToken}
          selectedIds={selectedIds}
          onToggleSelect={(fileId) => {
            if (!selectMode) setSelectMode(true);
            toggleSelect(fileId);
          }}
          onClose={() => setPreviewFileId(null)}
        />
      )}
    </div>
  );
}
