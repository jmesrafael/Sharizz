import { useState } from "react";

export default function CopyLinkButton({ roomId, sessionToken }: { roomId: string; sessionToken: string }) {
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/room/${roomId}?token=${encodeURIComponent(sessionToken)}`;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard access was denied — no-op
    }
  }

  return (
    <button type="button" className="btn btn-secondary btn-small" onClick={handleCopy}>
      {copied ? "Copied!" : "Copy Link"}
    </button>
  );
}
