import { useEffect, useState } from "react";

// Deliberately unlabeled — just a number in the corner. Only meaningful to
// whoever already knows what it counts down from. Purely informational; see
// StorageMeter.tsx for the hidden extend-on-click control.
export default function CountdownTimer({ expiresAt }: { expiresAt: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const hoursLeft = Math.max(0, Math.ceil((expiresAt - now) / (1000 * 60 * 60)));

  return (
    <span className="hours-left" aria-label="Time remaining">
      {hoursLeft}
    </span>
  );
}
