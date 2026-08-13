import { useState } from "react";

// Shows the room's actual join code (not a generic "Copy Code" label) so
// the owner can read it off directly; clicking it copies it, same gesture
// as before, just with the value itself as the target instead of a button.
export default function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard access was denied — no-op
    }
  }

  return (
    <button type="button" className="btn btn-secondary btn-small room-code-btn" onClick={handleCopy}>
      {copied ? "Copied!" : code}
    </button>
  );
}
