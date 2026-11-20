/**
 * Create › metrics from real data only. Backtest = buy-and-hold of the chosen weights over the last
 * `days` days of daily closes (canonical prices as pushed). Any asset without that much history → null,
 * and the screen shows "—" (never a made-up number).
 */

export interface DailyClose {
  t: number; // day bucket, unix seconds
  c: number;
}

export interface Backtest {
  ret: number; // fraction over the window
  vol: number; // annualised stdev of daily returns, fraction
  dd: number; // max drawdown, fraction ≤ 0
}

const DAY = 86400;

export function backtest(series: DailyClose[][], weights: number[], days = 90): Backtest | null {
  if (series.length < 2 || series.length !== weights.length) return null;
  const wsum = weights.reduce((s, x) => s + x, 0);
  if (!(wsum > 0)) return null;
  const maps = series.map((s) => new Map(s.filter((k) => k.c > 0).map((k) => [Math.floor(k.t / DAY), k.c])));
  const first = maps[0]!;
  const common = [...first.keys()].filter((d) => maps.every((m) => m.has(d))).sort((a, b) => a - b);
  if (common.length < 2) return null;
  const end = common[common.length - 1]!;
  const window = common.filter((d) => d >= end - days);
  if (window.length < 2 || window[0]! > end - days) return null; // not enough history for the full window
  const base = maps.map((m) => m.get(window[0]!)!);
  const values = window.map((d) => maps.reduce((s, m, i) => s + ((weights[i] ?? 0) / wsum) * (m.get(d)! / base[i]!), 0));
  const rets: number[] = [];
  for (let k = 1; k < values.length; k++) rets.push(values[k]! / values[k - 1]! - 1);
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, rets.length - 1);
  let peak = values[0]!;
  let dd = 0;
  for (const v of values) {
    peak = Math.max(peak, v);
    dd = Math.min(dd, v / peak - 1);
  }
  return { ret: values[values.length - 1]! - 1, vol: Math.sqrt(variance) * Math.sqrt(365), dd };
}

/** Cost of a $1k first buy beyond the trade fee, from a create quote (units at level 100, 18 dp). */
export function slippage1k(q: { usdcIn: string; tradeFee: string; units: string } | null): number | null {
  if (!q) return null;
  const net = Number(BigInt(q.usdcIn) - BigInt(q.tradeFee)) / 1e6;
  const got = (Number(BigInt(q.units)) / 1e18) * 100;
  if (!(net > 0)) return null;
  return Math.max(0, 1 - got / net);
}
