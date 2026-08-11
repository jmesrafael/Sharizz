import { useEffect, useRef } from "react";
import type { FilePublic } from "@shared/types";
import { openRoomEventStream } from "../api/client";

// Subscribes to the room's SSE stream for near-real-time file updates and
// falls back to nothing fancy on disconnect — the caller can always fall
// back to a manual refresh, so we just reconnect once and give up quietly
// if the room truly went away (server will have sent an "expired" event).
export function useRoomEvents(
  roomId: string,
  sessionToken: string,
  onFiles: (files: FilePublic[]) => void,
  onExpired: () => void
) {
  const onFilesRef = useRef(onFiles);
  const onExpiredRef = useRef(onExpired);
  onFilesRef.current = onFiles;
  onExpiredRef.current = onExpired;

  useEffect(() => {
    let cancelled = false;
    let source: EventSource | null = null;

    function connect() {
      if (cancelled) return;
      source = openRoomEventStream(roomId, sessionToken);

      source.addEventListener("files", (event) => {
        onFilesRef.current(JSON.parse((event as MessageEvent).data));
      });
      source.addEventListener("expired", () => {
        onExpiredRef.current();
        source?.close();
      });
      source.onerror = () => {
        source?.close();
        if (!cancelled) setTimeout(connect, 4000);
      };
    }

    connect();
    return () => {
      cancelled = true;
      source?.close();
    };
  }, [roomId, sessionToken]);
}
