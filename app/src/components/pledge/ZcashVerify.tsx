import { CopyBox } from "./CopyBox";
import { ZCASH, formatZat, zcashVerifyCommand, zcashVerifyDisplay, type ZcashPledgeData } from "@/lib/pledges";

/** "Verify it yourself": the viewing key, the address and the command, folded away by default. Zcash pledge page only.
 * Render only for published data (the viewing key and address exist). */
export function ZcashVerify({ d = ZCASH }: { d?: ZcashPledgeData }) {
  const test = d.networkId === "testnet";
  const balance = d.balanceZat ?? 0;
  return (
    <details className="card zc-verify" id="verify">
      <summary>
        <div>
          <h2>Verify it yourself</h2>
          <small>Check the balance with the viewing key. No account needed.</small>
        </div>
      </summary>
      <div className="zc-body">
        <CopyBox label="Viewing key. View only. Cannot spend." text={d.viewingKey ?? ""} />
        <CopyBox label={`Address (${d.network})`} text={d.address ?? ""} />
        <CopyBox label="Command" text={zcashVerifyCommand(d)} display={zcashVerifyDisplay(d)} />
        <p className="zc-p">
          Copy gives the full command with the key in place.
          {test && " It needs a zingo-cli build that supports the latest Zcash testnet upgrade (NU7)."} Expect a confirmed
          balance of {balance.toLocaleString("en-US")} zat, which is {formatZat(balance, d.unit)}.
        </p>
        <p className="zc-p">
          A wallet made from this key cannot send. Trying returns &quot;{d.spendCheck}&quot;.
        </p>
      </div>
    </details>
  );
}
