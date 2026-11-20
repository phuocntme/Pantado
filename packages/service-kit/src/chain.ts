import { createPublicClient, createWalletClient, fallback, http, type Chain, type PublicClient, type Transport, type WalletClient, type Account } from "viem";
import { loadDeployment, loadProfile, type Deployment, type Profile, executionRpcs } from "@pantado/shared";
import { createReader, executionChain, type PantadoReader } from "@pantado/sdk";

export interface ChainContext {
  profile: Profile;
  deployment: Deployment;
  chain: Chain;
  publicClient: PublicClient;
  reader: PantadoReader;
  wallet(account: Account): WalletClient<Transport, Chain, Account>;
}

/**
 * Clients for the execution network of the active profile. `EXECUTION_RPC_URL` overrides the configured RPC
 * (local Anvil); env fallbacks from `rpcEnv` are appended.
 */
export function createChainContext(opts: { profile?: string; rpcUrl?: string; deployment?: Deployment } = {}): ChainContext {
  const profile = loadProfile(opts.profile);
  const deployment = opts.deployment ?? loadDeployment(opts.profile);
  const override = opts.rpcUrl ?? process.env.EXECUTION_RPC_URL;
  const chain = { ...executionChain(profile, override), id: deployment.chainId };
  // reads go to the read pool first, transactions out through the configured RPCs
  const urls = (role: "reads" | "writes"): string[] => (override ? [override] : executionRpcs(profile, role, process.env).map((e) => e.url));
  const reads = fallback(urls("reads").map((u) => http(u)));
  const transport = fallback(urls("writes").map((u) => http(u)));
  const publicClient = createPublicClient({ chain, transport: reads }) as PublicClient;
  return {
    profile,
    deployment,
    chain,
    publicClient,
    reader: createReader(publicClient, deployment),
    wallet: (account) => createWalletClient({ account, chain, transport }),
  };
}
