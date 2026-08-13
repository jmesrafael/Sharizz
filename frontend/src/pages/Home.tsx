import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LIMITS } from "@shared/types";
import { createRoom, ApiError } from "../api/client";
import { saveSessionToken } from "../api/roomSession";
import { addRoomToHistory, getRoomHistory, type RoomHistoryEntry } from "../api/roomHistory";

const FALLBACK_LOCKOUT_MS = 60 * 1000;

function timeLeftLabel(createdAt: number): string {
  const msLeft = createdAt + LIMITS.ROOM_LIFETIME_MS - Date.now();
  if (msLeft <= 0) return "expiring soon";
  const hours = Math.ceil(msLeft / (1000 * 60 * 60));
  return `${hours}h left`;
}

export default function Home() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const unlockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [history, setHistory] = useState<RoomHistoryEntry[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const locked = lockedUntil !== null;

  useEffect(() => {
    // Rooms are self-computed as 24h from creation — no network call needed
    // just to show a countdown, and a stale/expired entry left over from a
    // past visit quietly drops out of the list instead of lingering forever.
    const now = Date.now();
    const live = getRoomHistory().filter((h) => h.createdAt + LIMITS.ROOM_LIFETIME_MS > now);
    setHistory(live);
  }, []);

  useEffect(() => {
    return () => {
      if (unlockTimer.current) clearTimeout(unlockTimer.current);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { room, sessionToken } = await createRoom(code);
      saveSessionToken(room.id, sessionToken);
      addRoomToHistory({ id: room.id, roomName: room.roomName, sessionToken, createdAt: room.createdAt });

      // Best-effort: copy the guest link immediately so it's already on the
      // clipboard the moment the room exists, in case sharing it is the
      // very next thing that happens. Clipboard access can be silently
      // denied by the browser — that's fine, Copy Link in the room still
      // works as a fallback.
      try {
        const link = `${window.location.origin}/room/${room.id}?token=${encodeURIComponent(sessionToken)}`;
        await navigator.clipboard.writeText(link);
      } catch {
        // no-op
      }

      navigate(`/room/${room.id}`, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === "TOO_MANY_ATTEMPTS") {
        // The message says "1 hour" as a deterrent, but the real wait
        // (retryAfterMs) is short — hide the form for exactly that long,
        // then quietly let them try again without drawing attention to how
        // short it actually was.
        setError(err.message);
        setAttemptsRemaining(null);
        setCode("");
        const waitMs = err.retryAfterMs ?? FALLBACK_LOCKOUT_MS;
        setLockedUntil(Date.now() + waitMs);
        if (unlockTimer.current) clearTimeout(unlockTimer.current);
        unlockTimer.current = setTimeout(() => {
          setLockedUntil(null);
          setError(null);
        }, waitMs);
      } else if (err instanceof ApiError && err.code === "INVALID_CODE") {
        setError(err.message);
        setAttemptsRemaining(err.attemptsRemaining ?? null);
        setCode("");
      } else {
        setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
        setAttemptsRemaining(null);
        setCode("");
      }
    } finally {
      setSubmitting(false);
    }
  }

  function toggleExpanded(id: string) {
    setJoinError(null);
    setJoinCode("");
    setExpandedId((prev) => (prev === id ? null : id));
  }

  // Re-authenticates a room this device already knows about by re-typing
  // its storage code — the same "/api/rooms" endpoint that creates a room
  // for a time-code also joins an existing one for its room code, so this
  // is just that flow with a fresh session token guaranteed at the end
  // (useful when the token saved in local history has since expired even
  // though the room itself is still live).
  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    setJoinError(null);
    setJoining(true);
    try {
      const { room, sessionToken } = await createRoom(joinCode);
      saveSessionToken(room.id, sessionToken);
      addRoomToHistory({ id: room.id, roomName: room.roomName, sessionToken, createdAt: room.createdAt });
      navigate(`/room/${room.id}`, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && (err.code === "INVALID_CODE" || err.code === "TOO_MANY_ATTEMPTS")) {
        setJoinError(err.message);
      } else {
        setJoinError(err instanceof ApiError ? err.message : "Couldn't open that storage.");
      }
      setJoinCode("");
    } finally {
      setJoining(false);
    }
  }

  return (
    <div className="page">
      <div className="container">
        <span className="brand">SHARIZZ</span>

        <blockquote className="riddle">
          This thing all devours:
          <br />
          Birds, beasts, trees, flowers;
          <br />
          Gnaws iron, bites steel;
          <br />
          Grinds hard stones to meal;
          <br />
          Slays king, ruins town,
          <br />
          And beats high mountain down.
        </blockquote>

        {locked ? (
          <div className="card">
            {error && <div className="error-banner">{error}</div>}
          </div>
        ) : (
          <form className="card" onSubmit={handleSubmit}>
            <div className="field">
              <label htmlFor="code">Password</label>
              <div className="password-input-wrap">
                <input
                  id="code"
                  type={showCode ? "text" : "password"}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="Password"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  minLength={4}
                  maxLength={6}
                  autoComplete="off"
                  autoFocus
                  required
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowCode((v) => !v)}
                  aria-label={showCode ? "Hide password" : "Show password"}
                  tabIndex={-1}
                >
                  {showCode ? (
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                      <path
                        d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.1A10.4 10.4 0 0112 5c5 0 9 4 10.5 7-.6 1.2-1.5 2.6-2.7 3.8M6.2 6.2C4 7.6 2.4 9.5 1.5 12c1.5 3 5.5 7 10.5 7 1.3 0 2.5-.2 3.6-.7"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                      <path
                        d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div className="error-banner">
                {error}
                {attemptsRemaining !== null && (
                  <>
                    {" "}
                    {attemptsRemaining} attempt{attemptsRemaining === 1 ? "" : "s"} left.
                  </>
                )}
              </div>
            )}

            <button type="submit" className="btn btn-primary btn-block" disabled={submitting || code.length < 4}>
              {submitting ? "Checking…" : "Enter"}
            </button>
          </form>
        )}

        {!locked && history.length > 0 && (
          <div className="history-list">
            {history.map((entry) => (
              <div key={entry.id} className="history-row">
                <button
                  type="button"
                  className="history-row-main"
                  style={{ cursor: "pointer", background: "none", border: "none", textAlign: "left", padding: 0 }}
                  onClick={() => toggleExpanded(entry.id)}
                >
                  <span className="history-row-label">{entry.roomName}</span>
                  <span className="history-row-meta">{timeLeftLabel(entry.createdAt)}</span>
                </button>

                {expandedId === entry.id && (
                  <form className="field" style={{ marginTop: 8 }} onSubmit={handleJoin}>
                    <input
                      type="password"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      placeholder="Storage code"
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      minLength={6}
                      maxLength={6}
                      autoComplete="off"
                      autoFocus
                      required
                    />
                    {joinError && <div className="error-banner">{joinError}</div>}
                    <button
                      type="submit"
                      className="btn btn-primary btn-small btn-block"
                      disabled={joining || joinCode.length < 6}
                      style={{ marginTop: 8 }}
                    >
                      {joining ? "Opening…" : "Open"}
                    </button>
                  </form>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
