import { twap, type Obs } from "./stats.js";
import type { EnginePrice } from "./tokens.js";

export interface StockEngineConfig {
  twapSec: number; // 60
  referenceMaxAgeSec: number; // 900
}

/**
 * Canonical stock price (spec §8): Robinhood Chain reference pool mid, 60 s TWAP; if the pool has not
 * traded within `referenceMaxAgeSec`, the stock API last trade.
 */
export function stockPrice(
  reference: { pool: string; swaps: Obs[] } | null,
  apiLast: EnginePrice | null,
  now: number,
  cfg: StockEngineConfig,
): EnginePrice | null {
  if (reference && reference.swaps.length > 0) {
    const lastTs = Math.max(...reference.swaps.map((s) => s.ts));
    if (now - lastTs <= cfg.referenceMaxAgeSec) {
      const p = twap(reference.swaps, cfg.twapSec, now);
      if (p !== null && p > 0) return { usd: p, ts: now, source: `robinhood:${reference.pool}` };
    }
  }
  return apiLast;
}
