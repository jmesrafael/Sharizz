import { useState } from "react";

export default function CopyLinkButton({ roomId }: { roomId: string }) {
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/room/${roomId}`;

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
    <button type="button" className="btn btn-secondary" onClick={handleCopy}>
      {copied ? "Copied!" : "Copy Link"}
    </button>
  );
}
