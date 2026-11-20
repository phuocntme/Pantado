/**
 * Daily level candles for the Index chart, from `/indexes/:id/levels` (per-block levels) and buy/sell volume
 * from `/indexes/:id/transactions`. Geometry matches the reference chart: viewBox 1000×520, candles in the
 * upper area, volume bars (opacity 0.28) at the bottom, right price scale, bottom date scale.
 */
import { UP, DOWN } from "../lib/fmt";
import { monthName, wad, fromBase, USDC_DECIMALS, type IndexEvent, type Levels } from "./index.data";

export interface Candle {
  t: number; // bucket start, unix seconds
  o: number;
  h: number;
  l: number;
  c: number;
  vol: number; // USD
}

export interface ChartGeom {
  candles: {
    up: boolean;
    col: string;
    wick: { x: number; y: number; h: number };
    body: { x: number; y: number; w: number; h: number };
    vol: { x: number; y: number; w: number; h: number };
  }[];
  vLines: number[];
  hLines: number[];
  yLabels: { text: string; top: string }[];
  xLabels: { text: string; left: string }[];
  last: { y: number; top: string; text: string; col: string } | null;
  ohlc: { o: string; h: string; l: string; c: string; chg: string; col: string } | null;
  /** x (viewBox) of the hovered candle for the crosshair; null when none. */
  focusX: number | null;
  /** First slot holding a candle (candles are right-aligned) and the slot count. */
  x0Slot: number;
  slots: number;
}

/** Group per-block levels into UTC daily OHLC candles; add USD volume per day. */
export function dailyCandles(levels: Levels["levels"], txs: IndexEvent[]): Candle[] {
  return levelCandles(levels, txs, 86400);
}

/** Bucket start of `t` for a bucket of `sec` (weeks start on Monday 00:00 UTC). */
export function bucketOf(t: number, sec: number): number {
  const W = 7 * 86400;
  return sec === W ? Math.floor((t - 4 * 86400) / W) * W + 4 * 86400 : Math.floor(t / sec) * sec;
}

/** Group per-block levels into OHLC candles of `sec` seconds; add USD volume per bucket. */
export function levelCandles(levels: Levels["levels"], txs: IndexEvent[], sec: number): Candle[] {
  const byDay = new Map<number, Candle>();
  const sorted = [...levels].sort((a, b) => Number(a.ts) - Number(b.ts));
  for (const p of sorted) {
    const v = wad(p.level);
    if (!Number.isFinite(v) || v <= 0) continue;
    const t = bucketOf(Number(p.ts), sec);
    const c = byDay.get(t);
    if (!c) byDay.set(t, { t, o: v, h: v, l: v, c: v, vol: 0 });
    else {
      c.h = Math.max(c.h, v);
      c.l = Math.min(c.l, v);
      c.c = v;
    }
  }
  for (const e of txs) {
    const c = byDay.get(bucketOf(Number(e.ts), sec));
    if (!c) continue;
    if (e.kind === "buy") c.vol += fromBase(e.usdc, USDC_DECIMALS) || 0;
    if (e.kind === "sell") c.vol += fromBase(typeof e.data?.gross === "string" ? e.data.gross : e.usdc, USDC_DECIMALS) || 0;
  }
  return [...byDay.values()].sort((a, b) => a.t - b.t);
}

function niceStep(range: number): number {
  const raw = range / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

const W = 1000;
const H = 520;
const TOP = 60; // highest price
const BOTTOM = 400; // lowest price
const VOL_MAX = 90; // tallest volume bar
export const SLOTS = 112; // candles visible at full width, like the reference

/**
 * Geometry of the newest `slots` candles, right-aligned (newest at the right edge). Fewer slots = zoomed
 * in (wider bodies). `focus` = index (in `candles.slice(-slots)`) of the hovered candle for the legend.
 */
export function chartGeometry(candles: Candle[], slots = SLOTS, focus: number | null = null): ChartGeom {
  slots = Math.max(1, Math.round(slots));
  const shown = candles.slice(-slots);
  if (shown.length === 0) return { candles: [], vLines: [], hLines: [], yLabels: [], xLabels: [], last: null, ohlc: null, focusX: null, x0Slot: slots, slots };
  const hi = Math.max(...shown.map((c) => c.h));
  const lo = Math.min(...shown.map((c) => c.l));
  const pad = Math.max((hi - lo) * 0.05, hi * 0.002);
  const top = hi + pad;
  const bot = lo - pad;
  const y = (p: number): number => TOP + ((top - p) / (top - bot)) * (BOTTOM - TOP);
  const step = W / slots;
  const x0 = W - shown.length * step; // right-aligned, newest at the right edge
  const bw = Math.min(24, Math.max(1, (5.6 * SLOTS) / slots)); // 5.6 at the reference zoom
  const mid = (i: number): number => x0 + i * step + step * 0.563; // body centre (reference: x + 2.23 + 2.8)
  const vmax = Math.max(...shown.map((c) => c.vol), 0);
  const r1 = (n: number): number => Math.round(n * 10) / 10;

  const geom = shown.map((c, i) => {
    const up = c.c >= c.o;
    const x = x0 + i * step;
    const bodyTop = y(Math.max(c.o, c.c));
    const bodyH = Math.max(1.2, Math.abs(y(c.o) - y(c.c)));
    const vh = vmax > 0 ? (c.vol / vmax) * VOL_MAX : 0;
    return {
      up,
      col: up ? UP : DOWN,
      wick: { x: r1(mid(i) - 0.5), y: r1(y(c.h)), h: r1(Math.max(1, y(c.l) - y(c.h))) },
      body: { x: r1(mid(i) - bw / 2), y: r1(bodyTop), w: r1(bw), h: r1(bodyH) },
      vol: { x: r1(mid(i) - bw / 2), y: r1(H - vh), w: r1(bw), h: r1(vh) },
    };
  });

  const s = niceStep(top - bot);
  const ticks: number[] = [];
  for (let t = Math.ceil(bot / s) * s; t <= top; t += s) ticks.push(t);
  const dp = s < 1 ? 2 : 1;
  const hLines = ticks.map((t) => r1(y(t)));
  const yLabels = ticks.map((t) => ({ text: t.toFixed(dp), top: `${((y(t) / H) * 100).toFixed(2)}%` }));

  const vLines: number[] = [];
  const xLabels: { text: string; left: string }[] = [];
  const span = (shown[shown.length - 1]?.t ?? 0) - (shown[0]?.t ?? 0);
  const dayStep = Math.max(1, Math.ceil(span / 86400 / 8));
  const hourStep = [1, 2, 3, 4, 6, 12].find((h) => span / 3600 / h <= 8) ?? 12;
  shown.forEach((c, i) => {
    const d = new Date(c.t * 1000);
    const p = i > 0 ? shown[i - 1] : undefined;
    if (!p) return;
    const prev = new Date(p.t * 1000);
    const newMonth = prev.getUTCMonth() !== d.getUTCMonth();
    let text: string | null = null;
    if (span >= 20 * 86400) {
      // the reference: month names and the 15th
      if (newMonth) text = monthName(d.getUTCMonth());
      else if (span < 200 * 86400 && d.getUTCDate() >= 15 && prev.getUTCDate() < 15) text = "15";
    } else if (span >= 2 * 86400) {
      const day = Math.floor(c.t / 86400);
      if (newMonth) text = monthName(d.getUTCMonth());
      else if (day !== Math.floor(p.t / 86400) && day % dayStep === 0 && d.getUTCDate() > 2) text = `${monthName(d.getUTCMonth())} ${d.getUTCDate()}`;
    } else if (d.getUTCMinutes() === 0 && d.getUTCHours() % hourStep === 0) {
      text = d.getUTCHours() === 0 ? `${monthName(d.getUTCMonth())} ${d.getUTCDate()}` : `${String(d.getUTCHours()).padStart(2, "0")}:00`;
    }
    if (text === null) return;
    const x = r1(mid(i) - 0.5);
    vLines.push(x);
    xLabels.push({ text, left: `${((x / W) * 100).toFixed(2)}%` });
  });

  const lastC = shown[shown.length - 1] as Candle;
  const fi = focus !== null && focus >= 0 && focus < shown.length ? focus : shown.length - 1;
  const fC = shown[fi] as Candle;
  const chg = fC.o > 0 ? fC.c / fC.o - 1 : 0;
  const col = fC.c >= fC.o ? UP : DOWN;
  const lastCol = lastC.c >= lastC.o ? UP : DOWN;
  const ly = r1(y(lastC.c));
  return {
    candles: geom,
    vLines,
    hLines,
    yLabels,
    xLabels,
    last: { y: ly, top: `${((ly / H) * 100).toFixed(2)}%`, text: lastC.c.toFixed(2), col: lastCol },
    focusX: fi === focus ? r1(mid(fi)) : null,
    x0Slot: slots - shown.length,
    slots,
    ohlc: {
      o: fC.o.toFixed(2),
      h: fC.h.toFixed(2),
      l: fC.l.toFixed(2),
      c: fC.c.toFixed(2),
      chg: `${chg >= 0 ? "+" : "-"}${Math.abs(chg * 100).toFixed(2)}%`,
      col,
    },
  };
}
