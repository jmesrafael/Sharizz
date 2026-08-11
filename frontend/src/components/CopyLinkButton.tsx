import { useState } from "react";

export default function CopyLinkButton({ roomId }: { roomId: string }) {
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/room/${roomId}`;

  async function handleCopy() {
    try {
      if (navigator.share) {
        await navigator.share({ title: "Sharizz room", url: link });
        return;
      }
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // user cancelled the share sheet or clipboard was denied — no-op
    }
  }

  return (
    <button type="button" className="btn btn-secondary" onClick={handleCopy}>
      {copied ? "Copied!" : "Copy Room Link"}
    </button>
  );
}
