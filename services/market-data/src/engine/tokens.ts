import { dropOutliers, type Obs } from "./stats.js";

/** A whitelisted pool and its recent swaps; `price` = token1 per token0 at each swap. */
export interface PoolSnapshot {
  address: string;
  token0: string; // asset id
  token1: string;
  liquidityUsd: number;
  swaps: Obs[];
}

export interface TokenEngineConfig {
  minLiquidityUsd: number;
  outlierSigma: number;
  outlierWindow: number;
  quoteId: string; // "usdc"
  wrappedNativeId: string; // "wavax"
}

export interface EnginePrice {
  usd: number;
  ts: number;
  source: string; // pool address
}

function lastClean(p: PoolSnapshot, cfg: TokenEngineConfig): Obs | null {
  const clean = dropOutliers(p.swaps, cfg.outlierSigma, cfg.outlierWindow);
  return clean.length ? (clean[clean.length - 1] ?? null) : null;
}

/** Price of `id` in `other` from a pool (orientation-aware), or null. */
function priceIn(p: PoolSnapshot, id: string, cfg: TokenEngineConfig): Obs | null {
  const o = lastClean(p, cfg);
  if (!o || o.price <= 0) return null;
  if (p.token0 === id) return o;
  if (p.token1 === id) return { ts: o.ts, price: 1 / o.price };
  return null;
}

/** Deepest pool of the pair that has a price (a deep pool without a recent swap must not hide a priced one). */
function deepest(pools: PoolSnapshot[], a: string, b: string, cfg: TokenEngineConfig): PoolSnapshot | null {
  return (
    pools
      .filter((p) => p.liquidityUsd >= cfg.minLiquidityUsd && lastClean(p, cfg) !== null)
      .filter((p) => (p.token0 === a && p.token1 === b) || (p.token0 === b && p.token1 === a))
      .sort((x, y) => y.liquidityUsd - x.liquidityUsd)[0] ?? null
  );
}

/**
 * Avalanche price engine (spec §9.3): USDC = 1; WAVAX from the deepest WAVAX/USDC pool; every other token
 * from its deepest pool vs USDC or WAVAX (whichever is deeper), else vs another priced token. Pools under the liquidity floor are ignored
 * and swaps beyond 3σ of the last 20 are dropped.
 */
export function tokenPrices(ids: string[], pools: PoolSnapshot[], cfg: TokenEngineConfig): Map<string, EnginePrice> {
  const out = new Map<string, EnginePrice>();
  const wPool = deepest(pools, cfg.wrappedNativeId, cfg.quoteId, cfg);
  const w = wPool ? priceIn(wPool, cfg.wrappedNativeId, cfg) : null;
  if (wPool && w) out.set(cfg.wrappedNativeId, { usd: w.price, ts: w.ts, source: wPool.address });
  for (const id of ids) {
    if (id === cfg.quoteId || id === cfg.wrappedNativeId) continue;
    const vsUsd = deepest(pools, id, cfg.quoteId, cfg);
    const vsW = w ? deepest(pools, id, cfg.wrappedNativeId, cfg) : null;
    const pick = vsUsd && (!vsW || vsUsd.liquidityUsd >= vsW.liquidityUsd) ? { pool: vsUsd, mult: 1 } : vsW && w ? { pool: vsW, mult: w.price } : null;
    if (!pick) continue;
    const o = priceIn(pick.pool, id, cfg);
    if (o) out.set(id, { usd: o.price * pick.mult, ts: o.ts, source: pick.pool.address });
  }
  // tokens that only trade against another listed token (e.g. vs USDt or BTC.b): deepest pool vs a priced one
  for (let round = 0; round < 3; round++) {
    let added = false;
    for (const id of ids) {
      if (out.has(id) || id === cfg.quoteId) continue;
      const pool = pools
        .filter((p) => p.liquidityUsd >= cfg.minLiquidityUsd && lastClean(p, cfg) !== null)
        .filter((p) => (p.token0 === id && out.has(p.token1)) || (p.token1 === id && out.has(p.token0)))
        .sort((x, y) => y.liquidityUsd - x.liquidityUsd)[0];
      const other = pool ? (pool.token0 === id ? pool.token1 : pool.token0) : null;
      const via = other ? out.get(other) : undefined;
      const o = pool ? priceIn(pool, id, cfg) : null;
      if (pool && via && o) {
        out.set(id, { usd: o.price * via.usd, ts: o.ts, source: pool.address });
        added = true;
      }
    }
    if (!added) break;
  }
  return out;
}
