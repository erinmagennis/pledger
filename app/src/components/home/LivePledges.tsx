import { Button } from "../Button";
import { PledgeCard } from "../PledgeCard";
import { ZCASH_SLUG, type Pledge } from "@/lib/pledges";

const TRY_SLUG = "demo";

export function LivePledges({ pledges }: { pledges: Pledge[] }) {
  // The private-funder pledge is linked from the line at the bottom of the green band, so it is not listed here.
  const shown = pledges.filter((p) => p.slug !== ZCASH_SLUG);
  return (
    <>
      <div className="head" id="live">
        <h2>Live pledges</h2>
        <Button href="/make" variant="ghost">Make a pledge</Button>
      </div>
      <section className="pledges">
        {shown.map((p) => (
          <PledgeCard
            key={p.slug}
            pledge={p}
            action={p.slug === TRY_SLUG ? <Button href={`/pledges/${TRY_SLUG}#try`} size="sm">Try it with test money</Button> : undefined}
          />
        ))}
      </section>
    </>
  );
}
