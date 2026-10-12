"use client";

// Live line for the Artizen give-back pledge page: three numbers, then the top 20 and a link to the full line.
// The section title ("The line") sits outside the card, in the page's shared section head.
import "./claim.css";
import Link from "next/link";
import { Icon } from "@/components/Icons";
import { formatCents } from "@/lib/claims";
import { lineStats, type LineStats } from "@/lib/pledges";
import { LineList, useLine } from "./LineList";

/** `initial` is the server's count, shown until the live line loads. */
export function LineCard({ initial }: { initial?: LineStats }) {
  const { line, loaded } = useLine();
  const st = loaded ? lineStats(line) : initial ?? { people: 0, feesCents: 0, paidCents: 0 };
  return (
    <div className="card linecard">
      <div className="lc-top">
        <span className="k lc-live"><span className="live" />Live</span>
        <dl className="lc-stats">
          <div><dt>in line</dt><dd>{st.people}</dd></div>
          <div><dt>fees claimed</dt><dd>{formatCents(st.feesCents)}</dd></div>
          <div><dt>paid so far</dt><dd>{formatCents(st.paidCents)}</dd></div>
        </dl>
      </div>
      <LineList entries={line.slice(0, 20)} loaded={loaded} />
      <div className="cl-more">
        <Link className="go" href="/claim/line">
          {line.length > 20 ? `See all ${line.length}` : "See all"} <Icon name="arrow" />
        </Link>
      </div>
    </div>
  );
}
