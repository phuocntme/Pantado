import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { collectDefaultMetrics, Histogram, Registry } from "prom-client";
import { erc20Abi, getAddress, isAddress, type Address } from "viem";
import { z } from "zod";
import { assetColor, buySpends, displaySymbol, previewBuy, previewSell, quoteSwap, sellAmounts, type Asset } from "@pantado/shared";
import { feeSplitterAbi, indexFactoryAbi, indexVaultAbi, swapRouterAbi } from "@pantado/sdk";
import { loadBasket, loadLeg, quoteDexLegs } from "./chain-state.js";
import { displayPrices, type ApiDeps, type HistInterval } from "./deps.js";
import { ApiError, fromQuoteError } from "./errors.js";
import { fifo } from "./pnl.js";
import { equalWeights, lowVolWeights, marketCapWeights, PresetError } from "./presets.js";

const bigReplacer = (_k: string, v: unknown): unknown => (typeof v === "bigint" ? v.toString() : v);
const INTERVAL_SEC: Record<string, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14_400, "1d": 86_400, "1w": 604_800 };
const HIST_INTERVALS = ["15m", "1h", "4h", "1d", "1w"] as const;
const isHistInterval = (i: string): i is HistInterval => (HIST_INTERVALS as readonly string[]).includes(i);
const REFERENCE_BADGE = "Reference market: Robinhood Chain (on-chain)";
const FUJI_BADGE = "Traded on Fuji testnet";

interface IndexRow {
  id: Address;
  ticker: string;
  name: string;
  description: string;
  creator: Address;
  isPublic: boolean;
  mode: number;
  driftBps: number;
  pendingMode: number | null;
  pendingAt: string | null;
  assets: Address[];
  targetBps: number[];
  version: number;
  supply: string;
  level: string;
  value: string;
  levelBlock: string;
  volumeUsdc: string;
  createdAt: string;
}
const INDEX_FIELDS =
  "id ticker name description creator isPublic mode driftBps pendingMode pendingAt assets targetBps version supply level value levelBlock volumeUsdc createdAt";

export function buildServer(d: ApiDeps, registry: Registry = new Registry()): FastifyInstance {
  const app = Fastify({ logger: false });
  collectDefaultMetrics({ register: registry });
  const duration = new Histogram({
    name: "api_request_duration_seconds",
    help: "API request duration",
    labelNames: ["route", "status"],
    buckets: [0.01, 0.025, 0.05, 0.1, 0.15, 0.25, 0.5, 1, 2.5],
    registers: [registry],
  });
  app.addHook("onResponse", async (req, reply) => {
    duration.observe({ route: req.routeOptions.url ?? "unknown", status: String(reply.statusCode) }, reply.elapsedTime / 1000);
  });
  app.get("/metrics", async (_req, reply) => {
    void reply.header("content-type", registry.contentType);
    return registry.metrics();
  });
  void app.register(cors, { origin: true });
  app.setReplySerializer((payload) => JSON.stringify(payload, bigReplacer));
  app.setErrorHandler((err, _req, reply) => {
    const e = err instanceof ApiError ? err : err instanceof z.ZodError ? new ApiError(400, "BadRequest", err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")) : fromQuoteError(err);
    void reply.status(e.status).send({ error: { code: e.code, message: e.message } });
  });

  const byId = new Map(d.assets.map((a) => [a.id, a]));
  const execAddr = (id: string): Address | null => (d.deployment.assets[id] as Address | undefined) ?? null;
  const idByExec = new Map(Object.entries(d.deployment.assets).map(([id, a]) => [a.toLowerCase(), id]));
  const showFuji = d.profile.flags.showFujiBadge;

  const displayAddress = (a: Asset): Address | null => {
    if (a.kind === "stock") return a.display.confirmed && a.display.token !== "TODO" ? a.display.token : null;
    return a.display.confirmed && a.display.address !== "TODO" ? a.display.address : null;
  };

  async function assetView(a: Asset) {
    const px = (await displayPrices(d)).get(a.id) ?? null;
    return {
      id: a.id,
      symbol: a.symbol,
      displaySymbol: displaySymbol(a.symbol),
      name: a.name,
      kind: a.kind,
      tier: a.kind === "stock" ? a.tier : null,
      decimals: a.kind === "stock" ? 18 : a.decimals,
      color: assetColor(a.id),
      logoURI: a.logoURI,
      badge: a.kind === "stock" ? REFERENCE_BADGE : null,
      dataSource: a.kind === "stock" ? REFERENCE_BADGE : "Avalanche (on-chain)",
      display: { chain: a.display.chain, address: displayAddress(a) },
      execution: { network: d.profile.execution.network, address: execAddr(a.id), symbol: a.kind === "stock" ? `p${a.symbol}` : a.symbol },
      price: px,
      risk: a.kind === "stock" ? { sizeCapUsd: a.risk.sizeCapUsd, oiCapUsd: a.risk.oiCapUsd, spreadBps: a.risk.spreadBps } : a.kind === "token" ? { spreadBps: a.risk.spreadBps } : null,
    };
  }

  const resolveAsset = (key: string): Asset => {
    const k = key.toLowerCase();
    const direct = byId.get(k);
    if (direct) return direct;
    if (isAddress(key)) {
      const id = idByExec.get(k) ?? d.assets.find((a) => displayAddress(a)?.toLowerCase() === k)?.id;
      const a = id ? byId.get(id) : undefined;
      if (a) return a;
      throw new ApiError(404, "NotListed", "No listed asset at this contract address");
    }
    throw new ApiError(404, "NotFound", `Unknown asset ${key}`);
  };

  const indexBadge = (): string | null => (showFuji ? FUJI_BADGE : null);

  async function indexRow(id: string): Promise<IndexRow> {
    if (!isAddress(id)) throw new ApiError(400, "BadRequest", "index must be an address");
    const r = await d.gql<{ indexes: IndexRow | null }>(`query($id: String!) { indexes(id: $id) { ${INDEX_FIELDS} } }`, { id: id.toLowerCase() });
    if (!r.indexes) throw new ApiError(404, "NotFound", "Unknown index");
    return r.indexes;
  }

  function indexView(r: IndexRow) {
    return { ...r, idSlug: `idx-${r.ticker.toLowerCase()}`, badge: indexBadge(), visibility: r.isPublic ? "public" : "private" };
  }

  // ================================================================ health

  app.get("/health", async () => {
    const block = await d.client.getBlockNumber();
    return { ok: true, service: "api", profile: d.profile.profile, block };
  });

  // ================================================================ auto-fund (spec §12: once per wallet on first sign-in)

  const fundHits = new Map<string, number[]>();
  app.post("/fund", async (req) => {
    const af = d.autoFund;
    if (!af) throw new ApiError(404, "NotEnabled", "Test funds are not available on this network.");
    const body = z.object({ address: z.string(), privyToken: z.string().max(4096).optional() }).parse(req.body);
    if (!isAddress(body.address)) throw new ApiError(400, "BadRequest", "address required");
    // per-IP budget: a fresh wallet per request must not drain the keeper
    const now = Date.now();
    // behind Cloudflare → Caddy: the client address is CF-Connecting-IP
    const cf = req.headers["cf-connecting-ip"];
    const ip = typeof cf === "string" && cf ? cf : req.ip;
    const recent = (fundHits.get(ip) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= d.services.api.fundPerIpPerHour) throw new ApiError(429, "RateLimited", "Too many new wallets from this network. Try again later.");
    fundHits.set(ip, [...recent, now]);
    if (fundHits.size > 50_000) fundHits.clear();
    // gas for an embedded wallet only with a sign-in token Privy signed for this app
    const embeddedUser = body.privyToken && af.verifyPrivy ? await af.verifyPrivy(body.privyToken) : null;
    const r = await fetch(new URL("/fund", af.url), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${af.secret}` },
      body: JSON.stringify({ address: getAddress(body.address), ...(embeddedUser ? { embeddedUser } : {}) }),
      signal: AbortSignal.timeout(60_000),
    }).catch(() => null);
    if (!r) throw new ApiError(502, "FundUnavailable", "Test funds are unavailable right now.");
    const out = (await r.json().catch(() => ({}))) as { status?: string; error?: string };
    if (!r.ok) throw new ApiError(r.status === 400 ? 400 : 502, "FundFailed", out.error ?? "Could not send test funds.");
    return { status: out.status ?? "funded" };
  });

  // ================================================================ assets

  app.get("/assets", async () => d.cache.wrap("assets", d.services.api.cacheSec, async () => Promise.all(d.assets.map(assetView))));

  app.get<{ Querystring: { q?: string } }>("/assets/search", async (req) => {
    const q = (req.query.q ?? "").trim();
    if (!q) return [];
    if (isAddress(q)) return [await assetView(resolveAsset(q))];
    const s = q.toLowerCase();
    const hits = d.assets.filter(
      (a) => a.id.includes(s) || a.symbol.toLowerCase().includes(s) || displaySymbol(a.symbol).toLowerCase().includes(s) || a.name.toLowerCase().includes(s),
    );
    hits.sort((x, y) => Number(y.symbol.toLowerCase() === s) - Number(x.symbol.toLowerCase() === s));
    return Promise.all(hits.slice(0, 20).map(assetView));
  });

  app.get<{ Params: { id: string } }>("/assets/:id", async (req) => {
    const a = resolveAsset(req.params.id);
    const view = await assetView(a);
    const exec = execAddr(a.id);
    let venue: Record<string, unknown> | null = null;
    if (exec && a.kind !== "quote") {
      const leg = await loadLeg(d.client, d.deployment, exec, await d.client.getBlockNumber());
      venue =
        leg.market.kind === "stock"
          ? { kind: "stock-venue", buysPaused: leg.market.buysPaused, outstanding: leg.market.outstanding, sizeCapUsd: a.kind === "stock" ? a.risk.sizeCapUsd : null, oiCapUsdWad: leg.market.oiCapUsdWad, fresh: leg.fresh }
          : leg.market.kind === "dex"
            ? { kind: "dex-venue", fresh: leg.fresh }
            : { kind: "token-venue", inventory: leg.market.inventoryOut, fresh: leg.fresh };
    }
    return { ...view, venue };
  });

  app.get<{ Params: { id: string }; Querystring: { interval?: string; limit?: string; before?: string } }>("/assets/:id/candles", async (req) => {
    const a = resolveAsset(req.params.id);
    const exec = execAddr(a.id);
    const interval = req.query.interval ?? "1h";
    const sec = INTERVAL_SEC[interval];
    if (!sec) throw new ApiError(400, "BadRequest", "interval must be 1m, 5m, 15m, 1h, 4h, 1d or 1w");
    const limit = Math.min(Math.max(Number(req.query.limit ?? 500) || 500, 1), 5000);
    const before = req.query.before === undefined ? undefined : Number(req.query.before);
    if (before !== undefined && !(Number.isInteger(before) && before > 0)) throw new ApiError(400, "BadRequest", "before must be unix seconds");
    // 15m and up: the reference market (every mainnet swap since history.since, read by market-data)
    if (d.history && isHistInterval(interval)) {
      const ref = await d.cache.wrap(`hist:${a.id}:${interval}:${limit}:${before ?? ""}`, 30, () => d.history?.candles(a.id, interval, limit, before) ?? Promise.resolve([]));
      if (ref.length || before !== undefined) return { source: a.kind === "stock" ? REFERENCE_BADGE : "Avalanche (on-chain)", candles: ref };
    }
    if (before !== undefined) return { source: null, candles: [] };
    if (!exec) return { source: null, candles: [] };
    const rows = await d.cache.wrap(`pu:${exec}`, d.services.api.cacheSec, async () =>
      (
        await d.gql<{ priceUpdatess: { items: { price: string; ts: string }[] } }>(
          `query($a: String!) { priceUpdatess(where: { asset: $a }, orderBy: "ts", orderDirection: "desc", limit: 1000) { items { price ts } } }`,
          { a: exec.toLowerCase() },
        )
      ).priceUpdatess.items,
    );
    const buckets = new Map<number, { t: number; o: number; h: number; l: number; c: number }>();
    for (const r of [...rows].reverse()) {
      const t = sec === 604_800 ? Math.floor((Number(r.ts) - 345_600) / sec) * sec + 345_600 : Math.floor(Number(r.ts) / sec) * sec; // weeks start Monday
      const p = Number(r.price) / 1e18;
      const b = buckets.get(t);
      if (!b) buckets.set(t, { t, o: p, h: p, l: p, c: p });
      else {
        b.h = Math.max(b.h, p);
        b.l = Math.min(b.l, p);
        b.c = p;
      }
    }
    // fallback (no history yet, or 1m / 5m): canonical prices as pushed on the execution chain
    return { source: "canonical (pushed)", candles: [...buckets.values()].slice(-limit) };
  });

  app.get<{ Params: { id: string } }>("/assets/:id/pools", async (req) => {
    const a = resolveAsset(req.params.id);
    const pools: Record<string, unknown>[] = [];
    if (a.kind === "stock") {
      pools.push({ kind: "route", name: "Pantado stock venue", venue: "stock-venue", spreadBps: a.risk.spreadBps, sizeCapUsd: a.risk.sizeCapUsd, network: d.profile.execution.network });
      if (a.display.confirmed && a.display.referencePool !== "TODO")
        pools.push({ kind: "reference", chain: "robinhood", address: a.display.referencePool, dex: a.display.dex ?? null, badge: REFERENCE_BADGE });
    } else if (a.kind === "token") {
      pools.push({ kind: "route", name: "Pantado token venue", venue: a.venue[d.profile.profile], spreadBps: a.risk.spreadBps, network: d.profile.execution.network });
      for (const p of d.profile.data.avalanche.pools ?? [])
        if (p.confirmed && (p.token0 === a.id || p.token1 === a.id)) pools.push({ kind: "reference", chain: "avalanche", address: p.address, dex: p.dex });
    }
    return pools;
  });

  app.get<{ Params: { id: string } }>("/assets/:id/trades", async (req) => {
    const exec = execAddr(resolveAsset(req.params.id).id);
    if (!exec) return [];
    const r = await d.gql<{ swapss: { items: unknown[] } }>(
      `query($a: String!) { swapss(where: { asset: $a }, orderBy: "ts", orderDirection: "desc", limit: 100) { items { id source side amount usdc account ts txHash } } }`,
      { a: exec.toLowerCase() },
    );
    return r.swapss.items;
  });

  app.get<{ Querystring: { kind?: string } }>("/board", async (req) => {
    const kind = req.query.kind;
    return d.cache.wrap(`board:${kind ?? "all"}`, d.services.api.cacheSec, async () => {
      const prices = await displayPrices(d);
      const now = Math.floor(Date.now() / 1000);
      const hist = d.history ? await d.history.changes() : new Map<string, { d1: number | null; d7: number | null; d30: number | null }>();
      // stocks and tokens: the reference market's 24h volume; null while market-data has no full window
      const mvol = (await d.history?.volume?.()) ?? null;
      const rows = await Promise.all(
        d.assets
          .filter((a) => a.kind !== "quote" && (!kind || kind === "all" || `${a.kind}s` === kind || a.kind === kind))
          .map(async (a) => {
            const exec = execAddr(a.id);
            const px = prices.get(a.id);
            const change = async (ago: number): Promise<number | null> => {
              if (!exec || !px) return null;
              const r = await d.gql<{ priceUpdatess: { items: { price: string }[] } }>(
                `query($a: String!, $t: BigInt!) { priceUpdatess(where: { asset: $a, ts_lte: $t }, orderBy: "ts", orderDirection: "desc", limit: 1) { items { price } } }`,
                { a: exec.toLowerCase(), t: String(now - ago) },
              );
              const old = r.priceUpdatess.items[0];
              return old ? px.usd / (Number(old.price) / 1e18) - 1 : null;
            };
            // reference-market history first; pushed execution-chain prices only fill what it lacks
            const h = hist.get(a.id);
            const [c24, c7, c30] = await Promise.all([
              h?.d1 ?? change(86400),
              h?.d7 ?? change(7 * 86400),
              h?.d30 ?? change(30 * 86400),
            ]);
            return {
              id: a.id,
              symbol: displaySymbol(a.symbol),
              name: a.name,
              kind: a.kind,
              color: assetColor(a.id),
              price: px ?? null,
              change24h: c24,
              change7d: c7,
              change30d: c30,
              volume24hUsd: mvol ? (mvol.byAsset.get(a.id) ?? 0) : null,
              volumeSource: a.kind === "stock" ? REFERENCE_BADGE : "Avalanche (on-chain)",
              dataSource: a.kind === "stock" ? REFERENCE_BADGE : "Avalanche (on-chain)",
            };
          }),
      );
      if (kind && kind !== "all" && kind !== "indexes" && kind !== "index") return rows;
      const ix = await d.gql<{ indexess: { items: IndexRow[] } }>(
        `{ indexess(where: { isPublic: true }, limit: 500) { items { ${INDEX_FIELDS} } } }`,
      );
      const indexRows = await Promise.all(
        ix.indexess.items.map(async (r) => {
          const level = Number(r.level) / 1e18;
          const at = async (ago: number): Promise<number | null> => {
            const q = await d.gql<{ indexLevelss: { items: { level: string }[] } }>(
              `query($i: String!, $t: BigInt!) { indexLevelss(where: { index: $i, ts_lte: $t }, orderBy: "ts", orderDirection: "desc", limit: 1) { items { level } } }`,
              { i: r.id, t: String(now - ago) },
            );
            const old = q.indexLevelss.items[0];
            return old && Number(old.level) > 0 ? level / (Number(old.level) / 1e18) - 1 : null;
          };
          const ev = await d.gql<{ indexEventss: { items: { usdc: string | null; data: { gross?: string } | null; kind: string }[] } }>(
            `query($i: String!, $t: BigInt!) { indexEventss(where: { index: $i, ts_gte: $t }, limit: 1000) { items { kind usdc data } } }`,
            { i: r.id, t: String(now - 86400) },
          );
          const vol24 = ev.indexEventss.items.reduce(
            (s, e) => s + (e.kind === "buy" ? Number(e.usdc ?? 0) : e.kind === "sell" ? Number(e.data?.gross ?? 0) : 0) / 1e6,
            0,
          );
          const stockBps = r.assets.reduce((s, a, i) => {
            const id = idByExec.get(a.toLowerCase());
            return s + (id && byId.get(id)?.kind === "stock" ? (r.targetBps[i] ?? 0) : 0);
          }, 0);
          const [c24, c7, c30] = await Promise.all([at(86400), at(7 * 86400), at(30 * 86400)]);
          return {
            id: r.id,
            kind: "index",
            symbol: r.ticker,
            name: r.name,
            creator: r.creator,
            stocksPct: Math.round(stockBps / 100),
            level,
            change24h: c24,
            change7d: c7,
            change30d: c30,
            volume24hUsd: vol24,
            // indexes exist only on Pantado: their volume is the app's own buys and sells
            volumeSource: indexBadge(),
            dataSource: indexBadge(),
          };
        }),
      );
      return [...rows, ...indexRows];
    });
  });

  /** 24h volume: the reference markets (each swap once) and Pantado's index buys/sells; null where not known yet. */
  app.get("/volume", async () =>
    d.cache.wrap("volume", d.services.api.cacheSec, async () => {
      const now = Math.floor(Date.now() / 1000);
      const mvol = (await d.history?.volume?.()) ?? null;
      const ev = await d.gql<{ indexEventss: { items: { usdc: string | null; data: { gross?: string } | null; kind: string }[] } }>(
        `query($t: BigInt!) { indexEventss(where: { ts_gte: $t }, limit: 1000) { items { kind usdc data } } }`,
        { t: String(now - 86400) },
      );
      const indexes = ev.indexEventss.items.reduce((s, e) => s + (e.kind === "buy" ? Number(e.usdc ?? 0) : e.kind === "sell" ? Number(e.data?.gross ?? 0) : 0) / 1e6, 0);
      return { asOf: now, marketUsd: mvol ? mvol.total : null, indexesUsd: indexes, indexesSource: indexBadge() };
    }),
  );

  // ================================================================ indexes

  app.get("/indexes", async () =>
    d.cache.wrap("indexes", d.services.api.cacheSec, async () => {
      const r = await d.gql<{ indexess: { items: IndexRow[] } }>(
        `{ indexess(where: { isPublic: true }, orderBy: "createdAt", orderDirection: "desc", limit: 500) { items { ${INDEX_FIELDS} } } }`,
      );
      return r.indexess.items.map(indexView);
    }),
  );

  app.get<{ Params: { id: string } }>("/indexes/:id", async (req) => {
    const r = await indexRow(req.params.id);
    const c = d.deployment.contracts;
    const [ps, params, protocolBps, creatorBps, tradeFeeBps, holders] = await Promise.all([
      d.reader.planState(r.id),
      d.cache.wrap("rb-params", 60, () => d.reader.rebalancerParams()),
      d.client.readContract({ address: c.feeSplitter, abi: feeSplitterAbi, functionName: "protocolBps" }),
      d.client.readContract({ address: c.feeSplitter, abi: feeSplitterAbi, functionName: "creatorBps" }),
      d.client.readContract({ address: r.id, abi: indexVaultAbi, functionName: "tradeFeeBps" }),
      d.gql<{ indexHolderss: { totalCount: number } }>(`query($i: String!) { indexHolderss(where: { index: $i, units_gt: "0" }) { totalCount } }`, { i: r.id }),
    ]);
    return {
      ...indexView(r),
      holderCount: holders.indexHolderss.totalCount,
      fees: { tradeFeeBps, protocolBps, creatorBps: r.isPublic ? creatorBps : 0 },
      guards: {
        noticeSec: params.noticeSec,
        modeChangeDelaySec: params.modeChangeDelaySec,
        dailyCapBps: params.dailyCapBps,
        lossBudgetBps: params.lossBudgetBps,
        maxDurationSec: params.maxDurationSec,
        auctionSec: params.auctionSec,
        premiumBps: params.premiumBps,
        floorBps: params.floorBps,
        lotCapBps: params.lotCapBps,
      },
      plan: {
        mode: ps.mode,
        driftBps: ps.driftBps,
        version: ps.version,
        planVersion: ps.plan.version,
        planTargetBps: ps.plan.weights,
        status: ps.plan.status,
        startAt: ps.plan.startAt,
        startedAt: ps.plan.startedAt,
        valueAtStart: ps.plan.valueAtStart,
        lossBudget: ps.plan.lossBudget,
        loss: ps.plan.loss,
        tradedLast24h: ps.tradedLast24h,
        auctionLive: ps.auctionLive,
        auctionPrice: ps.auctionPrice,
        pendingMode: ps.modeChangePending ? ps.pendingMode : null,
        pendingAt: ps.modeChangePending ? ps.pendingAt : null,
      },
    };
  });

  app.get<{ Params: { id: string } }>("/indexes/:id/composition", async (req) => {
    const r = await indexRow(req.params.id);
    const k = await d.reader.basket(r.id);
    return {
      level: k.level,
      value: k.value,
      supply: k.supply,
      maxDriftBps: k.maxDriftBps,
      allFresh: k.allFresh,
      legs: k.assets.map((a, i) => {
        const id = idByExec.get(a.toLowerCase()) ?? null;
        const meta = id ? byId.get(id) : undefined;
        return {
          asset: a,
          id,
          symbol: meta ? displaySymbol(meta.symbol) : null,
          kind: meta?.kind ?? null,
          balance: k.balances[i],
          priceWad: k.prices[i],
          fresh: k.fresh[i],
          valueUsdWad: k.values[i],
          currentBps: k.currentBps[i],
          targetBps: k.targetBps[i],
          driftBps: k.driftBps[i],
        };
      }),
    };
  });

  app.get<{ Params: { id: string } }>("/indexes/:id/transactions", async (req) => {
    const r = await indexRow(req.params.id);
    return (
      await d.gql<{ indexEventss: { items: unknown[] } }>(
        `query($i: String!) { indexEventss(where: { index: $i }, orderBy: "ts", orderDirection: "desc", limit: 200) { items { id kind account usdc units data ts txHash } } }`,
        { i: r.id },
      )
    ).indexEventss.items;
  });

  app.get<{ Params: { id: string } }>("/indexes/:id/rebalances", async (req) => {
    const r = await indexRow(req.params.id);
    const q = await d.gql<{ planss: { items: unknown[] }; fillss: { items: unknown[] }; versionss: { items: unknown[] }; auctionss: { items: unknown[] } }>(
      `query($i: String!) {
        planss(where: { index: $i }, orderBy: "planId", orderDirection: "desc", limit: 50) { items { planId status manual startAt startedAt endedAt maxDriftBps value lossBudget loss traded } }
        auctionss(where: { index: $i }, orderBy: "ts", orderDirection: "desc", limit: 200) { items { planId auctionId sellAsset buyAsset lot filled startPrice floorPrice endAt ts } }
        fillss(where: { index: $i }, orderBy: "ts", orderDirection: "desc", limit: 200) { items { planId auctionId filler amountOut amountIn price lossDelta ts txHash } }
        versionss(where: { index: $i }, orderBy: "version", orderDirection: "desc", limit: 50) { items { version targetBps reason startAt ts } }
      }`,
      { i: r.id },
    );
    return { plans: q.planss.items, auctions: q.auctionss.items, fills: q.fillss.items, versions: q.versionss.items };
  });

  app.get<{ Params: { id: string } }>("/indexes/:id/holders", async (req) => {
    const r = await indexRow(req.params.id);
    const q = await d.gql<{ indexHolderss: { items: { holder: string; units: string }[] } }>(
      `query($i: String!) { indexHolderss(where: { index: $i, units_gt: "0" }, orderBy: "units", orderDirection: "desc", limit: 200) { items { holder units } } }`,
      { i: r.id },
    );
    const supply = BigInt(r.supply);
    return q.indexHolderss.items.map((h) => ({ ...h, shareBps: supply > 0n ? Number((BigInt(h.units) * 10_000n) / supply) : 0 }));
  });

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>("/indexes/:id/levels", async (req) => {
    const r = await indexRow(req.params.id);
    const q = await d.gql<{ indexLevelss: { items: { block: string; ts: string; level: string }[] } }>(
      `query($i: String!, $n: Int!) { indexLevelss(where: { index: $i }, orderBy: "block", orderDirection: "desc", limit: $n) { items { block ts level } } }`,
      { i: r.id, n: Math.min(1000, Number(req.query.limit ?? 500)) },
    );
    return { badge: indexBadge(), levels: q.indexLevelss.items.reverse() };
  });

  // ================================================================ creators + portfolio

  app.get<{ Params: { handle: string } }>("/creators/:handle", async (req) => {
    // handles are wallet addresses until profiles exist
    const h = req.params.handle;
    if (!isAddress(h)) throw new ApiError(404, "NotFound", "Unknown creator");
    const q = await d.gql<{ indexess: { items: IndexRow[] } }>(
      `query($c: String!) { indexess(where: { creator: $c, isPublic: true }, limit: 200) { items { ${INDEX_FIELDS} } } }`,
      { c: h.toLowerCase() },
    );
    return { handle: getAddress(h), wallet: getAddress(h), x: null, indexes: q.indexess.items.map(indexView) };
  });

  app.get<{ Params: { address: string } }>("/portfolio/:address", async (req) => {
    if (!isAddress(req.params.address)) throw new ApiError(400, "BadRequest", "address required");
    const w = req.params.address.toLowerCase();
    const q = await d.gql<{
      indexHolderss: { items: { index: Address; units: string }[] };
      walletLotss: { items: { index: string; units: string; costUsdc: string; ts: string }[] };
      indexEventss: { items: { index: string; kind: string; units: string | null; ts: string }[] };
      indexess: { items: IndexRow[] };
      balancess: { items: { token: string; amount: string }[] };
    }>(
      `query($w: String!) {
        indexHolderss(where: { holder: $w, units_gt: "0" }, limit: 200) { items { index units } }
        walletLotss(where: { wallet: $w }, limit: 1000) { items { index units costUsdc ts } }
        indexEventss(where: { account: $w }, limit: 1000) { items { index kind units ts } }
        indexess(where: { creator: $w }, limit: 200) { items { ${INDEX_FIELDS} } }
        balancess(where: { holder: $w, amount_gt: "0" }, limit: 200) { items { token amount } }
      }`,
      { w },
    );
    const positions = await Promise.all(
      q.indexHolderss.items.map(async (h) => {
        const r = await indexRow(h.index);
        const units = BigInt(h.units);
        const level = await d.reader.level(h.index);
        const value = (units * level) / 10n ** 18n; // USD 1e18
        const p = fifo(
          q.walletLotss.items.filter((l) => l.index === h.index).map((l) => ({ units: BigInt(l.units), costUsdc: BigInt(l.costUsdc), ts: Number(l.ts) })),
          q.indexEventss.items.filter((e) => e.index === h.index && (e.kind === "sell" || e.kind === "redeem")).map((e) => ({ units: BigInt(e.units ?? "0"), ts: Number(e.ts) })),
          units,
        );
        const costWad = p.costUsdc * 10n ** 12n;
        return {
          index: indexView(r),
          units,
          valueUsdWad: value,
          costUsdc: p.costUsdc,
          pnlUsdWad: p.unknownBasisUnits > 0n ? null : value - costWad,
          unknownCostBasis: p.unknownBasisUnits > 0n,
          maxDriftBps: (await d.reader.basket(h.index)).maxDriftBps,
        };
      }),
    );
    const prices = await displayPrices(d);
    const wallet = q.balancess.items
      .map((b) => {
        const id = idByExec.get(b.token) ?? null;
        const a = id ? byId.get(id) : undefined;
        if (!a || !id) return null;
        const dec = a.kind === "stock" ? 18 : a.decimals;
        const usd = (Number(b.amount) / 10 ** dec) * (prices.get(id)?.usd ?? (a.kind === "quote" ? 1 : 0));
        return { id, symbol: displaySymbol(a.symbol), color: assetColor(id), amount: b.amount, decimals: dec, valueUsd: usd };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    const walletTotal = wallet.reduce((s, x) => s + x.valueUsd, 0);
    const earnings = await d.client.readContract({ address: d.deployment.contracts.feeSplitter, abi: feeSplitterAbi, functionName: "earnings", args: [getAddress(w)] });
    return {
      address: getAddress(w),
      positions,
      yourIndexes: q.indexess.items.map(indexView), // public and private: only listed here for the creator
      wallet: wallet.map((x) => ({ ...x, shareBps: walletTotal > 0 ? Math.round((x.valueUsd / walletTotal) * 10_000) : 0 })),
      walletTotalUsd: walletTotal,
      creatorEarnings: { claimableUsdc: earnings },
    };
  });

  // ================================================================ presets

  app.get<{ Querystring: { assets?: string; preset?: string } }>("/presets", async (req) => {
    const ids = (req.query.assets ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    const assets = ids.map((id) => resolveAsset(id));
    if (assets.length < 2 || assets.length > 20) throw new ApiError(400, "BadAssetCount", "An index holds 2 to 20 assets.");
    const preset = req.query.preset ?? "equal";
    try {
      if (preset === "equal") return { preset, weights: equalWeights(assets.length) };
      if (preset === "marketcap") {
        const prices = await displayPrices(d);
        const caps = assets.map((a) => (a.kind === "token" && a.circulatingSupply ? Number(a.circulatingSupply) * (prices.get(a.id)?.usd ?? 0) : 0));
        return { preset, weights: marketCapWeights(caps, d.services.presets.marketCapCapPct) };
      }
      if (preset === "lowvol") {
        const since = Math.floor(Date.now() / 1000) - d.services.presets.lowVolLookbackDays * 86400;
        const series = await Promise.all(
          assets.map(async (a) => {
            // daily closes of the reference market; pushed prices only when market-data has none
            const ref = d.history ? await d.history.candles(a.id, "1d", d.services.presets.lowVolLookbackDays) : [];
            if (ref.length >= 2) return ref.map((k) => k.c);
            const exec = execAddr(a.id);
            if (!exec) return [];
            const r = await d.gql<{ priceUpdatess: { items: { price: string; ts: string }[] } }>(
              `query($a: String!, $t: BigInt!) { priceUpdatess(where: { asset: $a, ts_gte: $t }, orderBy: "ts", orderDirection: "desc", limit: 1000) { items { price ts } } }`,
              { a: exec.toLowerCase(), t: String(since) },
            );
            const daily = new Map<number, number>();
            for (const p of [...r.priceUpdatess.items].reverse()) daily.set(Math.floor(Number(p.ts) / 86400), Number(p.price) / 1e18);
            return [...daily.values()];
          }),
        );
        return { preset, weights: lowVolWeights(series) };
      }
    } catch (e) {
      if (e instanceof PresetError) throw new ApiError(409, "PresetUnavailable", e.message);
      throw e;
    }
    throw new ApiError(400, "BadRequest", "preset must be equal, marketcap or lowvol");
  });

  // ================================================================ quotes (spec §9.5)

  const amount = z.string().regex(/^[0-9]+$/).transform((s) => BigInt(s));
  const addr = z.string().refine((s) => isAddress(s), "address").transform((s) => getAddress(s));
  const slip = z.number().int().min(0).max(1000).default(50);
  const minAfter = (x: bigint, bps: number): bigint => (x * BigInt(10_000 - bps)) / 10_000n;

  app.post("/quote/basket", async (req) => {
    const b = z.object({ index: addr, side: z.enum(["buy", "sell"]), amount, slippageBps: slip }).parse(req.body);
    const s = await loadBasket(d.client, d.deployment, { index: b.index });
    try {
      if (b.side === "buy") {
        await quoteDexLegs(d.client, d.deployment, s, buySpends(s.state, b.amount), "buy");
        const q = previewBuy(s.state, b.amount);
        return {
          blockNumber: s.blockNumber,
          side: "buy",
          usdcIn: b.amount,
          fee: q.fee,
          units: q.units,
          minUnits: minAfter(q.units, b.slippageBps),
          legs: s.legs.map((l, i) => ({ asset: l.asset, venue: l.kind === "stock" ? "stock-venue" : l.market.kind === "dex" ? "dex-venue" : "token-venue", spendUsdc: q.spends[i], expectedOut: q.outs[i], priceWad: l.priceWad })),
          maxAgeBlocks: d.services.api.quoteMaxAgeBlocks,
        };
      }
      if (s.state.supply > 0n) await quoteDexLegs(d.client, d.deployment, s, sellAmounts(s.state, b.amount), "sell");
      const q = previewSell(s.state, b.amount);
      return { blockNumber: s.blockNumber, side: "sell", units: b.amount, fee: q.fee, gross: q.gross, usdcOut: q.usdcOut, minOut: minAfter(q.usdcOut, b.slippageBps), maxAgeBlocks: d.services.api.quoteMaxAgeBlocks };
    } catch (e) {
      throw fromQuoteError(e);
    }
  });

  app.post("/quote/create", async (req) => {
    const b = z
      .object({ assets: z.array(addr).min(2).max(20), weightsBps: z.array(z.number().int().min(100)), usdcIn: amount, slippageBps: slip })
      .parse(req.body);
    if (b.weightsBps.length !== b.assets.length || b.weightsBps.reduce((x, y) => x + y, 0) !== 10_000)
      throw new ApiError(400, "BadWeights", "Weights must be whole percents, each at least 1 %, summing to 100 %.");
    const s = await loadBasket(d.client, d.deployment, { create: { assets: b.assets, weightsBps: b.weightsBps } });
    try {
      await quoteDexLegs(d.client, d.deployment, s, buySpends(s.state, b.usdcIn), "buy");
      const q = previewBuy(s.state, b.usdcIn);
      const [creationFee, minFirstBuy] = await d.client.readContract({ address: d.deployment.contracts.factory, abi: indexFactoryAbi, functionName: "limits" });
      if (b.usdcIn < minFirstBuy) throw new ApiError(422, "FirstBuyTooSmall", "The first buy must be at least 100 USDC.");
      return {
        blockNumber: s.blockNumber,
        usdcIn: b.usdcIn,
        creationFee,
        tradeFee: q.fee,
        totalUsdc: b.usdcIn + creationFee,
        units: q.units,
        minUnits: minAfter(q.units, b.slippageBps),
        levelUsd: "100",
        note: "Nothing is created if any purchase fails or a price is stale.",
      };
    } catch (e) {
      throw fromQuoteError(e);
    }
  });

  app.post("/quote/swap", async (req) => {
    const b = z.object({ tokenIn: addr, tokenOut: addr, amountIn: amount, slippageBps: slip }).parse(req.body);
    const c = d.deployment.contracts;
    const block = await d.client.getBlockNumber();
    const leg = async (t: Address) => (t.toLowerCase() === c.usdc.toLowerCase() ? null : loadLeg(d.client, d.deployment, t, block));
    // every read of this block at once (the transport batches them); the router fee rarely changes: cached
    const [li, lo, usdcVenue, feeBps] = await Promise.all([
      leg(b.tokenIn),
      leg(b.tokenOut),
      c.tokenVenue
        ? d.client.readContract({ address: c.usdc, abi: erc20Abi, functionName: "balanceOf", args: [c.tokenVenue], blockNumber: block })
        : Promise.resolve(0n),
      d.cache.wrap("swap-fee-bps", 60, () => d.client.readContract({ address: c.swapRouter, abi: swapRouterAbi, functionName: "swapFeeBps" })),
    ]);
    for (const l of [li, lo]) if (l && !l.fresh) throw new ApiError(422, "PriceStale", "A price is stale. Swaps are paused for this asset.");
    try {
      // a leg through real pools: the router's own on-chain quote (exact for this block, every venue included)
      if (li?.market.kind === "dex" || lo?.market.kind === "dex") {
        const [amountOut, fee] = await d.client
          .readContract({ address: c.swapRouter, abi: swapRouterAbi, functionName: "quote", args: [b.tokenIn, b.tokenOut, b.amountIn], blockNumber: block })
          .catch((e: unknown) => {
            throw new ApiError(422, "QuoteFailed", `The pools cannot fill this swap: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
          });
        return { blockNumber: block, amountIn: b.amountIn, amountOut, fee, minOut: minAfter(amountOut, b.slippageBps) };
      }
      const q = quoteSwap(li?.market ?? null, lo?.market ?? null, b.amountIn, feeBps, 6, usdcVenue);
      return { blockNumber: block, amountIn: b.amountIn, amountOut: q.amountOut, fee: q.fee, minOut: minAfter(q.amountOut, b.slippageBps) };
    } catch (e) {
      throw fromQuoteError(e);
    }
  });

  return app;
}
