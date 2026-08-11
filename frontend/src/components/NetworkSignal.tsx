import { useNetworkStatus } from "../hooks/useNetworkStatus";

const BAR_COUNT_BY_QUALITY = { offline: 0, poor: 1, fair: 2, good: 3, unknown: 3 } as const;

const LABEL_BY_QUALITY = {
  offline: "Offline",
  poor: "Weak connection",
  fair: "Fair connection",
  good: "Good connection",
  unknown: "Online",
} as const;

export default function NetworkSignal() {
  const { online, quality, downlinkMbps } = useNetworkStatus();
  const activeBars = BAR_COUNT_BY_QUALITY[quality];
  const label = LABEL_BY_QUALITY[quality];
  const title = label + (downlinkMbps ? ` (${downlinkMbps.toFixed(1)} Mbps)` : "");

  return (
    <span className={`network-signal${online ? "" : " offline"}`} title={title} aria-label={title}>
      <span className="network-signal-bars" aria-hidden="true">
        {[1, 2, 3].map((bar) => (
          <span key={bar} className={`network-signal-bar${bar <= activeBars ? " active" : ""}`} />
        ))}
      </span>
      <span className="network-signal-label">{label}</span>
    </span>
  );
}
