"use client";

import { useEffect, useRef, useState } from "react";

/** A mono box with a copy button. The text stays selectable if copying fails. */
export function CopyBox({ label, text, display }: { label: string; text: string; display?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const box = useRef<HTMLElement>(null);
  const [scrolls, setScrolls] = useState(false);

  // Show a scroll hint only while the text is taller than the box.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const check = () => setScrolls(el.scrollHeight > el.clientHeight + 2);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
      <code className="zc-mono" ref={box} tabIndex={scrolls ? 0 : undefined}>{display ?? text}</code>
      {scrolls && <small className="zc-scroll-hint">Scroll the box to see all of it.</small>}
      {state === "failed" && <small className="zc-copy-err">Could not copy. Select the text and copy it by hand.</small>}
    </div>
  );
}
