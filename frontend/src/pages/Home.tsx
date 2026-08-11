import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createRoom, ApiError } from "../api/client";
import { saveSessionToken } from "../api/roomSession";

export default function Home() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { room, sessionToken } = await createRoom(code);
      saveSessionToken(room.id, sessionToken);
      navigate(`/room/${room.id}`, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      setCode("");
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

          {error && <div className="error-banner">{error}</div>}

          <button type="submit" className="btn btn-primary btn-block" disabled={submitting || code.length < 4}>
            {submitting ? "Checking…" : "Enter"}
          </button>
        </form>

        <div className="feature-list">
          <div className="item">
            <span className="dot">●</span> Original files preserved, byte for byte
          </div>
          <div className="item">
            <span className="dot">●</span> No compression, no quality reduction
          </div>
          <div className="item">
            <span className="dot">●</span> Storage automatically expires after 24 hours
          </div>
        </div>
      </div>
    </div>
  );
}
