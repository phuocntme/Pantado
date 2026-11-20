import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { loadAssets, loadProfile, loadServices } from "@pantado/shared";
import { createLogger } from "@pantado/service-kit";
import { Registry } from "prom-client";
import type { PoolRef, SwapRecord } from "../src/sources/rpc-swaps.js";
import { MarketData } from "../src/service.js";
import { readVolume, swapUsd, Volume24h, type VolumePool } from "../src/volume.js";

const ref = (address: string): PoolRef => ({ address: address as Address, dex: "uniswap-v2", token0: "0x01" as Address, token1: "0x02" as Address, dec0: 18, dec1: 6 });
const rec = (pool: string, ts: number, amount0: number, amount1: number, block = 1n): SwapRecord => ({ pool, block, logIndex: 0, ts, price: 0, amount0, amount1 });
const prices: Record<string, number> = { wavax: 7, usdc: 1, joe: 0.02, btcb: 65_000 };
const price = (id: string): number | null => prices[id] ?? null;
const PRIORITY = ["usdc", "usdt", "wavax", "btcb"];

describe("reference-market volume", () => {
  it("values a swap on the preferred side of its pool", () => {
    const wavaxUsdc: VolumePool = { ref: ref("0xa"), ids: ["wavax", "usdc"] };
    expect(swapUsd(rec("0xa", 1, 10, 70.5), wavaxUsdc, price, PRIORITY)).toBe(70.5); // USDC side
    const joeWavax: VolumePool = { ref: ref("0xb"), ids: ["joe", "wavax"] };
    expect(swapUsd(rec("0xb", 1, 5000, 14), joeWavax, price, PRIORITY)).toBe(98); // WAVAX side, not JOE
    const unknown: VolumePool = { ref: ref("0xc"), ids: ["zzz", "yyy"] };
    expect(swapUsd(rec("0xc", 1, 1, 1), unknown, price, PRIORITY)).toBeNull();
    // stock reference pool: the reference quote counts at $1
    const stock: VolumePool = { ref: ref("0xd"), ids: ["nvda", null], fixedUsd: [null, 1] };
    expect(swapUsd(rec("0xd", 1, 2, 330), stock, () => null, PRIORITY)).toBe(330);
  });

  it("rolls a 24h window: per asset (a swap counts for both assets of its pool), the total once", () => {
    const v = new Volume24h(86_400);
    v.register([
      { ref: ref("0xa"), ids: ["wavax", "usdc"] },
      { ref: ref("0xb"), ids: ["joe", "wavax"] },
    ]);
    const now = 1_000_000;
    v.add("0xA", now - 100, 50);
    v.add("0xb", now - 200, 20);
    v.add("0xa", now - 90_000, 999); // older than the window
    const t = v.totals(now);
    expect(t.total).toBe(70);
    expect(Object.fromEntries(t.byAsset)).toEqual({ wavax: 70, usdc: 50, joe: 20 });
    v.prune(now);
    expect(v.totals(now + 86_400).total).toBe(0);
    expect(v.ready(["avalanche"])).toBe(false);
    v.setCovered("avalanche", now - 86_400);
    expect(v.ready(["avalanche"])).toBe(true);
  });

  it("reads a block range in chunks, all or nothing", async () => {
    const pools: VolumePool[] = [{ ref: ref("0xa"), ids: ["wavax", "usdc"] }];
    const ranges: [bigint, bigint][] = [];
    let failAt: bigint | null = null;
    const reader = {
      scan: async (_p: PoolRef[], from: bigint, to: bigint): Promise<SwapRecord[]> => {
        ranges.push([from, to]);
        if (failAt !== null && from >= failAt) throw new Error("429");
        return [rec("0xa", Number(from), 1, 10, from)];
      },
    };
    const v = new Volume24h();
    const opts = { logRange: 100n, maxAddresses: 10, price, priority: PRIORITY };
    expect(await readVolume(v, reader, pools, 0n, 250n, opts)).toBe(3);
    expect(ranges).toEqual([[0n, 99n], [100n, 199n], [200n, 250n]]);
    expect(v.totals(1000).total).toBe(30);
    // a failure part-way adds nothing, so the retry cannot double-count
    failAt = 400n;
    await expect(readVolume(v, reader, pools, 300n, 450n, opts)).rejects.toThrow("429");
    expect(v.totals(1000).total).toBe(30);
  });

  it("volume pools: every confirmed Avalanche pool between registry assets; stocks' reference pools at $1 quote", () => {
    const md = new MarketData({
      assets: loadAssets(),
      profile: loadProfile("contest"),
      services: loadServices(),
      mode: "live",
      avalanche: null,
      robinhood: null,
      stockApi: null,
      sink: null,
      log: createLogger("t"),
      registry: new Registry(),
    });
    const vp = md.volumePools();
    const confirmed = (loadProfile("contest").data.avalanche.pools ?? []).filter((p) => p.confirmed);
    expect(vp.avalanche.length).toBe(confirmed.length);
    for (const p of vp.avalanche) expect(p.ids.every((x) => typeof x === "string")).toBe(true);
    const stocks = loadAssets().filter((a) => a.kind === "stock");
    expect(vp.robinhood.map((p) => p.ids.find((x) => x !== null)).sort()).toEqual(stocks.map((a) => a.id).sort());
    for (const p of vp.robinhood) {
      const quoteSide = p.ids.indexOf(null);
      expect(p.fixedUsd?.[quoteSide]).toBe(1);
    }
  });
});
