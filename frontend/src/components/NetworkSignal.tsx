import { useNetworkStatus } from "../hooks/useNetworkStatus";

const LABEL_BY_QUALITY = {
  offline: "Offline",
  poor: "Weak connection",
  fair: "Fair connection",
  good: "Good connection",
  unknown: "Online",
} as const;

// "unknown" means the browser (Safari/Firefox) doesn't expose signal
// quality at all — default it to the calm color rather than alarming
// someone over a metric we can't actually read.
const DOT_CLASS_BY_QUALITY = {
  offline: "network-dot-offline",
  poor: "network-dot-poor",
  fair: "network-dot-fair",
  good: "network-dot-good",
  unknown: "network-dot-good",
} as const;

export default function NetworkSignal() {
  const { quality, downlinkMbps } = useNetworkStatus();
  const label = LABEL_BY_QUALITY[quality];
  const title = label + (downlinkMbps ? ` (${downlinkMbps.toFixed(1)} Mbps)` : "");

  return <span className={`network-dot ${DOT_CLASS_BY_QUALITY[quality]}`} title={title} aria-label={title} />;
}
