/**
 * Which execution RPCs a role uses: free public endpoints differ in what they accept, so the work is split.
 * `env` fallbacks (a dedicated node from `rpcEnv`) are added to every role.
 */
import type { Profile } from "./schemas/network.js";

export type RpcRole = "indexer" | "reads" | "writes";

export interface RpcEndpoint {
  url: string;
  /** requests per second this endpoint is given (indexer only) */
  rps: number;
}

const uniq = (xs: string[]): string[] => [...new Set(xs)];

export function executionRpcs(profile: Profile, role: RpcRole, env: Record<string, string | undefined> = {}): RpcEndpoint[] {
  const ex = profile.execution;
  const fromEnv = ex.rpcEnv.map((e) => env[e] ?? "").filter((u) => u.startsWith("http"));
  const rate = ex.maxRequestsPerSecond ?? 10;
  if (role === "indexer") {
    // without pools: the first configured RPC (others may cap the address count) plus env fallbacks
    const base = ex.rpcPools?.indexer ?? [{ url: ex.rpc[0] ?? "", rps: rate }];
    const seen = new Set(base.map((e) => e.url));
    return [...base, ...fromEnv.filter((u) => !seen.has(u)).map((url) => ({ url, rps: rate }))];
  }
  const urls = role === "reads" ? uniq([...fromEnv, ...(ex.rpcPools?.reads ?? []), ...ex.rpc]) : uniq([...ex.rpc, ...fromEnv]);
  return urls.map((url) => ({ url, rps: rate }));
}
