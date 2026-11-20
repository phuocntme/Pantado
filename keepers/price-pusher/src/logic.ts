import { deviationBps, parseUnitsExact, type CanonicalPrice } from "@pantado/shared";
import type { Address } from "viem";

export interface OnchainAsset {
  id: string;
  address: Address;
  lastPriceE18: bigint;
  lastPushedAt: number; // unix seconds
  bandMinE18: bigint;
  bandMaxE18: bigint;
  maxAgeSec: number;
}

export interface PushConfig {
  pushIntervalSec: number;
  moveBps: number;
  deviationBps: number;
}

export type SkipReason = "missing" | "deviation" | "band" | "source-stale";

export interface Decision {
  pushes: { id: string; address: Address; priceE18: bigint; reason: "interval" | "move" }[];
  skips: { id: string; reason: SkipReason; detail: string }[];
}

/** |a − b| / b in bps for 1e18 integers. */
export function moveBpsE18(a: bigint, b: bigint): number {
  if (b === 0n) return Number.POSITIVE_INFINITY;
  const d = a > b ? a - b : b - a;
  return Number((d * 1_000_000n) / b) / 100;
}

/**
 * Decide which prices to push now (spec §8). Pure: `now` is the chain timestamp.
 * A skipped asset is not pushed, so its on-chain price ages and goes stale by design.
 */
export function decide(assets: OnchainAsset[], prices: CanonicalPrice[], now: number, cfg: PushConfig): Decision {
  const byId = new Map(prices.map((p) => [p.id, p]));
  const out: Decision = { pushes: [], skips: [] };
  for (const a of assets) {
    const p = byId.get(a.id);
    if (!p) {
      out.skips.push({ id: a.id, reason: "missing", detail: "no canonical price" });
      continue;
    }
    if (p.crossCheck) {
      const dev = deviationBps(p.canonical.usd, p.crossCheck.usd);
      if (dev > cfg.deviationBps) {
        out.skips.push({
          id: a.id,
          reason: "deviation",
          detail: `canonical ${p.canonical.usd} vs ${p.crossCheck.source} ${p.crossCheck.usd}: ${dev.toFixed(1)} bps`,
        });
        continue;
      }
    }
    if (now - p.canonical.ts > a.maxAgeSec) {
      out.skips.push({ id: a.id, reason: "source-stale", detail: `source age ${now - p.canonical.ts}s` });
      continue;
    }
    const priceE18 = parseUnitsExact(trimDecimals(p.canonical.usd, 18), 18);
    if (priceE18 < a.bandMinE18 || priceE18 > a.bandMaxE18) {
      out.skips.push({ id: a.id, reason: "band", detail: `${p.canonical.usd} outside band` });
      continue;
    }
    const due = now - a.lastPushedAt >= cfg.pushIntervalSec;
    const moved = moveBpsE18(priceE18, a.lastPriceE18) > cfg.moveBps;
    if (due || moved) out.pushes.push({ id: a.id, address: a.address, priceE18, reason: moved ? "move" : "interval" });
  }
  return out;
}

function trimDecimals(v: string, max: number): string {
  const [w, f = ""] = v.split(".");
  return f.length > max ? `${w}.${f.slice(0, max)}` : v;
}
