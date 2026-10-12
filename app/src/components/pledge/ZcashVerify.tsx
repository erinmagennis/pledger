import { CopyBox } from "./CopyBox";
import { ZCASH, formatZat, zcashVerifyCommand, type ZcashPledgeData } from "@/lib/pledges";

/** "Verify it yourself": the viewing key, the address and the command, folded away by default. Zcash pledge page only. */
export function ZcashVerify({ d = ZCASH }: { d?: ZcashPledgeData }) {
  return (
    <details className="card zc-verify" id="verify">
      <summary>
        <div>
          <h2>Verify it yourself</h2>
          <small>Check the balance with the viewing key. No account needed.</small>
        </div>
      </summary>
      <div className="zc-body">
        <CopyBox label="Viewing key. View only. Cannot spend." text={d.viewingKey} />
        <CopyBox label="Address (Zcash testnet)" text={d.address} />
        <CopyBox
          label="Command"
          text={zcashVerifyCommand(d)}
          display={d.verifyCommand.replace("<UFVK>", "<viewing key>")}
        />
        <p className="zc-p">
          Copy gives the full command with the key in place. It needs a zingo-cli build that supports the latest
          Zcash testnet upgrade (NU7). Expect a confirmed balance of {d.balanceZat.toLocaleString("en-US")} zat,
          which is {formatZat(d.balanceZat)}.
        </p>
        <p className="zc-p">
          A wallet made from this key cannot send. Trying returns &quot;{d.spendCheck}&quot;.
        </p>
      </div>
    </details>
  );
}
