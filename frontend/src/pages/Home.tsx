import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createRoom, ApiError } from "../api/client";
import { saveSessionToken } from "../api/roomSession";

const FALLBACK_LOCKOUT_MS = 60 * 1000;

export default function Home() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [showCode, setShowCode] = useState(false);
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
              <div className="password-input-wrap">
                <input
                  id="code"
                  type={showCode ? "text" : "password"}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="Password"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  minLength={4}
                  maxLength={4}
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
      </div>
    </div>
  );
}
