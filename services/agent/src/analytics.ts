/**
 * Deterministic market math for the Ask tools: price-history summaries and basket backtests from daily candles
 * (`/assets/:id/candles?interval=1d`). The model chooses what to ask and explains the result; every number it
 * states comes from here.
 */

export interface Candle {
  t: number; // unix seconds, start of the day (UTC)
  o: number;
  h: number;
  l: number;
  c: number;
}

export type Coverage = "full" | "partial" | "none";

const DAY = 86_400;
const day = (t: number): string => new Date(t * 1000).toISOString().slice(0, 10);
/** Round to `sig` significant digits (keeps tool output short and stable). */
export const sig = (v: number, n = 6): number => (v === 0 || !Number.isFinite(v) ? v : Number(v.toPrecision(n)));

/** Daily candles in [from, to] (inclusive by day start), oldest first. */
export function window(candles: Candle[], from: number, to: number): Candle[] {
  return candles.filter((c) => c.t >= from - (from % DAY) && c.t <= to).sort((a, b) => a.t - b.t);
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

/** Largest peak-to-trough fall of a value series, as a fraction (0.25 = −25 %). */
export function maxDrawdown(values: number[]): number {
  let peak = -Infinity;
  let dd = 0;
  for (const v of values) {
    peak = Math.max(peak, v);
    if (peak > 0) dd = Math.max(dd, 1 - v / peak);
  }
  return dd;
}

/** Volatility of daily closes, annualised over 365 days (crypto and pTokens trade every day). */
export function annualVol(closes: number[]): number {
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const a = closes[i - 1] as number;
    const b = closes[i] as number;
    if (a > 0) r.push(b / a - 1);
  }
  return stdev(r) * Math.sqrt(365);
}

export interface PriceSummary {
  from: string;
  to: string;
  days: number;
  open: number;
  close: number;
  /** close / open − 1 */
  returnPct: number;
  high: { price: number; date: string };
  low: { price: number; date: string };
  annualVolPct: number;
  maxDrawdownPct: number;
  coverage: Coverage;
}

/** One asset over a period. Coverage is partial when the data starts after `from` (asset listed later). */
export function summarize(candles: Candle[], from: number, to: number): PriceSummary | null {
  const w = window(candles, from, to);
  const first = w[0];
  const last = w[w.length - 1];
  if (!first || !last || w.length < 2) return null;
  let hi = first;
  let lo = first;
  for (const c of w) {
    if (c.h > hi.h) hi = c;
    if (c.l < lo.l) lo = c;
  }
  const closes = w.map((c) => c.c);
  return {
    from: day(first.t),
    to: day(last.t),
    days: Math.round((last.t - first.t) / DAY) + 1,
    open: sig(first.o),
    close: sig(last.c),
    returnPct: sig((last.c / first.o - 1) * 100, 4),
    high: { price: sig(hi.h), date: day(hi.t) },
    low: { price: sig(lo.l), date: day(lo.t) },
    annualVolPct: sig(annualVol(closes) * 100, 4),
    maxDrawdownPct: sig(maxDrawdown(closes) * 100, 4),
    coverage: first.t - (from - (from % DAY)) > DAY ? "partial" : "full",
  };
}

export interface BacktestResult {
  from: string;
  to: string;
  days: number;
  rebalance: "none" | "monthly";
  returnPct: number;
  annualVolPct: number;
  maxDrawdownPct: number;
  benchmark: { id: string; returnPct: number; annualVolPct: number; maxDrawdownPct: number } | null;
  /** partial: the common history of all assets starts after the requested start */
  coverage: Coverage;
  note: string;
}

/**
 * Hypothetical value of a basket bought at the start of the common history with `weights` (fractions summing
 * to 1), either held (`none`) or reset to the weights every 30 days (`monthly`, the Auto mode's time trigger).
 * Fees, spreads and auction costs are not modelled.
 */
export function backtest(
  series: Map<string, Candle[]>,
  weights: Map<string, number>,
  from: number,
  to: number,
  rebalance: "none" | "monthly",
  bench: { id: string; candles: Candle[] } | null,
): BacktestResult | { error: string; missing?: string[] } {
  const ids = [...weights.keys()];
  const closes = new Map<string, Map<number, number>>();
  for (const id of ids) {
    const w = window(series.get(id) ?? [], from, to);
    closes.set(id, new Map(w.map((c) => [c.t, c.c])));
  }
  const missing = ids.filter((id) => (closes.get(id)?.size ?? 0) < 2);
  if (missing.length) return { error: "not enough price history", missing };
  // days where every asset has a close
  const days = [...(closes.get(ids[0] as string) as Map<number, number>).keys()].filter((t) => ids.every((id) => closes.get(id)?.has(t))).sort((a, b) => a - b);
  if (days.length < 2) return { error: "the assets have no common price history in this period" };
  const px = (id: string, t: number): number => closes.get(id)?.get(t) as number;
  const start = days[0] as number;
  let units = new Map(ids.map((id) => [id, (weights.get(id) as number) / px(id, start)]));
  let lastReset = start;
  const values: number[] = [];
  for (const t of days) {
    let v = 0;
    for (const id of ids) v += (units.get(id) as number) * px(id, t);
    values.push(v);
    if (rebalance === "monthly" && t - lastReset >= 30 * DAY) {
      units = new Map(ids.map((id) => [id, ((weights.get(id) as number) * v) / px(id, t)]));
      lastReset = t;
    }
  }
  const end = days[days.length - 1] as number;
  let benchmark: BacktestResult["benchmark"] = null;
  if (bench) {
    const bc = window(bench.candles, start, end).map((c) => c.c);
    const b0 = bc[0];
    const b1 = bc[bc.length - 1];
    if (b0 && b1 && bc.length >= 2)
      benchmark = { id: bench.id, returnPct: sig((b1 / b0 - 1) * 100, 4), annualVolPct: sig(annualVol(bc) * 100, 4), maxDrawdownPct: sig(maxDrawdown(bc) * 100, 4) };
  }
  return {
    from: day(start),
    to: day(end),
    days: Math.round((end - start) / DAY) + 1,
    rebalance,
    returnPct: sig(((values[values.length - 1] as number) - 1) * 100, 4),
    annualVolPct: sig(annualVol(values) * 100, 4),
    maxDrawdownPct: sig(maxDrawdown(values) * 100, 4),
    benchmark,
    coverage: start - (from - (from % DAY)) > DAY ? "partial" : "full",
    note: "Hypothetical: past prices of the reference markets, no fees, spreads or auction costs. Not a forecast.",
  };
}

/** Start of a named period ending at `now` (unix seconds). `all` = the history start (`since`). */
export function periodStart(period: string, now: number, since: number): number {
  const d = new Date(now * 1000);
  switch (period) {
    case "7d":
      return now - 7 * DAY;
    case "30d":
      return now - 30 * DAY;
    case "90d":
      return now - 90 * DAY;
    case "180d":
      return now - 180 * DAY;
    case "1y":
      return now - 365 * DAY;
    case "ytd":
      return Date.UTC(d.getUTCFullYear(), 0, 1) / 1000;
    default:
      return since;
  }
}
