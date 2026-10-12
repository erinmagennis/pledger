#!/usr/bin/env node
// Snapshot a Pledger Zcash pledge page from a viewing key only (Node 22+, ESM).
// Usage: node scripts/zcash-snapshot.mjs --network mainnet|testnet --ufvk <key>
//   --address <ua> --birthday <height> [--server <url>] [--out <file>]
//   [--label "..."] [--dry-run]
// The script never sees a seed. It scans birthday..tip and writes the page JSON.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";

const { values: a } = parseArgs({
  options: {
    network: { type: "string" }, ufvk: { type: "string" }, address: { type: "string" },
    birthday: { type: "string" }, server: { type: "string" }, out: { type: "string" },
    label: { type: "string" }, "dry-run": { type: "boolean", default: false },
  },
});
const fail = (msg, code = 1) => { console.error(msg); process.exit(code); };
if (!["mainnet", "testnet"].includes(a.network)) fail("--network must be mainnet or testnet");
if (!a.ufvk || !a.address || !/^\d+$/.test(a.birthday ?? "")) fail("--ufvk, --address and --birthday <height> are required");

const out = a.out ?? `src/content/zcash-pledge.${a.network}.json`;

// The native scanner writes decrypt errors (testnet NU7) straight to fd 2.
// So the parent re-runs this script as a child, reads its stderr, then writes the file.
const isChild = process.env.ZS_CHILD === "1";
if (!isChild) {
  const r = spawnSync(process.execPath, process.argv.slice(1), {
    env: { ...process.env, ZS_CHILD: "1" }, encoding: "utf8", maxBuffer: 1 << 28,
    stdio: ["inherit", "pipe", "pipe"],
  });
  process.stderr.write(r.stderr.split("\n").filter((l) => !l.startsWith("ZS_STATS ")).join("\n"));
  if (r.status !== 0) process.exit(r.status ?? 1);
  const doc = JSON.parse(r.stdout);
  const errs = r.stderr.split("\n").filter((l) => /decrypt error|branch id/i.test(l));
  const { blocksScanned, elapsedMs } = JSON.parse(r.stderr.split("\n").find((l) => l.startsWith("ZS_STATS ")).slice(9));
  if (errs.length) doc.scanNote = `Scanner reported ${errs.length} decrypt error(s), so some transactions may be missing and the balance may be understated. First error: ${errs[0].slice(0, 220)}`;
  const json = JSON.stringify(doc, null, 2) + "\n";
  if (a["dry-run"]) process.stdout.write(json); else writeFileSync(out, json);
  console.error(
    `${a.network} tip ${doc.verifiedBlock}, scanned ${blocksScanned} blocks in ${elapsedMs}ms, ` +
    `${doc.transactions.length} tx, balance ${doc.balanceZat} zat (${doc.balanceZat / 1e8} ${doc.unit}), ` +
    `${a["dry-run"] ? "dry run, nothing written" : "wrote " + out}` +
    (errs.length ? `, WARNING: ${errs.length} decrypt error(s), see scanNote` : ""));
  process.exit(0);
}

// Load the native package, or tell the caller how to install it.
let zu;
try {
  zu = createRequire(import.meta.url)("@ledgerhq/zcash-utils");
} catch {
  fail("Missing @ledgerhq/zcash-utils. Install it without saving:\nnpm i --no-save @ledgerhq/zcash-utils@2.6.0", 2);
}

const main = a.network === "mainnet";
const server = a.server ?? (main ? "https://zec.rocks:443" : "https://testnet.zec.rocks:443");
const birthday = Number(a.birthday);

const tip = await zu.getChainTip(server);
const stream = await zu.startSync({
  grpcUrl: server, viewingKey: a.ufvk, startHeight: birthday, endHeight: tip,
  network: a.network, knownNullifiers: [],
});

// Collect transactions. Incoming = received notes. Outgoing = notes sent to others.
const txs = [];
let balanceZat = 0;
for (let t; (t = await stream.next()) !== null; ) {
  const notes = [...(t.orchardNotes ?? []), ...(t.saplingNotes ?? []), ...(t.ironwoodNotes ?? [])];
  const type = (n) => String(n.transferType).toLowerCase();
  const inZat = notes.filter((n) => type(n) === "incoming").reduce((s, n) => s + n.amount, 0);
  const outZat = notes.filter((n) => type(n) === "outgoing").reduce((s, n) => s + n.amount, 0);
  balanceZat += notes.filter((n) => type(n) === "incoming" && !n.isSpent).reduce((s, n) => s + n.amount, 0);
  const row = { txid: t.txid, height: t.blockHeight, date: new Date(t.blockTime * 1000).toISOString().slice(0, 10), feeZat: t.fee };
  if (inZat > 0) txs.push({ ...row, direction: "in", valueZat: inZat });
  if (outZat > 0) txs.push({ ...row, direction: "out", valueZat: outZat });
}
txs.sort((x, y) => x.height - y.height);

const pledge = txs.find((t) => t.direction === "in");
const outgoing = txs.filter((t) => t.direction === "out").at(-1);
const shape = (t) => t && { txid: t.txid, block: t.height, date: t.date, amountZat: t.valueZat, feeZat: t.feeZat };

let published = false;
try { published = JSON.parse(readFileSync(out, "utf8")).published ?? false; } catch {}

const doc = {
  networkId: a.network,
  network: main ? "Zcash mainnet" : "Zcash testnet",
  unit: main ? "ZEC" : "TAZ",
  pool: main ? "Ironwood" : "Orchard",
  ...(a.label && { label: a.label }),
  address: a.address,
  viewingKey: a.ufvk,
  viewingKeyType: "Unified full viewing key",
  birthdayHeight: birthday,
  balanceZat,
  pledgeTx: shape(pledge) ?? null,
  ...(outgoing && { outgoingTx: shape(outgoing) }),
  transactions: txs.map(({ txid, height, direction, valueZat }) => ({ txid, height, direction, valueZat })),
  explorerTxUrl: main ? "https://zecblock.com/tx/" : "https://testnet.cipherscan.app/tx/",
  verifiedAt: new Date().toISOString(),
  verifiedBlock: tip,
  verifiedWith: "@ledgerhq/zcash-utils 2.6.0 (viewing key scan)",
  indexer: server,
  verifyCommand: `zingo-cli --chain ${a.network} --server ${server} --viewkey <UFVK> --birthday ${birthday} --waitsync balance`,
  spendCheck: "No spend capability",
  published,
};
const stats = await stream.stats();
process.stderr.write("ZS_STATS " + JSON.stringify(stats) + "\n");
process.stdout.write(JSON.stringify(doc));
