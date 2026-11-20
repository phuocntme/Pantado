import { Counter, Gauge, type Registry } from "prom-client";
import type { Address } from "viem";
import type { VolumePool } from "./volume.js";
import type { Logger } from "@pantado/service-kit";
import type { Asset, CanonicalPrice, InternalPrices, Profile, Services } from "@pantado/shared";
import { assembleCanonical, seedPrices } from "./canonical.js";
import { stockPrice } from "./engine/stocks.js";
import { tokenPrices, type EnginePrice, type PoolSnapshot } from "./engine/tokens.js";
import { readFeed } from "./sources/chainlink.js";
import { poolOrder, type PoolRef, type RpcSwapReader } from "./sources/rpc-swaps.js";
import type { Obs } from "./engine/stats.js";
import type { StockApi } from "./sources/stock-api.js";
import type { HistoryJob } from "./history-scan.js";

export interface PriceSink {
  publish(prices: CanonicalPrice[]): Promise<void>;
}

export interface MarketDataDeps {
  assets: Asset[];
  profile: Profile;
  services: Services;
  mode: "live" | "seed";
  avalanche: RpcSwapReader | null;
  robinhood: RpcSwapReader | null;
  stockApi: StockApi | null;
  sink: PriceSink | null;
  log: Logger;
  registry: Registry;
  now?: () => number;
}

export class MarketData {
  private latest: InternalPrices = { asOf: 0, prices: [] };
  lastOkAt = 0;
  private readonly m;

  constructor(private readonly d: MarketDataDeps) {
    const r = [d.registry];
    this.m = {
      refresh: new Counter({ name: "marketdata_refresh_total", help: "refresh cycles", labelNames: ["result"], registers: r }),
      priced: new Gauge({ name: "marketdata_assets_priced", help: "assets with a canonical price", registers: r }),
      sourceErrors: new Counter({ name: "marketdata_source_errors_total", help: "failed pool / feed / chain reads", labelNames: ["source"], registers: r }),
      deviation: new Gauge({ name: "marketdata_crosscheck_deviation_bps", help: "canonical vs cross-check", labelNames: ["asset"], registers: r }),
    };
  }

  private now(): number {
    return this.d.now ? this.d.now() : Math.floor(Date.now() / 1000);
  }

  /** One failing pool, feed or chain must not take every other price down: log, count, return null. */
  private async guard<T>(what: string, fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch (e) {
      this.m.sourceErrors.inc({ source: what.split(" ")[0] ?? what });
      this.d.log.warn("source read failed", { what, error: e instanceof Error ? e.message.split("\n")[0] : String(e) });
      return null;
    }
  }

  /**
   * History jobs per data chain: each token reads its history pool (the pool whose `history` names it, else its first
   * whitelisted pool vs USDC, then vs WAVAX, then any); each stock reads its reference pool vs the reference quote. The
   * choice does not depend on live data, so a restart resumes the same scan.
   */
  historyJobs(): { avalanche: HistoryJob[]; robinhood: HistoryJob[] } {
    const { assets, profile } = this.d;
    const byId = new Map(assets.map((a) => [a.id, a]));
    const avalanche: HistoryJob[] = [];
    const robinhood: HistoryJob[] = [];
    const pools = (profile.data.avalanche.pools ?? []).filter((p) => p.confirmed);
    const addr = (id: string): Address | null => {
      const a = byId.get(id);
      return a && a.kind !== "stock" && a.display.confirmed && a.display.address !== "TODO" ? a.display.address : null;
    };
    for (const a of assets) {
      if (a.kind !== "token") continue;
      const mine = pools.filter((p) => p.token0 === a.id || p.token1 === a.id);
      const pick =
        mine.find((p) => p.history === a.id) ??
        mine.find((p) => p.token0 === "usdc" || p.token1 === "usdc") ??
        mine.find((p) => p.token0 === "wavax" || p.token1 === "wavax") ??
        mine[0];
      if (!pick) continue;
      const other = pick.token0 === a.id ? pick.token1 : pick.token0;
      const t0 = addr(pick.token0);
      const t1 = addr(pick.token1);
      const a0 = byId.get(pick.token0);
      const a1 = byId.get(pick.token1);
      if (!t0 || !t1 || !a0 || !a1) continue;
      avalanche.push({
        id: a.id,
        pool: { address: pick.address, dex: pick.dex, binStep: pick.binStep, token0: t0, token1: t1, dec0: a0.decimals, dec1: a1.decimals },
        invert: pick.token1 === a.id,
        quote: byId.get(other)?.kind === "quote" ? "usd" : other,
      });
    }
    const quote = profile.data.robinhood.referenceQuote;
    for (const a of assets) {
      if (a.kind !== "stock" || !quote?.confirmed) continue;
      const disp = a.display;
      if (!disp.confirmed || !disp.dex || disp.referencePool === "TODO" || disp.token === "TODO") continue;
      const [t0, t1] = poolOrder(disp.token, quote.address);
      const stockIs0 = t0.toLowerCase() === disp.token.toLowerCase();
      robinhood.push({
        id: a.id,
        pool: { address: disp.referencePool, dex: disp.dex, token0: t0, token1: t1, dec0: stockIs0 ? a.decimals : quote.decimals, dec1: stockIs0 ? quote.decimals : a.decimals },
        invert: !stockIs0,
        quote: "usd",
      });
    }
    return { avalanche, robinhood };
  }

  /**
   * Pools whose swaps make the reference-market volume: every confirmed Avalanche pool between two registry assets,
   * and each stock's Robinhood Chain reference pool (the reference quote counts at $1).
   */
  volumePools(): { avalanche: VolumePool[]; robinhood: VolumePool[] } {
    const { assets, profile } = this.d;
    const byId = new Map(assets.map((a) => [a.id, a]));
    const addrOf = (id: string): Address | null => {
      const a = byId.get(id);
      return a && a.kind !== "stock" && a.display.confirmed && a.display.address !== "TODO" ? a.display.address : null;
    };
    const avalanche: VolumePool[] = (profile.data.avalanche.pools ?? [])
      .filter((p) => p.confirmed)
      .flatMap((p) => {
        const t0 = addrOf(p.token0);
        const t1 = addrOf(p.token1);
        const a0 = byId.get(p.token0);
        const a1 = byId.get(p.token1);
        if (!t0 || !t1 || !a0 || !a1) return [];
        return [{ ref: { address: p.address, dex: p.dex, binStep: p.binStep, token0: t0, token1: t1, dec0: a0.decimals, dec1: a1.decimals }, ids: [p.token0, p.token1] as [string, string] }];
      });
    const robinhood: VolumePool[] = this.historyJobs().robinhood.map((j) => ({
      ref: j.pool,
      ids: j.invert ? [null, j.id] : [j.id, null],
      fixedUsd: j.invert ? [1, null] : [null, 1],
    }));
    return { avalanche, robinhood };
  }

  snapshot(): InternalPrices {
    return this.latest;
  }

  private async tokenSide(): Promise<{ canonical: Map<string, EnginePrice>; cross: Map<string, EnginePrice> }> {
    const { assets, profile, services, avalanche } = this.d;
    const canonical = new Map<string, EnginePrice>();
    const cross = new Map<string, EnginePrice>();
    if (!avalanche) return { canonical, cross };
    const byId = new Map(assets.map((a) => [a.id, a]));
    const addrOf = (id: string): Address | null => {
      const a = byId.get(id);
      return a && a.kind !== "stock" && a.display.confirmed && a.display.address !== "TODO" ? a.display.address : null;
    };
    const tokens = assets.filter((a) => a.kind === "token");
    const windowSec = services.marketData.tokenWindowSec;
    const head = await avalanche.client.getBlockNumber();
    const pools = (profile.data.avalanche.pools ?? []).filter((p) => p.confirmed);
    const refsAll = pools.flatMap((p) => {
      const t0 = addrOf(p.token0);
      const t1 = addrOf(p.token1);
      const a0 = byId.get(p.token0);
      const a1 = byId.get(p.token1);
      if (!t0 || !t1 || !a0 || !a1) return [];
      const ref: PoolRef = { address: p.address, dex: p.dex, binStep: p.binStep, token0: t0, token1: t1, dec0: a0.decimals, dec1: a1.decimals };
      return [{ ids: [p.token0, p.token1] as [string, string], ref }];
    });
    // every pool's new swaps in a few grouped log reads
    const all = (await this.guard("pools", () => avalanche.swapsMany(refsAll.map((r) => r.ref), windowSec, head, profile.data.avalanche.maxLogAddresses ?? 10))) ?? new Map<string, Obs[]>();
    const read = await Promise.all(
      refsAll.map(async ({ ids, ref }) => {
        let swaps: Obs[] | null = all.get(ref.address.toLowerCase()) ?? null;
        // no trade in the window: pool state still gives its price (v2 reserves, active bin, in-range v3 tick; B64)
        if (swaps && swaps.length === 0) {
          const spot = await this.guard(`reserves ${ref.address}`, () => avalanche.v2Spot(ref, head));
          if (spot) swaps = [spot];
        }
        return swaps ? { ids, ref, swaps } : null;
      }),
    );
    const refs = read.filter((r): r is NonNullable<typeof r> => r !== null);
    const engineCfg = {
      minLiquidityUsd: services.marketData.minLiquidityUsd,
      outlierSigma: services.marketData.outlierSigma,
      outlierWindow: services.marketData.outlierWindow,
      quoteId: "usdc",
      wrappedNativeId: "wavax",
    };
    // pass 1: liquidity from the USDC side only → WAVAX price; later passes: pools quoted in newly priced tokens
    const known = new Map<string, number>([["usdc", 1]]);
    const snapshots = async (): Promise<PoolSnapshot[]> => {
      const out: PoolSnapshot[] = [];
      for (const r of refs) {
        const liq = await avalanche.liquidityUsd(r.ref, known.get(r.ids[0]) ?? null, known.get(r.ids[1]) ?? null);
        out.push({ address: r.ref.address, token0: r.ids[0], token1: r.ids[1], swaps: r.swaps, liquidityUsd: liq });
      }
      return out;
    };
    const ids = tokens.map((a) => a.id);
    // each pass learns more USD prices, so pools quoted in them get their depth too (WAVAX, then e.g. USDt, BTC.b)
    let final = tokenPrices(ids, await snapshots(), engineCfg);
    for (let pass = 0; pass < 2; pass++) {
      const before = known.size;
      for (const [id, p] of final) known.set(id, p.usd);
      if (known.size === before) break;
      final = tokenPrices(ids, await snapshots(), engineCfg);
    }
    for (const [id, p] of final) canonical.set(id, p);

    const feeds = profile.data.avalanche.chainlink ?? {};
    for (const a of tokens) {
      if (!a.price.crossCheck?.startsWith("chainlink:")) continue;
      const feed = feeds[a.price.crossCheck.slice("chainlink:".length)];
      if (!feed?.confirmed) continue;
      const r = await this.guard(`feed ${feed.address}`, () => readFeed(avalanche.client, feed.address, feed.decimals));
      if (r) cross.set(a.id, { ...r, source: `chainlink:${feed.address}` });
    }
    return { canonical, cross };
  }

  private async stockSide(now: number): Promise<{ canonical: Map<string, EnginePrice>; cross: Map<string, EnginePrice> }> {
    const { assets, profile, services, robinhood, stockApi } = this.d;
    const canonical = new Map<string, EnginePrice>();
    const cross = new Map<string, EnginePrice>();
    const quote = profile.data.robinhood.referenceQuote;
    const windowSec = services.marketData.referenceMaxAgeSec;
    const head = robinhood ? await robinhood.client.getBlockNumber() : null;
    const stocks = assets.filter((a) => a.kind === "stock");
    // a few assets at a time: public RPCs rate-limit bursts
    for (let i = 0; i < stocks.length; i += 5) {
      await Promise.all(
        stocks.slice(i, i + 5).map(async (a) => {
          if (a.kind !== "stock") return;
          const api = stockApi ? await this.guard(`stock source ${a.symbol}`, () => stockApi.lastTrade(a.symbol)) : null;
          if (api) cross.set(a.id, api);
          let reference: { pool: string; swaps: Obs[] } | null = null;
          const disp = a.display;
          if (robinhood && head !== null && quote?.confirmed && disp.confirmed && disp.dex && disp.referencePool !== "TODO" && disp.token !== "TODO") {
            // reference pools quote the stock token against the reference quote (USDG); orientation by address order
            const [t0, t1] = poolOrder(disp.token, quote.address);
            const stockIs0 = t0.toLowerCase() === disp.token.toLowerCase();
            const ref: PoolRef = { address: disp.referencePool, dex: disp.dex, token0: t0, token1: t1, dec0: stockIs0 ? a.decimals : quote.decimals, dec1: stockIs0 ? quote.decimals : a.decimals };
            const raw = (await this.guard(`pool ${disp.referencePool}`, () => robinhood.swaps(ref, windowSec, head))) ?? [];
            const swaps = stockIs0 ? raw : raw.filter((o) => o.price > 0).map((o) => ({ ts: o.ts, price: 1 / o.price }));
            reference = { pool: disp.referencePool, swaps };
          }
          const p = stockPrice(reference, api, now, { twapSec: services.marketData.stockTwapSec, referenceMaxAgeSec: services.marketData.referenceMaxAgeSec });
          if (p) canonical.set(a.id, p);
        }),
      );
    }
    return { canonical, cross };
  }

  async refresh(): Promise<InternalPrices> {
    const now = this.now();
    try {
      let canonical: Map<string, EnginePrice>;
      let cross = new Map<string, EnginePrice>();
      if (this.d.mode === "seed") {
        canonical = seedPrices(this.d.assets, now);
      } else {
        const empty = { canonical: new Map<string, EnginePrice>(), cross: new Map<string, EnginePrice>() };
        const [t, s] = await Promise.all([
          this.guard("avalanche side", () => this.tokenSide()).then((v) => v ?? empty),
          this.guard("robinhood side", () => this.stockSide(now)).then((v) => v ?? empty),
        ]);
        canonical = new Map([...t.canonical, ...s.canonical]);
        cross = new Map([...t.cross, ...s.cross]);
      }
      const prices = assembleCanonical(this.d.assets, canonical, cross);
      for (const p of prices) {
        if (p.crossCheck) {
          const dev = (Math.abs(Number(p.canonical.usd) - Number(p.crossCheck.usd)) / Number(p.crossCheck.usd)) * 10_000;
          this.m.deviation.set({ asset: p.id }, dev);
        }
      }
      this.latest = { asOf: now * 1000, prices };
      if (this.d.sink) await this.d.sink.publish(prices);
      this.m.priced.set(prices.length);
      this.m.refresh.inc({ result: "ok" });
      this.lastOkAt = Date.now();
      return this.latest;
    } catch (e) {
      this.m.refresh.inc({ result: "error" });
      throw e;
    }
  }
}
