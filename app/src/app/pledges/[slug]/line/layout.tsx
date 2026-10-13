import { WalletProvider } from "@/components/providers/WagmiProvider";
import "@/components/claim/claim.css";

export default function ClaimLayout({ children }: { children: React.ReactNode }) {
  return <WalletProvider>{children}</WalletProvider>;
}
