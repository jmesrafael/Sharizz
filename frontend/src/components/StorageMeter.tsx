import { useEffect, useRef, useState } from "react";
import { extendRoom } from "../api/client";

function formatBytes(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 0.1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${Math.max(mb, 0.1).toFixed(1)} MB`;
}

// Hidden extension, moved here from the corner countdown: five clicks on
// the storage total within CLICK_RESET_MS of each other push the room's
// deletion out by another full ROOM_LIFETIME_MS (24 hours), silently — no
// visible hint this exists.
const CLICKS_TO_EXTEND = 5;
const CLICK_RESET_MS = 2000;

export default function StorageMeter({
  usedBytes,
  limitBytes,
  roomId,
  sessionToken,
  onExtended,
}: {
  usedBytes: number;
  limitBytes: number;
  roomId: string;
  sessionToken: string;
  onExtended: (expiresAt: number) => void;
}) {
  const pct = limitBytes > 0 ? Math.min(usedBytes / limitBytes, 1) : 0;
  const remaining = Math.max(limitBytes - usedBytes, 0);

  const [clicks, setClicks] = useState(0);
  const extendingRef = useRef(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    []
  );

  async function handleClick() {
    if (extendingRef.current) return;
    if (resetTimer.current) clearTimeout(resetTimer.current);

    const next = clicks + 1;
    if (next < CLICKS_TO_EXTEND) {
      setClicks(next);
      resetTimer.current = setTimeout(() => setClicks(0), CLICK_RESET_MS);
      return;
    }

    setClicks(0);
    extendingRef.current = true;
    try {
      const { expiresAt } = await extendRoom(roomId, sessionToken);
      onExtended(expiresAt);
    } catch {
      // Silent on purpose — this control has no visible feedback surface.
    } finally {
      extendingRef.current = false;
    }
  }

  return (
    <div className="storage-meter">
      <div className="storage-meter-track">
        <div className="storage-meter-fill" style={{ width: `${pct * 100}%` }} />
      </div>
      <button type="button" className="storage-meter-text" onClick={handleClick} title={`${formatBytes(remaining)} left of ${formatBytes(limitBytes)}`}>
        {formatBytes(usedBytes)} used
      </button>
    </div>
  );
}
