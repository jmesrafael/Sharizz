import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, deleteRoom, getRoomState } from "../api/client";
import { clearRoomHistory, getRoomHistory, removeRoomFromHistory } from "../api/roomHistory";

interface LiveEntry {
  id: string;
  sessionToken: string;
  roomName: string;
  expiresAt: number;
}

function hoursLeftLabel(expiresAt: number): string {
  const hours = Math.max(0, Math.ceil((expiresAt - Date.now()) / (1000 * 60 * 60)));
  if (hours <= 0) return "expiring soon";
  return `${hours}h left`;
}

export default function StorageHistoryPanel({
  onBack,
  currentRoomId,
}: {
  onBack: () => void;
  currentRoomId: string;
}) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<LiveEntry[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const history = getRoomHistory();
      const results = await Promise.all(
        history.map(async (h): Promise<LiveEntry | null> => {
          try {
            const data = await getRoomState(h.id, h.sessionToken);
            return { id: h.id, sessionToken: h.sessionToken, roomName: data.room.roomName, expiresAt: data.room.expiresAt };
          } catch (err) {
            // Gone (expired and swept, or never existed) — stop remembering it.
            if (err instanceof ApiError && (err.code === "ROOM_NOT_FOUND" || err.code === "ROOM_EXPIRED")) {
              removeRoomFromHistory(h.id);
            }
            return null;
          }
        })
      );
      if (!cancelled) {
        setEntries(results.filter((r): r is LiveEntry => r !== null));
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCopy(entry: LiveEntry) {
    const link = `${window.location.origin}/room/${entry.id}?token=${encodeURIComponent(entry.sessionToken)}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopiedId(entry.id);
      setTimeout(() => setCopiedId((c) => (c === entry.id ? null : c)), 2000);
    } catch {
      // clipboard access denied — no-op
    }
  }

  async function handleDelete(entry: LiveEntry) {
    if (!window.confirm(`Delete this storage? Everything in it is gone for good. This can't be undone.`)) return;
    setDeletingId(entry.id);
    try {
      await deleteRoom(entry.id, entry.sessionToken);
    } catch {
      // Even if the request failed (e.g. already gone), stop remembering it locally.
    }
    removeRoomFromHistory(entry.id);
    setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    setDeletingId(null);
    if (entry.id === currentRoomId) navigate("/", { replace: true });
  }

  async function handleDeleteAll() {
    if (entries.length === 0) return;
    if (
      !window.confirm(
        `Delete all ${entries.length} storage${entries.length === 1 ? "" : "s"}? Everything in every one of them is gone for good. This can't be undone.`
      )
    )
      return;

    setDeletingAll(true);
    await Promise.all(entries.map((e) => deleteRoom(e.id, e.sessionToken).catch(() => {})));
    clearRoomHistory();
    const hadCurrent = entries.some((e) => e.id === currentRoomId);
    setEntries([]);
    setDeletingAll(false);
    if (hadCurrent) navigate("/", { replace: true });
  }

  return (
    <div className="page">
      <div className="container container-compact">
        <div className="room-header">
          <span className="brand">SHARIZZ</span>
          <button type="button" className="btn btn-secondary btn-small" onClick={onBack}>
            Back
          </button>
        </div>

        {loading ? (
          <p className="subtext">Loading…</p>
        ) : entries.length === 0 ? (
          <div className="empty-state">No storages remembered on this device.</div>
        ) : (
          <>
            <div className="history-list">
              {entries.map((entry, i) => (
                <div key={entry.id} className="history-row">
                  <div className="history-row-main">
                    <span className="history-row-label">Storage {i + 1}</span>
                    <span className="history-row-meta">{hoursLeftLabel(entry.expiresAt)}</span>
                  </div>
                  <div className="history-row-actions">
                    <button type="button" className="btn btn-secondary btn-small" onClick={() => handleCopy(entry)}>
                      {copiedId === entry.id ? "Copied!" : "Copy Link"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger btn-small"
                      onClick={() => handleDelete(entry)}
                      disabled={deletingId === entry.id}
                    >
                      {deletingId === entry.id ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <button type="button" className="btn btn-danger btn-block" onClick={handleDeleteAll} disabled={deletingAll}>
              {deletingAll ? "Deleting…" : "Delete All"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
