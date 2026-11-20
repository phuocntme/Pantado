/**
 * Writes src/generated/public-config.json from config/networks/<profile>.json and the deployments file
 * (no chain ids or addresses in app code). Runs before `next dev` / `next build`.
 * Env: PANTADO_PROFILE, PANTADO_DEPLOYMENTS, NEXT_PUBLIC_API_URL, NEXT_PUBLIC_RPC_URL,
 * NEXT_PUBLIC_PRIVY_APP_ID, NEXT_PUBLIC_DEV_WALLET_KEY (Anvil only).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDeployment, loadParams, loadProfile, type Deployment } from "@pantado/shared";

const profile = loadProfile();
let deployment: Deployment | null = null;
try {
  deployment = loadDeployment();
} catch {
  deployment = null; // not deployed yet: read-only pages still render
}
const chainId = deployment?.chainId ?? profile.execution.chainId;
const devKey = process.env.NEXT_PUBLIC_DEV_WALLET_KEY ?? "";
if (devKey && chainId !== 31337) throw new Error("NEXT_PUBLIC_DEV_WALLET_KEY is only allowed on a local Anvil chain (31337)");

// a local Anvil chain (dev stack) is never labelled as the profile's public network: wallets would add a "fuji"
// network pointing at localhost, and explorer links would point at a chain these transactions are not on
const local = chainId === 31337;
const pub = {
  profile: profile.profile,
  network: local ? "local" : profile.execution.network,
  chainId,
  rpc: process.env.NEXT_PUBLIC_RPC_URL ?? profile.execution.rpc[0],
  explorer: local ? "" : profile.execution.explorer,
  flags: profile.flags,
  deployment,
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001",
  agentUrl: process.env.NEXT_PUBLIC_AGENT_URL ?? "http://localhost:3002",
  privyAppId: process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "",
  paymasterUrl: process.env.NEXT_PUBLIC_PAYMASTER_URL ?? "",
  devWalletKey: devKey,
  /** SwapRouter fee (contracts/config/params.json): the instant swap estimate before the on-chain quote */
  swapFeeBps: loadParams().swapRouter.swapFeeBps,
};

const out = join(dirname(fileURLToPath(import.meta.url)), "../src/generated/public-config.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(pub, null, 2)}\n`);
console.log(`public config: ${profile.profile} / ${pub.network} (${chainId})`);
