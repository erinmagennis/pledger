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
        <h1>Get your Artizen <em>10%</em> back</h1>
        <p className="sub">
          This claim is for the Artizen give-back pledge. Add your Season 7 receipt emails. Pledger checks each
          signature and puts you in line.
        </p>
      </header>
      <section className="cl4-page">
        <ClaimFlow />
      </section>
    </>
  );
}
