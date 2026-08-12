import { useState } from "react";

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
    <button type="button" className="btn btn-secondary btn-small" onClick={handleCopy}>
      {copied ? "Copied!" : "Copy Code"}
    </button>
  );
}
