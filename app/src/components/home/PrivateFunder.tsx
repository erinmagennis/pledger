import Link from "next/link";
import { ZCASH_SLUG } from "@/lib/pledges";
import { Icon } from "../Icons";

/** Sits beside the tracker: the feed shows short addresses, and this says funders can stay private too. */
export function PrivateFunder() {
  return (
    <div className="kind k4">
      <div className="khead">
        <span className="ico"><Icon name="lock" /></span>
        <div>
          <h3>Public money, private funder</h3>
          <p>A funder can keep their name private. Anyone can still check the money: what came in, what went out and what is left.</p>
        </div>
      </div>
      <Link className="k4-link" href={`/pledges/${ZCASH_SLUG}`}>
        See the pledge on Zcash <Icon name="arrow" small />
      </Link>
    </div>
  );
}
