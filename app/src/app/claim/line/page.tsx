import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icons";
import { LineWithPay } from "@/components/claim/LinePage";

export const metadata: Metadata = { title: "The line · Artizen give-back · Pledger" };

export default function LinePage() {
  return (
    <>
      <Link className="back" href="/pledges/artizen-give-back"><Icon name="arrow" small />The pledge</Link>
      <header className="phead give-back cl-head">
        <span className="eyebrow"><span className="live" />Artizen give-back</span>
        <h1>The <em>line</em></h1>
        {/* TODO(copy) */}
        <p className="sub">Everyone waiting for their 10% back. Anyone can pay someone in line directly.</p>
        <div className="ctas"><Button href="/claim">Add your claim</Button></div>
      </header>
      <section className="pgrid">
        <LineWithPay />
        <div className="pcol side cl-side">
          <div className="card">
            <h2>Order</h2>
            <ol className="how">
              <li>Self-backed claims first, smallest total first.</li>
              <li>Then claims for backing others, smallest total first.</li>
              <li>A tie goes to whoever claimed first.</li>
            </ol>
          </div>
          <div className="card note sage">
            <h2>Every payment is checked</h2>
            <p>Pledger reads each USDC payment on Base before it marks anyone paid.</p>
          </div>
        </div>
      </section>
    </>
  );
}
