import { smallDp, tinyNum } from "../lib/fmt";
/**
 * Pure candlestick layout for the Asset (and index Review) chart slot. Same visual grammar as the
 * reference chart: 1000×520 viewBox, green/red bodies with 1-unit wicks, faint grid, right price axis
 * with the last price tag, bottom date axis. Volume bars are drawn only when the data has volume.
 */
import { DOWN, UP } from "../lib/fmt";

export interface Candle {
  t: number; // bucket start, unix seconds
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
}

export interface CandleBar {
  x: number;
  w: number;
  wickX: number;
  wickY: number;
  wickH: number;
  bodyY: number;
  bodyH: number;
  volY: number;
  volH: number;
  col: string;
}

export interface AxisTick {
  label: string;
  pct: number; // 0..100 from top (y) or left (x)
}

export interface ChartModel {
  empty: boolean;
  bars: CandleBar[];
  gridX: number[];
  gridY: number[];
  yTicks: AxisTick[];
  xTicks: AxisTick[];
  last: { label: string; pct: number; col: string } | null;
  ohlc: { o: string; h: string; l: string; c: string; chg: string; col: string } | null;
  hasVolume: boolean;
  /** x (viewBox units) of the hovered candle, for the crosshair; null when none is hovered. */
  focusX: number | null;
  /** Candle slots across the width (the layout spreads `max(n, 20)` slots, left-aligned). */
  slots: number;
}

const W = 1000;
const H = 520;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 1-2-5 step for ~6 ticks over the range. */
export function niceStep(range: number, ticks = 6): number {
  if (!(range > 0)) return 1;
  const raw = range / ticks;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

/** Axis number with enough decimals for the scale ("169.95", "0.2134", "74,357"). */
export function axisNum(v: number, step: number): string {
  if (v > 0 && v < 1e-4 && step > 0) {
    // significant digits the step needs after the leading zeros
    const zeros = -Math.floor(Math.log10(v)) - 1;
    return tinyNum(v, Math.max(1, Math.min(6, Math.ceil(-Math.log10(step)) - zeros))) ?? String(v);
  }
  const dp = step >= 1 ? (Math.abs(v) >= 1000 ? 0 : step % 1 === 0 ? 0 : 1) : Math.min(20, Math.ceil(-Math.log10(step)));
  return v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** Price text for the legend and the last-price tag (2 dp, more for small prices: 4 significant digits). */
export function pxNum(v: number): string {
  const tiny = tinyNum(v);
  if (tiny) return tiny;
  const dp = v >= 1 ? 2 : v >= 0.01 ? 4 : smallDp(v);
  return v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp, useGrouping: v >= 10_000 });
}

/** Candle slots the layout uses for `n` candles. */
export const chartSlots = (n: number): number => Math.max(n, 20);

/**
 * Layout of `candles` (oldest first). `focus` = index of the hovered candle: the legend then shows that
 * candle (change vs. the previous close) and a crosshair marks it; otherwise the legend shows the last one.
 * `slotsOverride`: slots across the width (a zoomed-in view fills the width; default `chartSlots(n)`).
 */
export function buildChart(candles: Candle[], chgDp = 1, volumeShare = 0.18, focus: number | null = null, slotsOverride?: number): ChartModel {
  const cs = candles.filter((k) => [k.o, k.h, k.l, k.c].every((x) => Number.isFinite(x) && x > 0));
  if (cs.length === 0)
    return { empty: true, bars: [], gridX: [], gridY: [], yTicks: [], xTicks: [], last: null, ohlc: null, hasVolume: false, focusX: null, slots: chartSlots(0) };
  const hasVolume = cs.some((k) => (k.v ?? 0) > 0);
  const priceBottom = hasVolume ? H * (1 - volumeShare) - 10 : H - 20;
  const priceTop = 20;
  let lo = Math.min(...cs.map((k) => k.l));
  let hi = Math.max(...cs.map((k) => k.h));
  if (hi === lo) {
    const pad = hi * 0.01 || 1;
    hi += pad;
    lo -= pad;
  }
  const pad = (hi - lo) * 0.06;
  lo -= pad;
  hi += pad;
  const y = (p: number): number => priceTop + ((hi - p) / (hi - lo)) * (priceBottom - priceTop);
  const slotN = Math.max(cs.length, slotsOverride ?? chartSlots(cs.length));
  const slot = W / slotN;
  const bw = Math.max(1, Math.min(14, slot * 0.62));
  const vmax = Math.max(...cs.map((k) => k.v ?? 0), 0);
  const bars = cs.map((k, i) => {
    const cx = slot * i + slot / 2;
    const up = k.c >= k.o;
    const top = y(Math.max(k.o, k.c));
    const bot = y(Math.min(k.o, k.c));
    const volH = hasVolume && vmax > 0 ? ((k.v ?? 0) / vmax) * H * volumeShare : 0;
    return {
      x: round(cx - bw / 2),
      w: round(bw),
      wickX: round(cx - 0.5),
      wickY: round(y(k.h)),
      wickH: round(Math.max(1, y(k.l) - y(k.h))),
      bodyY: round(top),
      bodyH: round(Math.max(1.2, bot - top)),
      volY: round(H - volH),
      volH: round(volH),
      col: up ? UP : DOWN,
    };
  });
  const step = niceStep(hi - lo);
  const yTicks: AxisTick[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) yTicks.push({ label: axisNum(v, step), pct: round((y(v) / H) * 100) });
  const xTicks: AxisTick[] = [];
  const span = cs[cs.length - 1]!.t - cs[0]!.t;
  // label density: about 8 labels whatever the zoom
  const dayStep = Math.max(1, Math.ceil(span / 86400 / 8));
  const hourStep = [1, 2, 3, 4, 6, 12].find((h) => span / 3600 / h <= 8) ?? 12;
  cs.forEach((k, i) => {
    const d = new Date(k.t * 1000);
    const prev = i > 0 ? new Date(cs[i - 1]!.t * 1000) : null;
    const pct = round(((slot * i + slot / 2) / W) * 100);
    if (span >= 60 * 86400) {
      if (prev && d.getUTCMonth() !== prev.getUTCMonth()) xTicks.push({ label: MONTHS[d.getUTCMonth()]!, pct });
      else if (span < 200 * 86400 && prev && d.getUTCDate() >= 15 && prev.getUTCDate() < 15) xTicks.push({ label: "15", pct });
    } else if (span >= 2 * 86400) {
      const day = Math.floor(k.t / 86400);
      if (prev && d.getUTCMonth() !== prev.getUTCMonth()) xTicks.push({ label: MONTHS[d.getUTCMonth()]!, pct }); // month starts always
      else if (prev && day !== Math.floor(cs[i - 1]!.t / 86400) && day % dayStep === 0 && d.getUTCDate() > 2)
        xTicks.push({ label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`, pct });
    } else if (d.getUTCMinutes() === 0 && d.getUTCHours() % hourStep === 0) {
      xTicks.push({ label: d.getUTCHours() === 0 ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}` : `${String(d.getUTCHours()).padStart(2, "0")}:00`, pct });
    }
  });
  const lastK = cs[cs.length - 1]!;
  const fi = focus !== null && focus >= 0 && focus < cs.length ? focus : cs.length - 1;
  const fK = cs[fi]!;
  const prevClose = fi > 0 ? cs[fi - 1]!.c : fK.o;
  const chgF = prevClose > 0 ? fK.c / prevClose - 1 : 0;
  const col = chgF >= 0 ? UP : DOWN;
  const lastPrev = cs.length > 1 ? cs[cs.length - 2]!.c : lastK.o;
  const lastCol = lastK.c >= lastPrev ? UP : DOWN;
  return {
    empty: false,
    bars,
    gridX: xTicks.map((t) => round((t.pct / 100) * W)),
    gridY: yTicks.map((t) => round((t.pct / 100) * H)),
    yTicks,
    xTicks,
    last: { label: pxNum(lastK.c), pct: round((y(lastK.c) / H) * 100), col: lastCol },
    ohlc: {
      o: pxNum(fK.o),
      h: pxNum(fK.h),
      l: pxNum(fK.l),
      c: pxNum(fK.c),
      chg: `${chgF >= 0 ? "+" : "-"}${Math.abs(chgF * 100).toFixed(chgDp)}%`,
      col,
    },
    hasVolume,
    focusX: fi === focus ? round(slot * fi + slot / 2) : null,
    slots: slotN,
  };
}

const round = (n: number): number => Math.round(n * 10) / 10;
