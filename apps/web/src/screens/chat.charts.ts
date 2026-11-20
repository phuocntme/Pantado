/**
 * Geometry and stats for the Ask conversation cards, drawn in the reference's chart style
 * (viewBox 0 0 400 150 line + area, 400×170 candles). Pure functions, unit-tested.
 */
import { DOWN, UP } from "../lib/fmt";

export interface LinePaths {
  line: string;
  area: string;
  baseY: number;
  color: string;
}

const PAD = 12.5;

/** Line + area points for a series (first value = dashed base line), or null for fewer than 2 points. */
export function linePaths(values: number[], w = 400, h = 150): LinePaths | null {
  const xs = values.filter((x) => Number.isFinite(x));
  if (xs.length < 2) return null;
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const span = hi - lo || 1;
  const y = (v: number): number => PAD + (1 - (v - lo) / span) * (h - 2 * PAD);
  const pts = xs.map((v, i) => `${((i / (xs.length - 1)) * w).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return { line: pts, area: `0,${h} ${pts} ${w},${h}`, baseY: Number(y(xs[0] ?? 0).toFixed(1)), color: (xs[xs.length - 1] ?? 0) >= (xs[0] ?? 0) ? UP : DOWN };
}

export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}
export interface CandleRect {
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
}

/** Wick + body rects for daily candles (same proportions as the reference: body 4.1 wide, wick 1). */
export function candleRects(cs: Candle[], w = 400, h = 170): CandleRect[] {
  if (!cs.length) return [];
  const lo = Math.min(...cs.map((c) => c.l));
  const hi = Math.max(...cs.map((c) => c.h));
  const span = hi - lo || 1;
  const y = (v: number): number => 10 + (1 - (v - lo) / span) * (h - 20);
  const step = w / cs.length;
  const body = Math.min(4.1, step * 0.7);
  const out: CandleRect[] = [];
  cs.forEach((c, i) => {
    const fill = c.c >= c.o ? UP : DOWN;
    const cx = i * step + step / 2;
    const r = (n: number): number => Number(n.toFixed(1));
    out.push({ x: r(cx - 0.5), y: r(y(c.h)), width: 1, height: r(Math.max(1, y(c.l) - y(c.h))), fill });
    const top = y(Math.max(c.o, c.c));
    out.push({ x: r(cx - body / 2), y: r(top), width: r(body), height: r(Math.max(1.2, y(Math.min(c.o, c.c)) - top)), fill });
  });
  return out;
}

/** Last value per UTC day from `(tsSec, value)` points, oldest first. */
export function dailyCloses(points: { ts: number; v: number }[]): number[] {
  const m = new Map<number, number>();
  for (const p of [...points].sort((a, b) => a.ts - b.ts)) m.set(Math.floor(p.ts / 86400), p.v);
  return [...m.values()];
}

/** Annualised volatility of daily returns (fraction), or null with fewer than 3 daily closes. */
export function annualVol(closes: number[]): number | null {
  if (closes.length < 3) return null;
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const a = closes[i - 1] ?? 0;
    const b = closes[i] ?? 0;
    if (a > 0) r.push(b / a - 1);
  }
  if (r.length < 2) return null;
  const mean = r.reduce((s, x) => s + x, 0) / r.length;
  const varc = r.reduce((s, x) => s + (x - mean) ** 2, 0) / (r.length - 1);
  return Math.sqrt(varc) * Math.sqrt(365);
}

/** Maximum drawdown (≤ 0, fraction), or null with fewer than 2 values. */
export function maxDrawdown(values: number[]): number | null {
  if (values.length < 2) return null;
  let peak = values[0] ?? 0;
  let dd = 0;
  for (const v of values) {
    peak = Math.max(peak, v);
    if (peak > 0) dd = Math.min(dd, v / peak - 1);
  }
  return dd;
}
