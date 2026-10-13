import { Button } from "../Button";
import { PledgeCard } from "../PledgeCard";
import { ZCASH_SLUG, type Pledge } from "@/lib/pledges";

const TRY_SLUG = "test-match-pool";

export function LivePledges({ pledges }: { pledges: Pledge[] }) {
  // The private-funder pledge has its own card beside the tracker, so it is not listed here.
  const shown = pledges.filter((p) => p.slug !== ZCASH_SLUG);
  return (
    <>
      <div className="head" id="live">
        <h2>Live pledges</h2>
        <Button href="/make" variant="ghost">Make a pledge</Button>
      </div>
      <section className="pledges">
        {shown.map((p) =>
          p.slug === TRY_SLUG ? (
            <div className="pl-try" key={p.slug}>
              <PledgeCard pledge={p} />
              <Button href={`/pledges/${TRY_SLUG}#try`}>Try it with test money</Button>
            </div>
          ) : (
            <PledgeCard key={p.slug} pledge={p} />
          ),
        )}
      </section>
    </>
  );
}
