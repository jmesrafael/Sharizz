import { useEffect, useState } from "react";

function formatRemaining(ms: number): { text: string; level: "normal" | "warning" | "urgent" } {
  if (ms <= 0) return { text: "Expired", level: "urgent" };

  const totalHours = Math.floor(ms / (1000 * 60 * 60));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));

  if (days >= 2) return { text: `Expires in ${days} days ${hours} hours`, level: "normal" };
  if (days === 1) return { text: `Expires in 1 day ${hours} hours`, level: "normal" };
  if (totalHours >= 1) return { text: `Expires in ${totalHours} hours`, level: totalHours <= 6 ? "urgent" : "warning" };
  return { text: `Expires in ${Math.max(minutes, 1)} minutes`, level: "urgent" };
}

export default function CountdownTimer({ expiresAt }: { expiresAt: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const { text, level } = formatRemaining(expiresAt - now);

  return <span className={`expiry-pill ${level !== "normal" ? level : ""}`}>{text}</span>;
}
