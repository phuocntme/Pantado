import type { Deployment } from "@pantado/shared";
import raw from "../generated/public-config.json";

export interface PublicConfig {
  profile: "contest" | "production";
  network: string;
  chainId: number;
  rpc: string;
  explorer: string;
  flags: { showFujiBadge: boolean; showReferenceBadge: boolean; gasSponsorship: boolean; autoFundOnSignIn: boolean };
  deployment: Deployment | null;
  apiUrl: string;
  /** services/agent (spec §10): POST /ask (SSE), POST /draft, GET /assessment/:index. */
  agentUrl: string;
  privyAppId: string;
  /** Gas sponsorship endpoint; empty = users pay gas. */
  paymasterUrl: string;
  devWalletKey: string;
  swapFeeBps: number;
}

/** Build-time public config (scripts/public-config.ts). */
export const CONFIG = raw as unknown as PublicConfig;

/**
 * How the execution network is named: in text ("Switch to Fuji"), on the top-bar badge and in the wallet's network
 * list. The local dev chain (`network: "local"`) is never called Fuji.
 */
export function networkNames(network: string): { label: string; badge: string; walletName: string } {
  if (network === "local") return { label: "local test chain", badge: "Local test chain", walletName: "Pantado local (Anvil)" };
  if (network === "fuji") return { label: "Fuji", badge: "Fuji testnet", walletName: "Avalanche Fuji C-Chain" };
  const n = network.charAt(0).toUpperCase() + network.slice(1);
  return { label: n, badge: n, walletName: n };
}
