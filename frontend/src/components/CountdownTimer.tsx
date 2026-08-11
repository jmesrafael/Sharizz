import { useEffect, useRef, useState } from "react";
import { extendRoom } from "../api/client";

// Deliberately unlabeled — just a number in the corner. Only meaningful to
// whoever already knows what it counts down from. Five clicks within
// CLICK_RESET_MS of each other push the room's deletion out by another
// full ROOM_LIFETIME_MS (24 hours), silently — no visible hint this exists.
const CLICKS_TO_EXTEND = 5;
const CLICK_RESET_MS = 2000;

export default function CountdownTimer({
  roomId,
  sessionToken,
  expiresAt,
  onExtended,
}: {
  roomId: string;
  sessionToken: string;
  expiresAt: number;
  onExtended: (expiresAt: number) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [clicks, setClicks] = useState(0);
  const extendingRef = useRef(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

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
      const { expiresAt: newExpiresAt } = await extendRoom(roomId, sessionToken);
      onExtended(newExpiresAt);
    } catch {
      // Silent on purpose — this control has no visible feedback surface.
    } finally {
      extendingRef.current = false;
    }
  }

  const hoursLeft = Math.max(0, Math.ceil((expiresAt - now) / (1000 * 60 * 60)));

  return (
    <button type="button" className="hours-left" onClick={handleClick} aria-label="Time remaining">
      {hoursLeft}
    </button>
  );
}
