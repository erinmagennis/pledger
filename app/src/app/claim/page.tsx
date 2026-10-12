import type { Metadata } from "next";
import { Button } from "@/components/Button";

export const metadata: Metadata = { title: "Claim · Pledger" };

export default function ClaimPage() {
  return (
    <header className="phead give-back">
      <span className="eyebrow"><span className="live" />Artizen give-back</span>
      <h1>Claim flow coming next.</h1>
      <p className="sub">You will be able to check your claim, or add one with your Artizen receipt email.</p>
      <div className="ctas">
        <Button href="/pledges/artizen-give-back">Back to the pledge</Button>
      </div>
    </header>
  );
}
