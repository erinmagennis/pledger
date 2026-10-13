import { Icon, type IconName } from "../Icons";

/** Icon beside the title and line, so the card does not stack three rows of head. */
function Head({ icon, title, line }: { icon: IconName; title: string; line: string }) {
  return (
    <div className="khead">
      <span className="ico"><Icon name={icon} /></span>
      <div>
        <h3>{title}</h3>
        <p>{line}</p>
      </div>
    </div>
  );
}

export function Kinds({ matched }: { matched: string | null }) {
  return (
    <div className="kinds">
      <div className="kind k1">
        <Head icon="heart" title="Matching funds" line="For companies, funds and people. The match is in place before you announce it." />
        <div className="mini">
          <div className="r"><span>Match in place</span><span className="ok">$500</span></div>
          <div className="r"><span>In place until</span><span>31 December</span></div>
          {matched && <div className="r"><span>Matched so far (test money)</span><span>{matched}</span></div>}
        </div>
      </div>
      <div className="kind k2">
        <Head icon="trophy" title="Prize payouts" line="Winners see the date their prize lands." />
      </div>
      <div className="kind k3">
        <Head icon="undo" title="Give-backs" line="Return fees or winnings to the people who paid them." />
      </div>
    </div>
  );
}
