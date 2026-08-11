import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createRoom, ApiError } from "../api/client";
import { saveSessionToken } from "../api/roomSession";

export default function CreateRoom() {
  const navigate = useNavigate();
  const [roomName, setRoomName] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { room, sessionToken } = await createRoom(roomName.trim(), pin);
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

        <h1 className="headline">Create Storage Room</h1>
        <p className="subtext">Give your room a name and a PIN. Anyone with both can join.</p>

        <form className="card" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="roomName">Storage Name</label>
            <input
              id="roomName"
              type="text"
              placeholder="Outing1"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              maxLength={40}
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
              placeholder="1234"
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
            {submitting ? "Creating…" : "Create Room"}
          </button>
        </form>
      </div>
    </div>
  );
}
