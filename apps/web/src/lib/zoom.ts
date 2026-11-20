/**
 * Chart viewport over a candle series: `count` candles visible, ending (exclusive) at index `end`.
 * Pure functions (unit-tested); the React hook lives in zoom-hook.tsx.
 */
export interface View {
  count: number;
  end: number;
}

export const MIN_VISIBLE = 8;
/** Most candles drawn at once (zooming out further would only blur them; drag to see the rest). */
export const MAX_VISIBLE = 1000;

/** The newest `max` candles (all of them when fewer). */
export function defaultView(n: number, max: number): View {
  return { count: Math.min(MAX_VISIBLE, Math.max(Math.min(n, max), Math.min(n, MIN_VISIBLE))), end: n };
}

/** Keep the view inside the series: at least MIN_VISIBLE (or n) candles, never past either end. */
export function clampView(v: View, n: number): View {
  if (n <= 0) return { count: 0, end: 0 };
  const count = Math.round(Math.min(n, MAX_VISIBLE, Math.max(Math.min(MIN_VISIBLE, n), v.count)));
  const end = Math.round(Math.min(n, Math.max(count, v.end)));
  return { count, end };
}

/**
 * Zoom by `factor` (> 1 zooms out, < 1 zooms in) keeping the candle under `anchor` (0 = left edge,
 * 1 = right edge of the plot) in place.
 */
export function zoomView(v: View, n: number, factor: number, anchor = 1): View {
  const a = Math.min(1, Math.max(0, anchor));
  const count = Math.min(n, MAX_VISIBLE, Math.max(Math.min(MIN_VISIBLE, n), Math.round(v.count * factor)));
  const start = v.end - v.count;
  const pivot = start + a * v.count;
  const nextStart = pivot - a * count;
  return clampView({ count, end: Math.round(nextStart + count) }, n);
}

/** Move by `bars` candles (positive = towards older data). */
export function panView(v: View, n: number, bars: number): View {
  return clampView({ count: v.count, end: v.end - Math.round(bars) }, n);
}

export function visible<T>(xs: T[], v: View): T[] {
  const c = clampView(v, xs.length);
  return xs.slice(c.end - c.count, c.end);
}
