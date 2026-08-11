import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, enterRoom } from "../api/client";
import { resolveRoomIdentifier } from "../api/roomLookup";
import { saveSessionToken } from "../api/roomSession";

export default function EnterRoom() {
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const roomId = await resolveRoomIdentifier(identifier.trim());
      const { room, sessionToken } = await enterRoom(roomId, pin);
      saveSessionToken(room.id, sessionToken);
      navigate(`/room/${room.id}`, { replace: true });
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

        <h1 className="headline">Enter Storage</h1>
        <p className="subtext">Enter the storage name or ID, plus its PIN.</p>

        <form className="card" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="identifier">Storage Name or Storage ID</label>
            <input
              id="identifier"
              type="text"
              placeholder="Outing1"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              autoComplete="off"
              required
            />
          </div>

          <div className="field">
            <label htmlFor="pin">PIN</label>
            <input
              id="pin"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="••••"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
              minLength={4}
              maxLength={8}
              autoComplete="off"
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
