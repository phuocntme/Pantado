import { createClient } from "redis";
import type { VerifyPrivy } from "./privy.js";
import type { Address, PublicClient } from "viem";
import { priceOracleAbi, type PantadoReader } from "@pantado/sdk";
import { internalPricesSchema, type Asset, type CanonicalPrice, type Deployment, type Profile, type Services } from "@pantado/shared";

export interface Cache {
  wrap<T>(key: string, ttlSec: number, fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * One computation per key at a time: callers that miss the cache while it is being filled wait for the same
 * result. Without it, a slow upstream (a rate-limited RPC) turns every poll into another full computation and
 * the backlog grows until the process runs out of memory.
 */
const inflight = new Map<string, Promise<unknown>>();
export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** In-process TTL cache (single instance / tests). */
export function memoryCache(): Cache {
  const m = new Map<string, { exp: number; v: unknown }>();
  return {
    async wrap<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> {
      const hit = m.get(key);
      if (hit && hit.exp > Date.now()) return hit.v as T;
      return singleFlight(key, async () => {
        const v = await fn();
        m.set(key, { exp: Date.now() + ttl * 1000, v });
        if (m.size > 5000) m.clear();
        return v;
      });
    },
    async close() {},
  };
}

const replacer = (_k: string, v: unknown): unknown => (typeof v === "bigint" ? { $big: v.toString() } : v);
const reviver = (_k: string, v: unknown): unknown =>
  v && typeof v === "object" && "$big" in v && typeof (v as { $big: unknown }).$big === "string" ? BigInt((v as { $big: string }).$big) : v;

/** Redis cache for hot responses (spec §9.7: 2–5 s). */
export async function redisCache(url: string): Promise<Cache> {
  const client = createClient({ url });
  await client.connect();
  return {
    async wrap<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> {
      const hit = await client.get(`api:${key}`);
      if (hit) return JSON.parse(hit, reviver) as T;
      return singleFlight(key, async () => {
        const v = await fn();
        await client.set(`api:${key}`, JSON.stringify(v, replacer), { EX: ttl });
        return v;
      });
    },
    async close() {
      await client.quit();
    },
  };
}

/** Minimal GraphQL client for the indexer's HTTP API (service boundary: HTTP only). */
export function indexerClient(baseUrl: string) {
  return async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const r = await fetch(new URL("/graphql", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(5000),
    });
    const body = (await r.json()) as { data?: T; errors?: { message: string }[] };
    if (body.errors?.length) throw new Error(`indexer: ${body.errors.map((e) => e.message).join("; ")}`);
    if (!body.data) throw new Error(`indexer: empty response (${r.status})`);
    return body.data;
  };
}
export type Gql = ReturnType<typeof indexerClient>;

export interface ApiDeps {
  profile: Profile;
  services: Services;
  assets: Asset[];
  deployment: Deployment;
  client: PublicClient;
  reader: PantadoReader;
  gql: Gql;
  cache: Cache;
  /** Canonical display prices (market-data); falls back to the on-chain oracle. */
  prices(): Promise<Map<string, CanonicalPrice>>;
  /** Reference-market price history (market-data); null or empty → candles and changes from pushed prices. */
  history?: MarketHistory | null;
  /** auto-fund keeper (test USDC + AVAX once per wallet on sign-in); null when not configured. */
  autoFund?: { url: string; secret: string; verifyPrivy?: VerifyPrivy | null } | null;
}

export interface HistCandle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}
export interface HistChanges {
  d1: number | null;
  d7: number | null;
  d30: number | null;
}
export type HistInterval = "15m" | "1h" | "4h" | "1d" | "1w";
export interface MarketHistory {
  /** The newest `limit` candles, or those ending before `before` (unix seconds) for older pages. */
  candles(id: string, interval: HistInterval, limit: number, before?: number): Promise<HistCandle[]>;
  changes(): Promise<Map<string, HistChanges>>;
  /** Reference-market 24h volume per asset and the market total (each swap once); null until market-data has a full window. */
  volume?(): Promise<MarketVolume | null>;
}

export interface MarketVolume {
  byAsset: Map<string, number>;
  total: number;
  windowSec: number;
}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const numOrNull = (v: unknown): number | null => (num(v) ? v : null);

/** Candles and board changes from every reference-market swap, as read by market-data. */
export function marketDataHistory(url: string | undefined): MarketHistory | null {
  if (!url) return null;
  return {
    async candles(id, interval, limit, before) {
      try {
        const u = new URL(`/internal/history/${encodeURIComponent(id)}`, url);
        u.searchParams.set("interval", interval);
        u.searchParams.set("limit", String(limit));
        if (before !== undefined) u.searchParams.set("before", String(before));
        const r = await fetch(u, { signal: AbortSignal.timeout(2000) });
        const body = (await r.json()) as { candles?: unknown };
        if (!Array.isArray(body.candles)) return [];
        return body.candles.flatMap((k: unknown): HistCandle[] => {
          const c = k as Record<string, unknown>;
          return num(c.t) && num(c.o) && num(c.h) && num(c.l) && num(c.c) ? [{ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c }] : [];
        });
      } catch {
        return [];
      }
    },
    async volume() {
      try {
        const r = await fetch(new URL("/internal/volume", url), { signal: AbortSignal.timeout(2000) });
        const body = (await r.json()) as { ready?: unknown; total?: unknown; windowSec?: unknown; volume?: Record<string, unknown> };
        if (body.ready !== true || !num(body.total) || !num(body.windowSec)) return null;
        const byAsset = new Map<string, number>();
        for (const [id, v] of Object.entries(body.volume ?? {})) if (num(v)) byAsset.set(id, v);
        return { byAsset, total: body.total, windowSec: body.windowSec };
      } catch {
        return null;
      }
    },
    async changes() {
      try {
        const r = await fetch(new URL("/internal/changes", url), { signal: AbortSignal.timeout(2000) });
        const body = (await r.json()) as { changes?: Record<string, unknown> };
        const out = new Map<string, HistChanges>();
        for (const [id, v] of Object.entries(body.changes ?? {})) {
          const c = (v ?? {}) as Record<string, unknown>;
          out.set(id, { d1: numOrNull(c.d1), d7: numOrNull(c.d7), d30: numOrNull(c.d30) });
        }
        return out;
      } catch {
        return new Map();
      }
    },
  };
}

export function marketDataPrices(url: string | undefined): () => Promise<Map<string, CanonicalPrice>> {
  return async () => {
    if (!url) return new Map();
    try {
      const r = await fetch(new URL("/internal/prices", url), { signal: AbortSignal.timeout(2000) });
      const body = internalPricesSchema.parse(await r.json());
      return new Map(body.prices.map((p) => [p.id, p]));
    } catch {
      return new Map();
    }
  };
}

/** Display price per asset id: canonical when available, else the on-chain pushed price. */
export async function displayPrices(d: ApiDeps): Promise<Map<string, { usd: number; ts: number; source: string; fresh: boolean }>> {
  // cached as entries: a Map does not survive the Redis cache's JSON round trip
  const entries = await d.cache.wrap("display-prices", d.services.api.cacheSec, async () => [...(await readDisplayPrices(d))]);
  return new Map(entries);
}

async function readDisplayPrices(d: ApiDeps): Promise<Map<string, { usd: number; ts: number; source: string; fresh: boolean }>> {
  {
    const canon = await d.prices();
    const out = new Map<string, { usd: number; ts: number; source: string; fresh: boolean }>();
    await Promise.all(
      d.assets.map(async (a) => {
        const exec = d.deployment.assets[a.id] as Address | undefined;
        const c = canon.get(a.id);
        let fresh = true;
        let onchain: { usd: number; ts: number } | null = null;
        if (exec) {
          const [[p, t], f] = await Promise.all([
            d.client.readContract({ address: d.deployment.contracts.oracle, abi: priceOracleAbi, functionName: "latest", args: [exec] }),
            d.client.readContract({ address: d.deployment.contracts.oracle, abi: priceOracleAbi, functionName: "isFresh", args: [exec] }),
          ]);
          fresh = f;
          onchain = { usd: Number(p) / 1e18, ts: Number(t) };
        }
        if (c) out.set(a.id, { usd: Number(c.canonical.usd), ts: c.canonical.ts, source: c.canonical.source, fresh });
        else if (onchain) out.set(a.id, { usd: onchain.usd, ts: onchain.ts, source: "oracle", fresh });
      }),
    );
    return out;
  }
}
