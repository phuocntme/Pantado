import { describe, expect, it } from "vitest";
import { executionRpcs, loadProfile } from "../src/index.js";

describe("execution RPC roles", () => {
  const p = loadProfile("contest");
  const pools = p.execution.rpcPools;

  it("the indexer pool: only endpoints that take many-address getLogs, each with its rate, plus a dedicated node", () => {
    const ix = executionRpcs(p, "indexer", { FUJI_RPC_URL_FALLBACK: "https://node.example/rpc" });
    expect(pools).toBeDefined();
    expect(ix.slice(0, -1)).toEqual(pools?.indexer);
    expect(ix.at(-1)).toEqual({ url: "https://node.example/rpc", rps: p.execution.maxRequestsPerSecond });
    expect(ix.map((e) => e.url)).not.toContain("https://avalanche-fuji-c-chain-rpc.publicnode.com"); // caps addresses at 10
  });

  it("reads try the dedicated node and the read pool before the transaction RPCs; writes use the configured RPCs", () => {
    const env = { FUJI_RPC_URL_FALLBACK: "https://node.example/rpc" };
    const reads = executionRpcs(p, "reads", env).map((e) => e.url);
    expect(reads.slice(0, 1 + (pools?.reads.length ?? 0))).toEqual(["https://node.example/rpc", ...(pools?.reads ?? [])]);
    expect(new Set(reads).size).toBe(reads.length);
    expect(executionRpcs(p, "writes", env).map((e) => e.url)).toEqual([...p.execution.rpc, "https://node.example/rpc"]);
    // env values that are not URLs are ignored
    expect(executionRpcs(p, "writes", { FUJI_RPC_URL_FALLBACK: "" }).map((e) => e.url)).toEqual(p.execution.rpc);
  });

  it("without pools every role falls back to the configured RPCs (the indexer: the first)", () => {
    const bare = { ...p, execution: { ...p.execution, rpcPools: undefined } };
    expect(executionRpcs(bare, "indexer").map((e) => e.url)).toEqual(p.execution.rpc.slice(0, 1));
    expect(executionRpcs(bare, "reads").map((e) => e.url)).toEqual(p.execution.rpc);
  });
});
