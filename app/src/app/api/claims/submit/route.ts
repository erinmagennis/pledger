import { after, NextResponse } from "next/server";
import { checkClaimSignature, displayLabel, isDisplayMode, NEXT_UPDATE, type ClaimPayload } from "@/lib/claims";
import { checkUploads, loadLine, readUploads } from "@/lib/claims-server";
import { verifyOnBase } from "@/lib/base";
import { recordClaims } from "@/lib/eas";
import { DB_MISSING, getSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

const SIGNATURE_ERRORS: Record<string, string> = {
  "payout-mismatch": "The signing wallet must be the payout wallet",
  "signature-expired": "The signature is too old. Sign again.",
  "fingerprints-mismatch": "Your files changed after you signed. Check them again and sign.",
  "nothing-to-claim": "No receipts left to claim",
  "bad-signature": "The signature did not match your wallet",
  "bad-address": "Connect a wallet first",
  "no-chargeback": "Confirm you have not reversed or charged back this payment",
};

/**
 * Store a claim. Re-verifies every file here (client rows are not trusted), checks the wallet
 * signature, rejects duplicates and excluded inboxes, then stores only hashed and public fields.
 */
export async function POST(req: Request) {
  const db = getSupabase();
  if (!db) return NextResponse.json(DB_MISSING, { status: 503 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return bad("Send the claim as a form upload");
  }
  let payload: ClaimPayload;
  try {
    payload = JSON.parse(String(form.get("payload") ?? ""));
    if (!Array.isArray(payload.fingerprints) || typeof payload.payout !== "string" || typeof payload.timestamp !== "number") throw 0;
    if (!payload.display || !isDisplayMode(payload.display.mode) || typeof payload.display.name !== "string") throw 0;
  } catch {
    return bad("Claim details are missing");
  }
  if (payload.noChargeback !== true) return bad("Confirm you have not reversed or charged back this payment");
  if (payload.notRestrictedRegion !== true) return bad("Confirm you are not in a restricted region");
  let label: string | null;
  try {
    label = displayLabel(payload.display.mode, payload.display.name);
  } catch {
    return bad("Add a name, or choose project only");
  }

  const uploads = await readUploads(form);
  if ("error" in uploads) return bad(uploads.error);

  let rows;
  try {
    rows = await checkUploads(uploads, db);
  } catch {
    return bad("Could not check the files. Try again.", 500);
  }
  const claimable = rows.filter((r) => r.ok && r.kind === "receipt" && r.fingerprint && r.toHash && r.date && r.project && r.feeCents !== undefined);

  const sig = await checkClaimSignature({
    payload,
    signature: String(form.get("signature") ?? ""),
    address: String(form.get("address") ?? ""),
    verifiedFingerprints: claimable.map((r) => r.fingerprint!),
    now: Date.now(),
    verify: verifyOnBase,
  });
  if (!sig.ok) return bad(SIGNATURE_ERRORS[sig.reason] ?? "Could not check the signature", sig.reason === "bad-signature" ? 401 : 400);

  const payout = payload.payout.toLowerCase();
  const insert = claimable.map((r) => ({
    fingerprint: r.fingerprint!,
    to_hash: r.toHash!,
    project: r.project!,
    purchased_at: r.date!,
    fee_cents: r.feeCents!,
    self_backed: Boolean(r.selfBacked),
    payout_address: payout,
    display_mode: payload.display.mode,
    display_name: label,
    no_chargeback: true,
    not_restricted_region: true,
  }));
  const { data: stored, error } = await db.from("pledger_claims").insert(insert).select("id,fingerprint,project,fee_cents,self_backed");
  if (error) {
    if (error.code === "23505") return bad("Already claimed", 409);
    return bad("Could not save the claim. Try again.", 500);
  }

  after(() =>
    recordClaims(
      db,
      (stored ?? []).map((c) => ({
        claimId: c.id,
        fingerprint: c.fingerprint,
        project: c.project,
        feeCents: c.fee_cents,
        selfBacked: c.self_backed,
        status: "in line",
        recipient: payout,
      })),
    ),
  );

  let place: number | null = null;
  let entries: { place: number; group: 1 | 2; feeCents: number }[] = [];
  try {
    const [line, first] = await Promise.all([
      loadLine(db),
      db.from("pledger_claims").select("id").eq("payout_address", payout).order("created_at", { ascending: true }).order("id", { ascending: true }).limit(1).maybeSingle(),
    ]);
    const mine = line.filter((e) => e.pid === first.data?.id);
    entries = mine.map((e) => ({ place: e.place, group: e.group, feeCents: e.feeCents }));
    place = entries.length ? Math.min(...entries.map((e) => e.place)) : null;
  } catch {
    // the claim is stored; place is shown on the line page
  }

  return NextResponse.json({
    claimed: insert.length,
    totalCents: insert.reduce((s, r) => s + r.fee_cents, 0),
    place,
    entries,
    nextUpdate: NEXT_UPDATE,
  });
}
