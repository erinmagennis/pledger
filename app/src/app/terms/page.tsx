import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms · Pledger" };

const CONTACT = "CONTACT_EMAIL"; // TODO(Erin): contact email

const sections: { h: string; p: string[] }[] = [
  {
    h: "Who we are",
    p: [
      "Pledger is run by Empowered Methods LLC, a Wisconsin limited liability company (\"we\"). These terms cover your use of pledger.impacthook.org.",
    ],
  },
  {
    h: "What Pledger does",
    p: [
      "Pledger shows pledges of money, checks claims and records payments in public. People who make a pledge set its rules.",
      "Pledger does not hold your money. Payments go directly from the payer to the recipient, either through a smart contract the pledge uses or as a direct transfer between wallets.",
    ],
  },
  {
    h: "Pledges",
    p: [
      "The person or organization that makes a pledge is responsible for keeping it. We show what is in place and what has been paid, but we do not guarantee that any pledge is paid.",
      "Pledges that depend on a condition, such as winning a prize, only pay out if the condition is met.",
    ],
  },
  {
    h: "Claims",
    p: [
      "When you make a claim, you confirm that the receipts you upload are yours, that you paid them, and that you have not reversed or charged back the payment. Claims that break these terms can be removed from the line.",
      "We check each receipt's email signature. We store a fingerprint of each email and the facts needed for your claim, never the email itself.",
    ],
  },
  {
    h: "Card purchases",
    p: [
      "If you buy crypto with a card through Pledger, the purchase is made with Stripe, which acts as the seller and runs its own identity and fraud checks under Stripe's terms.",
    ],
  },
  {
    h: "Wallets and payments",
    p: [
      "You are responsible for your wallet and its keys. Payments on a blockchain cannot be reversed. Check the address before you pay. We may screen wallet addresses against sanctions lists and refuse to show or process payments that fail.",
    ],
  },
  {
    h: "Test money",
    p: ["The test match pool uses test money on a test network. It has no value."],
  },
  {
    h: "No advice, no warranty",
    p: [
      "Pledger is not a bank, broker or financial adviser. The site is provided as it is. To the extent the law allows, we are not liable for losses from using it, from blockchain networks, or from other people's pledges or payments.",
    ],
  },
  {
    h: "Changes and law",
    p: [
      "We may update these terms and will change the date below when we do. Wisconsin law governs these terms.",
      `Questions: ${CONTACT}.`,
    ],
  },
];

export default function TermsPage() {
  return (
    <main className="wrap" style={{ maxWidth: 760, padding: "48px 28px 24px" }}>
      <p className="k">Last updated 12 October 2026</p>
      <h1 style={{ fontSize: 48, letterSpacing: "-0.03em", lineHeight: 1.05, margin: "12px 0 28px" }}>Terms</h1>
      <div className="card" style={{ display: "grid", gap: 24 }}>
        {sections.map((s) => (
          <section key={s.h}>
            <h2>{s.h}</h2>
            {s.p.map((t, i) => (
              <p key={i} style={{ marginTop: 8, color: "var(--soft)" }}>{t}</p>
            ))}
          </section>
        ))}
      </div>
    </main>
  );
}
