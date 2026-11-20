import { describe, expect, it } from "vitest";
import type { Address, PublicClient } from "viem";
import { bucketStart, dateTs, PriceHistory } from "../src/history.js";
import { scanHistory, type HistoryJob } from "../src/history-scan.js";
import { decodeSwap, lbPrice, RpcSwapReader, type PoolRef } from "../src/sources/rpc-swaps.js";

const H = 3600;
const D = 86_400;
const T0 = 1_800_000_000 - (1_800_000_000 % D); // a day boundary

describe("PriceHistory", () => {
  it("builds bars from swaps read in any order and aggregates them to longer candles", () => {
    const h = new PriceHistory(0, 900);
    h.addSwap("x", T0 + 100, 11);
    h.addSwap("x", T0 + 10, 10); // earlier swap read later: becomes the open
    h.addSwap("x", T0 + 800, 9);
    h.addSwap("x", T0 + 900 + 5, 12);
    h.addSwap("x", T0 + H + 20, 13);
    expect(h.candles("x", 900, 10)).toEqual([
      { t: T0, o: 10, h: 11, l: 9, c: 9 },
      { t: T0 + 900, o: 12, h: 12, l: 12, c: 12 },
      { t: T0 + 1800, o: 12, h: 12, l: 12, c: 12 }, // no swap: flat at the previous close
      { t: T0 + 2700, o: 12, h: 12, l: 12, c: 12 },
      { t: T0 + H, o: 13, h: 13, l: 13, c: 13 },
    ]);
    expect(h.candles("x", H, 10)).toEqual([
      { t: T0, o: 10, h: 12, l: 9, c: 12 },
      { t: T0 + H, o: 13, h: 13, l: 13, c: 13 },
    ]);
    // until: flat candles up to now; before + limit: older pages
    expect(h.candles("x", H, 10, { until: T0 + 3 * H + 1 }).map((c) => c.c)).toEqual([12, 13, 13, 13]);
    expect(h.candles("x", 900, 2, { before: T0 + H })).toEqual([
      { t: T0 + 1800, o: 12, h: 12, l: 12, c: 12 },
      { t: T0 + 2700, o: 12, h: 12, l: 12, c: 12 },
    ]);
  });

  it("weekly candles start on Monday; days and weeks aggregate the same bars", () => {
    const h = new PriceHistory(0, 900);
    for (let d = 0; d < 14; d++) h.addSwap("x", T0 + d * D + 60, 100 + d);
    expect(new Date(bucketStart(T0 + 3 * D, 7 * D) * 1000).getUTCDay()).toBe(1);
    expect(h.candles("x", D, 100)).toHaveLength(14);
    const weeks = h.candles("x", 7 * D, 10);
    expect(weeks.every((w) => new Date(w.t * 1000).getUTCDay() === 1)).toBe(true);
    expect(weeks[weeks.length - 1]?.c).toBe(113);
  });

  it("changes use the price at each horizon, only where the history is complete", () => {
    const h = new PriceHistory(0, 900);
    const now = T0 + 40 * D;
    h.addSwap("x", now - 31 * D, 50);
    h.addSwap("x", now - 7 * D - 2 * H, 80);
    h.addSwap("x", now - D - 60, 100);
    h.setCovered("x", now - 20 * D);
    const c = h.changes("x", now, 110);
    expect(c.d1).toBeCloseTo(0.1);
    expect(c.d7).toBeCloseTo(110 / 80 - 1);
    expect(c.d30).toBeNull(); // not covered yet
    h.setCovered("x", now - 35 * D);
    expect(h.changes("x", now, 110).d30).toBeCloseTo(110 / 50 - 1);
  });

  it("round-trips through JSON with scan progress, dropping bars before `since`", () => {
    const h = new PriceHistory(T0, 900);
    h.addSwap("x", T0 + 5, 1.25);
    h.addSwap("x", T0 + 6, 1.2345678); // stored with 7 significant digits
    h.addSwap("x", T0 + 3 * D + 7, 3);
    h.addSwap("x", T0 - 10, 99); // before since: ignored
    h.setCovered("x", T0);
    h.scanned.set("avalanche:0xpool", [10, 20]);
    const k = new PriceHistory(T0, 900);
    expect(k.load(JSON.parse(JSON.stringify(h.toJSON())))).toBe(true);
    expect(k.candles("x", 900, 1000)).toHaveLength(h.candles("x", 900, 1000).length);
    expect(k.candles("x", 900, 1).at(-1)).toEqual(h.candles("x", 900, 1).at(-1));
    expect(k.candles("x", 900, 1)).toHaveLength(1);
    expect(k.candles("x", 900, 1000)[0]).toEqual({ t: T0, o: 1.25, h: 1.25, l: 1.234568, c: 1.234568 });
    expect(k.coveredFrom("x")).toBe(T0);
    expect(k.scanned.get("avalanche:0xpool")).toEqual([10, 20]);
    expect(k.closeAt("x", T0 + 5)).toBe(1.25); // the bar's open: the price at its first swap
    expect(k.closeAt("x", T0 + 6)).toBe(1.234568);
    expect(new PriceHistory(T0, 3600).load(h.toJSON())).toBe(false); // other bar length: not loaded
    expect(dateTs("2025-01-01")).toBe(1_735_689_600);
  });
});

describe("liquidity book swaps", () => {
  it("prices a bin and decodes packed amounts", () => {
    expect(lbPrice(2 ** 23, 20, 18, 6)).toBeCloseTo(1e12);
    expect(lbPrice(2 ** 23 + 100, 10, 18, 18)).toBeCloseTo(1.001 ** 100);
    const p: PoolRef = { address: "0x0000000000000000000000000000000000000003", dex: "liquidity-book", binStep: 10, token0: "0x0000000000000000000000000000000000000004", token1: "0x0000000000000000000000000000000000000005", dec0: 18, dec1: 6 };
    const x = 2n * 10n ** 18n;
    const y = 15n * 10n ** 6n;
    const d = decodeSwap(p, { id: 2 ** 23, amountsIn: `0x${x.toString(16).padStart(64, "0")}`, amountsOut: `0x${(y << 128n).toString(16).padStart(64, "0")}` });
    expect(d?.amount0).toBe(2);
    expect(d?.amount1).toBe(15);
    expect(d?.price).toBeCloseTo(1e12); // bin 2^23: 1 raw unit per raw unit = 10^12 whole token1 per whole token0
  });
});

describe("scanHistory", () => {
  const A = "0x00000000000000000000000000000000000000aa" as Address; // asset (token0)
  const W = "0x00000000000000000000000000000000000000bb" as Address; // wavax
  const U = "0x00000000000000000000000000000000000000cc" as Address; // usdc
  const P1 = "0x0000000000000000000000000000000000000001" as Address; // wavax/usdc v2
  const P2 = "0x0000000000000000000000000000000000000002" as Address; // asset/wavax v2

  /** 1 s blocks from T0 with block times in the logs; every 50th block each pool swaps: P1 at 20 USDC per WAVAX, P2 at 0.5 WAVAX per asset. */
  function chain(head: bigint) {
    const calls: [bigint, bigint, number][] = [];
    const client = {
      getBlockNumber: async () => head,
      getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: BigInt(T0) + blockNumber }),
      getLogs: async ({ address, fromBlock, toBlock }: { address: Address[]; fromBlock: bigint; toBlock: bigint }) => {
        calls.push([fromBlock, toBlock, address.length]);
        const out = [];
        for (let b = fromBlock; b <= toBlock; b++) {
          if (b % 50n !== 0n) continue;
          const blockTimestamp = BigInt(T0) + b;
          if (address.includes(P1)) // 1 WAVAX (18) in for 20 USDC (6) out
            out.push({ address: P1, blockNumber: b, blockTimestamp, logIndex: 0, eventName: "Swap", args: { amount0In: 10n ** 18n, amount1In: 0n, amount0Out: 0n, amount1Out: 20n * 10n ** 6n } });
          if (address.includes(P2)) out.push({ address: P2, blockNumber: b, blockTimestamp, logIndex: 1, eventName: "Swap", args: { amount0In: 2n * 10n ** 18n, amount1In: 0n, amount0Out: 0n, amount1Out: 10n ** 18n } });
        }
        return out;
      },
    } as unknown as PublicClient;
    return { client, calls };
  }
  const wavaxJob: HistoryJob = { id: "wavax", pool: { address: P1, dex: "uniswap-v2", token0: W, token1: U, dec0: 18, dec1: 6 }, invert: false, quote: "usd" };
  const assetJob: HistoryJob = { id: "asset", pool: { address: P2, dex: "uniswap-v2", token0: A, token1: W, dec0: 18, dec1: 18 }, invert: false, quote: "wavax" };
  const opts = { sinceBlock: 1000n, logRange: 1000n, maxAddresses: 10, minSwapUsd: 1 };

  it("reads every swap back to the start block, prices WAVAX-quoted assets in USD and resumes without re-reading", async () => {
    const { client, calls } = chain(5000n);
    const reader = new RpcSwapReader(client);
    const h = new PriceHistory(T0, 900);
    const r = await scanHistory(h, "c", reader, [wavaxJob, assetJob], opts);
    expect(r.complete).toBe(true);
    expect(h.candles("wavax", 900, 100).every((c) => c.c === 20)).toBe(true);
    expect(h.candles("asset", 900, 100).every((c) => c.c === 10)).toBe(true); // 0.5 WAVAX × 20 USD
    expect(h.coveredFrom("asset")).toBe(T0 + 1000);
    expect(h.scanned.get(`c:${P1.toLowerCase()}`)).toEqual([1000, 5000]);
    // chunks are aligned to the log range: [4000, 5000], [3000, 3999] …
    expect(calls.some(([f, t]) => f === 3000n && t === 3999n)).toBe(true);
    const n = calls.length;
    const again = await scanHistory(h, "c", reader, [wavaxJob, assetJob], opts);
    expect(again.chunks).toBe(0);
    expect(calls.length).toBe(n);
  });

  it("follows new blocks and reads a pool added later back to the start, with its quote pool", async () => {
    const a = chain(3000n);
    const h = new PriceHistory(T0, 900);
    await scanHistory(h, "c", new RpcSwapReader(a.client), [wavaxJob], opts);
    const b = chain(3600n);
    const r = await scanHistory(h, "c", new RpcSwapReader(b.client), [wavaxJob, assetJob], opts);
    expect(r.complete).toBe(true);
    expect(h.scanned.get(`c:${P1.toLowerCase()}`)).toEqual([1000, 3600]);
    expect(h.scanned.get(`c:${P2.toLowerCase()}`)).toEqual([1000, 3600]);
    // the old pool read only its new blocks on its own; the new pool was read back with its quote's (WAVAX) pool
    expect(b.calls.filter(([f]) => f === 3001n)).toEqual([[3001n, 3600n, 1]]);
    expect(b.calls.filter(([, t]) => t < 3001n).every(([, , n]) => n === 2)).toBe(true);
    expect(h.candles("asset", 900, 100).every((c) => c.c === 10)).toBe(true);
  });

  it("stops after a few backward rounds so new blocks keep being followed", async () => {
    const { client } = chain(10_000n);
    const h = new PriceHistory(T0, 900);
    const r = await scanHistory(h, "c", new RpcSwapReader(client), [wavaxJob], { ...opts, parallel: 1, backwardRounds: 2 });
    expect(r.complete).toBe(false);
    expect(h.scanned.get(`c:${P1.toLowerCase()}`)?.[0]).toBe(9000); // [10000, 10000] then [9000, 9999]
  });

  it("skips dust swaps", async () => {
    const { client } = chain(2000n);
    const h = new PriceHistory(T0, 900);
    await scanHistory(h, "c", new RpcSwapReader(client), [wavaxJob], { ...opts, minSwapUsd: 50 }); // each swap is 20 USD
    expect(h.size("wavax")).toBe(0);
  });
});
