"use client";

import { useState } from "react";

/** A mono box with a copy button. The text stays selectable if copying fails. */
export function CopyBox({ label, text, display }: { label: string; text: string; display?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("failed");
    }
  }

  return (
    <div className="zc-copy">
      <div className="zc-copy-top">
        <span className="zc-copy-k">{label}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>{state === "copied" ? "Copied" : "Copy"}</button>
      </div>
      <code className="zc-mono">{display ?? text}</code>
      {state === "failed" && <small className="zc-copy-err">Could not copy. Select the text and copy it by hand.</small>}
    </div>
  );
}
