import { Icon } from "../Icons";

export function Kinds({ matched }: { matched: string | null }) {
  return (
    <div className="kinds">
      <div className="kind k1">
        <span className="ico"><Icon name="heart" /></span>
        <h3>Matching funds</h3>
        <p>For companies, funds and people. The match is in place before you announce it.</p>
        <div className="mini">
          <div className="r"><span>Match in place</span><span className="ok">$500</span></div>
          <div className="r"><span>In place until</span><span>31 December</span></div>
          {matched && <div className="r"><span>Matched so far (testnet)</span><span>{matched}</span></div>}
        </div>
      </div>
      <div className="kind k2">
        <span className="ico"><Icon name="trophy" /></span>
        <h3>Prize payouts</h3>
        <p>Winners see the date their prize lands.</p>
      </div>
      <div className="kind k3">
        <span className="ico"><Icon name="undo" /></span>
        <h3>Give-backs</h3>
        <p>Return fees or winnings to the people who paid them.</p>
      </div>
    </div>
  );
}
