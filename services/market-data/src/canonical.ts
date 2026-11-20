import { decimalString, type Asset, type CanonicalPrice } from "@pantado/shared";
import type { EnginePrice } from "./engine/tokens.js";

// 12 significant digits, no exponent, no trailing zeros (micro-priced tokens keep their precision)
const fmt = (v: number): string => decimalString(v, 12);

/**
 * One canonical price per asset (spec §8). Assets with no canonical source are omitted, so the pusher
 * skips them and the on-chain price ages and goes stale by design.
 */
export function assembleCanonical(
  assets: Asset[],
  canonical: Map<string, EnginePrice>,
  crossCheck: Map<string, EnginePrice>,
): CanonicalPrice[] {
  const out: CanonicalPrice[] = [];
  for (const a of assets) {
    if (a.kind === "quote") continue;
    const c = canonical.get(a.id);
    if (!c || !(c.usd > 0)) continue;
    const x = crossCheck.get(a.id);
    out.push({
      id: a.id,
      canonical: { usd: fmt(c.usd), ts: c.ts, source: c.source },
      crossCheck: x && x.usd > 0 ? { usd: fmt(x.usd), ts: x.ts, source: x.source } : null,
    });
  }
  return out;
}

/** Local-only seed prices from config (`MARKET_DATA_MODE=seed`), labelled source "seed". */
export function seedPrices(assets: Asset[], now: number): Map<string, EnginePrice> {
  const m = new Map<string, EnginePrice>();
  for (const a of assets) {
    if (a.kind === "quote" || !a.price.seedUsd) continue;
    m.set(a.id, { usd: Number(a.price.seedUsd), ts: now, source: "seed" });
  }
  return m;
}
