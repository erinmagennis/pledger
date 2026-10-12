// Register the Pledger claim schema on Base mainnet EAS.
// Run in your own terminal with the env set (never commit keys):
//   PLEDGER_ATTESTER_KEY=... BASE_RPC_URL=... node scripts/register-schema.mjs
// Prints the schema UID only. Put it in PLEDGER_EAS_SCHEMA_UID.
import { createRequire } from "node:module";
import { JsonRpcProvider, Wallet, ZeroAddress } from "ethers";

// The SDK's ESM build fails under plain Node (lodash named import), so load its CommonJS build.
const { SchemaRegistry } = createRequire(import.meta.url)("@ethereum-attestation-service/eas-sdk");

const SCHEMA_REGISTRY = "0x4200000000000000000000000000000000000020";
const SCHEMA = "bytes32 fingerprint,string project,uint256 feeCents,bool selfBacked,string status";

const key = process.env.PLEDGER_ATTESTER_KEY;
if (!key) {
  console.error("Set PLEDGER_ATTESTER_KEY first.");
  process.exit(1);
}

const provider = new JsonRpcProvider(process.env.BASE_RPC_URL || "https://mainnet.base.org", 8453);
const registry = new SchemaRegistry(SCHEMA_REGISTRY);
registry.connect(new Wallet(key, provider));

const uid = SchemaRegistry.getSchemaUID(SCHEMA, ZeroAddress, true);
try {
  const existing = await registry.getSchema({ uid });
  if (existing && existing.uid === uid) {
    console.log(uid);
    process.exit(0);
  }
} catch {
  // not registered yet
}

try {
  const tx = await registry.register({ schema: SCHEMA, resolverAddress: ZeroAddress, revocable: true });
  console.log(await tx.wait());
} catch (err) {
  console.error("Register failed:", err instanceof Error ? err.message.split("\n")[0] : "unknown error");
  process.exit(1);
}
