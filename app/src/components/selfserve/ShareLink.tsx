"use client";

import { useEffect, useState } from "react";

/** The page's own link with a copy button. Pledges made at /make are found by link only. */
export function ShareLink({ path }: { path: string }) {
  const [url, setUrl] = useState(path);
  const [copied, setCopied] = useState<"idle" | "yes" | "no">("idle");
  useEffect(() => setUrl(window.location.origin + path), [path]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied("yes");
      setTimeout(() => setCopied("idle"), 2000);
    } catch {
      setCopied("no");
    }
  }
  return (
    <div className="ss-share">
      <span className="ss-share-k">Share this pledge</span>
      <input readOnly value={url} aria-label="Link to this pledge" onFocus={(e) => e.currentTarget.select()} />
      <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>
        {copied === "yes" ? "Copied" : copied === "no" ? "Select and copy" : "Copy link"}
      </button>
    </div>
  );
}
