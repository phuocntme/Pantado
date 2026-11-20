/**
 * Weight presets (spec §9.6) — deterministic backend math, never the LLM. Output: integer percents summing
 * to 100, each ≥ 1, by largest-remainder rounding.
 */

export class PresetError extends Error {
  override readonly name = "PresetError";
}

/**
 * Largest-remainder rounding of non-negative raw weights to integers summing to `total`, each ≥ `min`:
 * floor the exact shares, lift any below `min`, then hand out (or take back) the difference by largest
 * remainder (or smallest, from weights above `min`). Ties go to the earlier asset.
 */
export function largestRemainder(raw: number[], total = 100, min = 1): number[] {
  const n = raw.length;
  if (n === 0) return [];
  if (n * min > total) throw new PresetError(`${n} assets cannot each get ${min}%`);
  const sum = raw.reduce((a, b) => a + b, 0);
  const exact = raw.map((r) => (sum > 0 ? (r / sum) * total : total / n));
  const out = exact.map((e) => Math.max(min, Math.floor(e)));
  let diff = total - out.reduce((a, b) => a + b, 0);
  while (diff > 0) {
    let best = 0;
    for (let i = 1; i < n; i++) if ((exact[i] ?? 0) - (out[i] ?? 0) > (exact[best] ?? 0) - (out[best] ?? 0)) best = i;
    out[best] = (out[best] ?? 0) + 1;
    diff--;
  }
  while (diff < 0) {
    let best = -1;
    for (let i = 0; i < n; i++) {
      if ((out[i] ?? 0) <= min) continue;
      if (best < 0 || (out[i] ?? 0) - (exact[i] ?? 0) > (out[best] ?? 0) - (exact[best] ?? 0)) best = i;
    }
    out[best] = (out[best] ?? 0) - 1;
    diff++;
  }
  return out;
}

export function equalWeights(n: number): number[] {
  return largestRemainder(new Array<number>(n).fill(1));
}

/**
 * Market cap preset: ∝ market cap, each capped at `capPct` (40), excess redistributed pro rata to the
 * uncapped; the cap rises to 100/n when n × cap < 100.
 */
export function marketCapWeights(caps: number[], capPct = 40): number[] {
  const n = caps.length;
  if (caps.some((c) => !(c > 0))) throw new PresetError("market cap missing for an asset");
  const cap = Math.max(capPct, 100 / n) / 100;
  let w = caps.map((c) => c / caps.reduce((a, b) => a + b, 0));
  for (let iter = 0; iter < n; iter++) {
    const over = w.map((x) => x > cap + 1e-12);
    if (!over.some(Boolean)) break;
    const excess = w.reduce((s, x, i) => s + (over[i] ? x - cap : 0), 0);
    const freeSum = w.reduce((s, x, i) => s + (over[i] ? 0 : x), 0);
    w = w.map((x, i) => (over[i] ? cap : freeSum > 0 ? x + (excess * x) / freeSum : x));
  }
  return largestRemainder(w);
}

/** Daily log-return standard deviation of a price series (oldest first). */
export function volatility(prices: number[]): number {
  const r: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const a = prices[i - 1];
    const b = prices[i];
    if (a && b && a > 0 && b > 0) r.push(Math.log(b / a));
  }
  if (r.length < 2) return Number.NaN;
  const m = r.reduce((s, x) => s + x, 0) / r.length;
  return Math.sqrt(r.reduce((s, x) => s + (x - m) ** 2, 0) / (r.length - 1));
}

/** Low volatility preset: ∝ 1/σ of daily returns over the lookback. */
export function lowVolWeights(series: number[][]): number[] {
  const inv = series.map((s) => {
    const v = volatility(s);
    if (!(v > 0)) throw new PresetError("not enough price history for an asset");
    return 1 / v;
  });
  return largestRemainder(inv);
}
