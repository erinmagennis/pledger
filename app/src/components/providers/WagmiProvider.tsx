"use client";

// Wallet provider for the claim routes only (Base mainnet). Wraps src/app/claim/layout.tsx.
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createConfig, http, WagmiProvider } from "wagmi";
import { base } from "wagmi/chains";
import { coinbaseWallet, injected, walletConnect } from "wagmi/connectors";

const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WC_PROJECT_ID;

function makeConfig() {
  return createConfig({
    chains: [base],
    connectors: [
      injected(),
      // Needs @coinbase/wallet-sdk installed at runtime; the import is optional at build time.
      coinbaseWallet({ appName: "Pledger" }),
      ...(WC_PROJECT_ID ? [walletConnect({ projectId: WC_PROJECT_ID, showQrModal: true })] : []),
    ],
    transports: { [base.id]: http(process.env.NEXT_PUBLIC_BASE_RPC_URL || undefined) },
    ssr: true,
  });
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [config] = useState(makeConfig);
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
