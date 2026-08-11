import { useEffect, useState } from "react";
import { getUsageStatus } from "../api/client";
import type { UsageStatus } from "@shared/types";

const POLL_INTERVAL_MS = 5 * 60 * 1000;

function formatGb(bytes: number): string {
  return (bytes / (1024 * 1024 * 1024)).toFixed(1);
}

function describe(usage: UsageStatus): string {
  const pct = Math.max(usage.storagePct, usage.classAPct, usage.classBPct);
  const roundedPct = Math.round(pct * 100);
  if (usage.level === "exceeded") {
    return `Free storage quota reached (${formatGb(usage.storageBytes)} GB). New uploads are blocked until usage drops.`;
  }
  return `Approaching free storage quota — ${roundedPct}% used (${formatGb(usage.storageBytes)} GB).`;
}

export default function UsageToast() {
  const [usage, setUsage] = useState<UsageStatus | null>(null);
  const [dismissedLevel, setDismissedLevel] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const status = await getUsageStatus();
        if (!cancelled) setUsage(status);
      } catch {
        // Usage reporting is best-effort — a failed check shouldn't disrupt the app.
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!usage || usage.level === "ok" || dismissedLevel === usage.level) return null;

  return (
    <div className={`usage-toast usage-toast-${usage.level}`} role="alert">
      <span className="usage-toast-text">{describe(usage)}</span>
      <button
        type="button"
        className="usage-toast-dismiss"
        aria-label="Dismiss"
        onClick={() => setDismissedLevel(usage.level)}
      >
        ×
      </button>
    </div>
  );
}
