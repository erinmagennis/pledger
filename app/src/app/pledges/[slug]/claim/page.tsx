import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/Icons";
import { ClaimFlow } from "@/components/claim/ClaimFlow";

export const metadata: Metadata = { title: "Claim your Artizen 10% · Pledger" };

export default async function ClaimPage({ params }: { params: Promise<{ slug: string }> }) {
  // Only the Artizen give-back takes claims for now.
  if ((await params).slug !== "artizen") notFound();
  return (
    <>
      <Link className="back" href="/pledges/artizen"><Icon name="arrow" small />The pledge</Link>
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
