import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createRoom, ApiError } from "../api/client";
import { saveSessionToken } from "../api/roomSession";

const FALLBACK_LOCKOUT_MS = 60 * 1000;

export default function Home() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const unlockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const locked = lockedUntil !== null;

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

  return (
    <div className="page">
      <div className="container">
        <span className="brand">
          SHA<span className="brand-mark">RIZZ</span>
        </span>

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
              <input
                id="code"
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="••••"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                minLength={4}
                maxLength={4}
                autoComplete="off"
                autoFocus
                required
              />
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
      </div>
    </div>
  );
}
