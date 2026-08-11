import { useEffect, useState } from "react";

export type ConnectionQuality = "offline" | "poor" | "fair" | "good" | "unknown";

export interface NetworkStatus {
  online: boolean;
  quality: ConnectionQuality;
  downlinkMbps: number | null;
}

// The Network Information API (navigator.connection) is Chromium-only, so
// Safari/Firefox always fall back to "unknown" quality with just an
// online/offline read — still enough to warn someone mid-upload that their
// connection dropped.
interface NetworkInformationLike extends EventTarget {
  effectiveType?: "slow-2g" | "2g" | "3g" | "4g";
  downlink?: number;
}

function getConnection(): NetworkInformationLike | undefined {
  const nav = navigator as Navigator & {
    connection?: NetworkInformationLike;
    mozConnection?: NetworkInformationLike;
    webkitConnection?: NetworkInformationLike;
  };
  return nav.connection ?? nav.mozConnection ?? nav.webkitConnection;
}

function qualityFromEffectiveType(effectiveType: string | undefined): ConnectionQuality {
  switch (effectiveType) {
    case "slow-2g":
    case "2g":
      return "poor";
    case "3g":
      return "fair";
    case "4g":
      return "good";
    default:
      return "unknown";
  }
}

function readStatus(): NetworkStatus {
  const online = navigator.onLine;
  if (!online) return { online: false, quality: "offline", downlinkMbps: null };

  const connection = getConnection();
  return {
    online: true,
    quality: qualityFromEffectiveType(connection?.effectiveType),
    downlinkMbps: connection?.downlink ?? null,
  };
}

export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>(() => readStatus());

  useEffect(() => {
    const update = () => setStatus(readStatus());
    const connection = getConnection();

    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    connection?.addEventListener("change", update);

    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      connection?.removeEventListener("change", update);
    };
  }, []);

  return status;
}
