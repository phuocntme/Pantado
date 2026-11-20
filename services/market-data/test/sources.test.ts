import { describe, expect, it } from "vitest";
import type { Address, PublicClient } from "viem";
import { poolOrder, RpcSwapReader, type PoolRef } from "../src/sources/rpc-swaps.js";
import { RobinhoodFeedStockApi } from "../src/sources/stock-api.js";

const A = "0x00000000000000000000000000000000000000aa" as Address;
const B = "0x00000000000000000000000000000000000000bb" as Address;
const POOL = "0x00000000000000000000000000000000000000cc" as Address;
const Q96 = 2n ** 96n;

/** Fake chain: block n has timestamp 1000 + n (1 s blocks); a v3 swap every 10 blocks at price 4. */
function fakeChain(headRef: { head: bigint }) {
  const calls: { from: bigint; to: bigint }[] = [];
  const client = {
    getBlockNumber: async () => headRef.head,
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: 1000n + blockNumber }),
    getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
      calls.push({ from: fromBlock, to: toBlock });
      const logs = [];
      for (let b = fromBlock; b <= toBlock; b++)
        if (b % 10n === 0n) logs.push({ blockNumber: b, args: { sqrtPriceX96: 2n * Q96 } });
      return logs;
    },
  } as unknown as PublicClient;
  return { client, calls };
}

describe("RpcSwapReader", () => {
  const ref: PoolRef = { address: POOL, dex: "uniswap-v3", token0: A, token1: B, dec0: 18, dec1: 18 };

  it("reads a time window in capped chunks, then only new blocks", async () => {
    const h = { head: 20_000n };
    const { client, calls } = fakeChain(h);
    const r = new RpcSwapReader(client, { maxLogRange: 100n });
    const first = await r.swaps(ref, 300);
    // 300 s × 1.1 at 1 s/block → 330 blocks back, in ≤ 100-block chunks
    expect(calls.every((c) => c.to - c.from < 100n)).toBe(true);
    expect(calls[0]?.from).toBe(20_000n - 330n);
    expect(first.every((o) => o.price === 4)).toBe(true);
    expect(first.every((o) => o.ts >= 1000 + 20_000 - 300)).toBe(true);
    expect(first.at(-1)?.ts).toBe(1000 + 20_000); // interpolated from the head timestamp

    calls.length = 0;
    h.head = 20_050n;
    const next = await r.swaps(ref, 300);
    expect(calls).toEqual([{ from: 20_001n, to: 20_050n }]); // cursor: new blocks only
    expect(next.at(-1)?.ts).toBe(1000 + 20_050);
    expect(next.every((o) => o.ts >= 1000 + 20_050 - 300)).toBe(true); // old swaps pruned
  });

  it("prices a quiet pool from its state at the head block's time: v2 reserves, LB active bin, v3 only with in-range liquidity", async () => {
    const h = { head: 500n };
    const { client } = fakeChain(h);
    let v3Liquidity = 0n;
    const withState = {
      ...client,
      readContract: async ({ functionName }: { functionName: string }) => {
        if (functionName === "getReserves") return [10n ** 21n, 2n * 10n ** 9n, 0] as const; // 1000 token0 (18 dec) : 2000 token1 (6 dec)
        if (functionName === "getActiveId") return 2 ** 23 + 100;
        if (functionName === "slot0") return 2n * Q96;
        if (functionName === "liquidity") return v3Liquidity;
        throw new Error(functionName);
      },
    } as unknown as PublicClient;
    const r = new RpcSwapReader(withState, { maxLogRange: 100n });
    expect(await r.v2Spot({ ...ref, dex: "uniswap-v2", dec1: 6 })).toEqual({ ts: 1500, price: 2 });
    const lb = await r.v2Spot({ ...ref, dex: "liquidity-book", binStep: 10 });
    expect(lb?.price).toBeCloseTo(1.001 ** 100, 9);
    // v3: the tick of a pool whose in-range liquidity is gone can sit at a range edge → no price
    expect(await r.v2Spot(ref)).toBeNull();
    v3Liquidity = 10n ** 18n;
    expect(await r.v2Spot(ref)).toEqual({ ts: 1500, price: 4 });
  });

  it("orders pool tokens by address", () => {
    expect(poolOrder(B, A)).toEqual([A, B]);
    expect(poolOrder(A, B)).toEqual([A, B]);
  });
});

describe("RobinhoodFeedStockApi", () => {
  const feed = "0x00000000000000000000000000000000000000f1" as Address;
  const client = {
    readContract: async () => [1n, 16_140_000_000n, 0n, 1_700_000_000n, 1n],
  } as unknown as PublicClient;

  it("reads <SYMBOL>/USD feeds and skips unconfirmed or missing ones", async () => {
    const api = new RobinhoodFeedStockApi(client, {
      "NVDA/USD": { address: feed, decimals: 8, confirmed: true },
      "AAPL/USD": { address: feed, decimals: 8, confirmed: false },
    });
    expect(await api.lastTrade("NVDA")).toEqual({ usd: 161.4, ts: 1_700_000_000, source: `chainlink:${feed}` });
    expect(await api.lastTrade("AAPL")).toBeNull();
    expect(await api.lastTrade("AVGO")).toBeNull();
  });
});

describe("RpcSwapReader.swapsMany", () => {
  it("reads many pools with one grouped eth_getLogs per range, then only new blocks", async () => {
    const P = Array.from({ length: 12 }, (_, i) => `0x${(i + 1).toString(16).padStart(40, "0")}` as Address);
    const head = { head: 1000n };
    const calls: { n: number; from: bigint; to: bigint }[] = [];
    const client = {
      getBlockNumber: async () => head.head,
      getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: 1000n + blockNumber }),
      getLogs: async ({ address, fromBlock, toBlock }: { address: Address[]; fromBlock: bigint; toBlock: bigint }) => {
        calls.push({ n: address.length, from: fromBlock, to: toBlock });
        const out = [];
        for (let b = fromBlock; b <= toBlock; b++)
          if (b % 20n === 0n) for (const a of address) out.push({ address: a, blockNumber: b, logIndex: 0, eventName: "Swap", args: { sqrtPriceX96: 2n * Q96, amount0: 1n, amount1: -4n } });
        return out;
      },
    } as unknown as PublicClient;
    const r = new RpcSwapReader(client, { maxLogRange: 100n });
    const refs: PoolRef[] = P.map((address) => ({ address, dex: "uniswap-v3", token0: A, token1: B, dec0: 18, dec1: 18 }));
    const m = await r.swapsMany(refs, 300, undefined, 10);
    // 330 blocks back → 4 ranges × 2 address groups (10 + 2)
    expect(calls).toHaveLength(8);
    expect(calls.map((c) => c.n).sort()).toEqual([10, 10, 10, 10, 2, 2, 2, 2].sort());
    expect(m.get(P[11]?.toLowerCase() ?? "")?.every((o) => o.price === 4)).toBe(true);
    calls.length = 0;
    head.head = 1040n;
    const m2 = await r.swapsMany(refs, 300, undefined, 10);
    expect(calls).toEqual([{ n: 10, from: 1001n, to: 1040n }, { n: 2, from: 1001n, to: 1040n }]);
    expect(m2.get(P[0]?.toLowerCase() ?? "")?.at(-1)?.ts).toBe(1000 + 1040);
  });
});
