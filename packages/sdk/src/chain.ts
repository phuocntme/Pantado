import { defineChain, type Chain } from "viem";
import type { Profile } from "@pantado/shared";

/** viem chain for the profile's execution network; `rpcOverride` for local Anvil runs. */
export function executionChain(profile: Profile, rpcOverride?: string): Chain {
  const e = profile.execution;
  const rpc = rpcOverride ?? e.rpc[0];
  if (!rpc) throw new Error("no execution RPC configured");
  return defineChain({
    id: rpcOverride && e.network !== "anvil" ? 31337 : e.chainId,
    name: e.network,
    nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
    blockExplorers: { default: { name: "Explorer", url: e.explorer } },
  });
}
