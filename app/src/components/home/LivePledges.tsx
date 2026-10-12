import { Button } from "../Button";
import { PledgeCard } from "../PledgeCard";
import type { Pledge } from "@/lib/pledges";

export function LivePledges({ pledges }: { pledges: Pledge[] }) {
  return (
    <>
      <div className="head" id="live">
        <h2>Live pledges</h2>
        <Button href="/#live" variant="ghost">See all</Button>
      </div>
      <section className="pledges">
        {pledges.map((p) => <PledgeCard key={p.slug} pledge={p} />)}
      </section>
    </>
  );
}
