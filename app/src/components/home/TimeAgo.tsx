"use client";

import { useEffect, useState } from "react";

function ago(unix: number, now: number): string {
  const s = Math.max(0, Math.floor(now / 1000 - unix));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

/** Relative time that stays right after a cached server render. */
export function TimeAgo({ unix, renderedAt }: { unix: number; renderedAt: number }) {
  const [now, setNow] = useState(renderedAt * 1000);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return <>{ago(unix, now)}</>;
}
