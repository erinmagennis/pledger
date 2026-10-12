"use client";

import type { ReactNode } from "react";
import { useNet } from "@/lib/network";

/** Shows the testnet or the mainnet version of the Zcash pledge. Both are rendered on the server
 * (the page stays static); this only picks one from the header's network choice. */
export function ZcashNetworkView({ testnet, mainnet }: { testnet: ReactNode; mainnet: ReactNode }) {
  const { net } = useNet();
  return <>{net === "mainnet" ? mainnet : testnet}</>;
}
