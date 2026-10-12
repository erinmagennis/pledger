import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/Icons";
import { ClaimFlow } from "@/components/claim/ClaimFlow";

export const metadata: Metadata = { title: "Claim your Artizen 10% · Pledger" };

export default function ClaimPage() {
  return (
    <>
      <Link className="back" href="/pledges/artizen-give-back"><Icon name="arrow" small />The pledge</Link>
      <header className="phead give-back cl-head">
        <span className="eyebrow"><span className="live" />Artizen give-back · Season 7</span>
        {/* TODO(copy): Erin to check headline and sub */}
        <h1>Get your <em>10%</em> back</h1>
        <p className="sub">Add your Artizen receipt emails. Pledger checks each signature and puts you in line.</p>
      </header>
      <section className="pgrid">
        <ClaimFlow />
        <div className="pcol side cl-side">
          <div className="card">
            <h2>How it works</h2>
            <ol className="how">
              <li>Connect a wallet on Base. Payments go there in USDC.</li>
              <li>Add the original emails. Each receipt counts once.</li>
              <li>Self-backed claims go first, smallest first. Then everyone else.</li>
            </ol>
          </div>
          <div className="card note">
            <h2>What we keep</h2>
            {/* TODO(copy) */}
            <p>A fingerprint of each receipt, the project, date and fee, your wallet and how you want to be shown. Never your email or its contents.</p>
            <div className="mini">
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
