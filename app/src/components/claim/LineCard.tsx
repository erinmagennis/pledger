"use client";

// Live line for the Artizen give-back pledge page. Top 20, then a link to the full line.
import "./claim.css";
import Link from "next/link";
import { Icon } from "@/components/Icons";
import { LineList, useLine } from "./LineList";

export function LineCard() {
  const { line, loaded } = useLine();
  return (
    <div className="card">
      <span className="k"><span className="live" />Live</span>
      <h2 style={{ marginTop: 8 }}>The line</h2>
      <p className="cl-soft" style={{ marginTop: 6 }}>Self-backed claims first, smallest first. Then everyone else, smallest first.</p>
      <LineList entries={line.slice(0, 20)} loaded={loaded} />
      <div className="cl-more">
        <Link className="go" href="/claim/line">
          {line.length > 20 ? `See all ${line.length}` : "See all"} <Icon name="arrow" />
        </Link>
      </div>
    </div>
  );
}
