import { describe, expect, it } from "vitest";
import { Registry } from "prom-client";
import { createLogger } from "@pantado/service-kit";
import { loadAssets, loadProfile, loadServices } from "@pantado/shared";
import { dropOutliers, twap } from "../src/engine/stats.js";
import { tokenPrices, type PoolSnapshot } from "../src/engine/tokens.js";
import { stockPrice } from "../src/engine/stocks.js";
import { assembleCanonical } from "../src/canonical.js";
import { v2Price, v3Price } from "../src/sources/rpc-swaps.js";
import { MarketData } from "../src/service.js";

const cfg = { minLiquidityUsd: 5000, outlierSigma: 3, outlierWindow: 20, quoteId: "usdc", wrappedNativeId: "wavax" };
const swaps = (p: number, n = 10, t0 = 1000) => Array.from({ length: n }, (_, i) => ({ ts: t0 + i, price: p * (1 + (i % 2 ? 0.001 : -0.001)) }));

describe("stats", () => {
  it("drops a 3σ outlier from the last 20", () => {
    const obs = [...swaps(10, 19), { ts: 2000, price: 100 }];
    expect(dropOutliers(obs, 3, 20).some((o) => o.price === 100)).toBe(false);
    expect(dropOutliers(obs, 3, 20)).toHaveLength(19);
  });
  it("twap weights by time", () => {
    // 10 for the first 30 s of the window, 20 for the last 30 s
    expect(twap([{ ts: 0, price: 10 }, { ts: 70, price: 20 }], 60, 100)).toBeCloseTo(15, 9);
    expect(twap([], 60, 100)).toBeNull();
  });
});

describe("token engine", () => {
  const pools: PoolSnapshot[] = [
    { address: "0xa", token0: "wavax", token1: "usdc", liquidityUsd: 1e7, swaps: swaps(7.36) },
    { address: "0xb", token0: "wavax", token1: "usdc", liquidityUsd: 1e5, swaps: swaps(9) }, // shallower: ignored
    { address: "0xc", token0: "joe", token1: "wavax", liquidityUsd: 2e6, swaps: swaps(0.05) },
    { address: "0xd", token0: "usdc", token1: "btcb", liquidityUsd: 3e6, swaps: swaps(1 / 65_000) }, // inverted orientation
    { address: "0xe", token0: "savax", token1: "usdc", liquidityUsd: 4000, swaps: swaps(9) }, // under $5k
  ];
  const out = tokenPrices(["wavax", "joe", "btcb", "savax"], pools, cfg);
  it("WAVAX from the deepest WAVAX/USDC pool", () => {
    expect(out.get("wavax")?.source).toBe("0xa");
    expect(out.get("wavax")?.usd).toBeCloseTo(7.36, 1);
  });
  it("others via USDC or WAVAX, orientation-aware", () => {
    expect(out.get("joe")?.usd).toBeCloseTo(0.05 * 7.36, 2);
    expect(Math.abs((out.get("btcb")?.usd ?? 0) / 65_000 - 1)).toBeLessThan(0.002);
  });
  it("ignores pools under the liquidity floor", () => expect(out.has("savax")).toBe(false));
  it("a deeper pool without a price does not hide a priced one", () => {
    const r = tokenPrices(["wavax", "arena"], [
      ...pools,
      { address: "0x20", token0: "wavax", token1: "arena", liquidityUsd: 9e4, swaps: [] }, // deepest, quiet
      { address: "0x21", token0: "wavax", token1: "arena", liquidityUsd: 4e4, swaps: swaps(15_000) },
    ], cfg);
    expect(r.get("arena")?.source).toBe("0x21");
  });
  it("prices a token that only trades against another listed token, through that token", () => {
    const more: PoolSnapshot[] = [
      ...pools,
      { address: "0xf", token0: "solvbtc", token1: "btcb", liquidityUsd: 2e5, swaps: swaps(1.001) },
      { address: "0x10", token0: "x", token1: "solvbtc", liquidityUsd: 1e5, swaps: swaps(0.5) }, // two hops away
    ];
    const r = tokenPrices(["wavax", "btcb", "solvbtc", "x"], more, cfg);
    expect(r.get("solvbtc")?.source).toBe("0xf");
    expect(Math.abs((r.get("solvbtc")?.usd ?? 0) / (65_000 * 1.001) - 1)).toBeLessThan(0.003);
    expect(Math.abs((r.get("x")?.usd ?? 0) / (65_000 * 1.001 * 0.5) - 1)).toBeLessThan(0.005);
  });
});

describe("stock engine", () => {
  const c = { twapSec: 60, referenceMaxAgeSec: 900 };
  const api = { usd: 165, ts: 5000, source: "stock-api" };
  it("uses the reference TWAP when the pool traded recently", () => {
    const p = stockPrice({ pool: "0xp", swaps: [{ ts: 4950, price: 164 }] }, api, 5000, c);
    expect(p?.usd).toBe(164);
    expect(p?.source).toBe("robinhood:0xp");
  });
  it("falls back to the API after 900 s without trades", () => {
    expect(stockPrice({ pool: "0xp", swaps: [{ ts: 4000, price: 164 }] }, api, 5000, c)).toEqual(api);
    expect(stockPrice(null, null, 5000, c)).toBeNull();
  });
});

describe("pool price decoding", () => {
  it("v3 sqrtPriceX96", () => {
    // WAVAX(18)/USDC(6) at 7.36: sqrt(7.36e-12) * 2^96
    const sqrt = BigInt(Math.round(Math.sqrt(7.36e-12) * 2 ** 96));
    expect(v3Price(sqrt, 18, 6)).toBeCloseTo(7.36, 6);
  });
  it("v2 amounts", () => {
    expect(v2Price(10n ** 18n, 0n, 0n, 7_360_000n, 18, 6)).toBeCloseTo(7.36, 9);
    expect(v2Price(0n, 0n, 0n, 0n, 18, 6)).toBeNull();
  });
});

describe("canonical", () => {
  const assets = loadAssets();
  it("omits assets without a source and the quote", () => {
    const m = new Map([["nvda", { usd: 164.6, ts: 1, source: "x" }], ["usdc", { usd: 1, ts: 1, source: "x" }]]);
    const out = assembleCanonical(assets, m, new Map([["nvda", { usd: 165, ts: 1, source: "api" }]]));
    expect(out).toEqual([{ id: "nvda", canonical: { usd: "164.6", ts: 1, source: "x" }, crossCheck: { usd: "165", ts: 1, source: "api" } }]);
  });
  it("history jobs: one per token, each on a pool of that token (the pool whose `history` names it)", () => {
    const profile = loadProfile("contest");
    const md = new MarketData({
      assets: loadAssets(),
      profile,
      services: loadServices(),
      mode: "live",
      avalanche: null,
      robinhood: null,
      stockApi: null,
      sink: null,
      log: createLogger("t"),
      registry: new Registry(),
    });
    const jobs = md.historyJobs().avalanche;
    const tokens = loadAssets().filter((a) => a.kind === "token");
    expect(jobs.map((j) => j.id).sort()).toEqual(tokens.map((a) => a.id).sort());
    const pools = profile.data.avalanche.pools ?? [];
    for (const j of jobs) {
      const cfg = pools.find((p) => p.address.toLowerCase() === j.pool.address.toLowerCase());
      expect(cfg && (cfg.token0 === j.id || cfg.token1 === j.id), j.id).toBe(true);
      expect(cfg?.history, j.id).toBe(j.id);
    }
    expect(jobs.find((j) => j.id === "wavax")?.quote).toBe("usd");
    expect(jobs.find((j) => j.id === "mqt")?.quote).toBe("usdt");
  });
  it("seed mode serves every non-quote asset labelled 'seed'", async () => {
    const md = new MarketData({
      assets,
      profile: loadProfile("contest"),
      services: loadServices(),
      mode: "seed",
      avalanche: null,
      robinhood: null,
      stockApi: null,
      sink: null,
      log: createLogger("t"),
      registry: new Registry(),
      now: () => 1234,
    });
    const r = await md.refresh();
    expect(r.prices).toHaveLength(60); // 25 stocks + 35 tokens; USDC is fixed
    expect(r.prices.every((p) => p.canonical.source === "seed" && p.canonical.ts === 1234)).toBe(true);
  });
  it("live mode with nothing confirmed prices nothing (no fabricated data)", async () => {
    const md = new MarketData({
      assets,
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
    expect((await md.refresh()).prices).toEqual([]);
  });
});
