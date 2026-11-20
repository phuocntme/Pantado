export interface Obs {
  ts: number; // unix seconds
  price: number; // USD (or quote) per token
}

/** Drop observations beyond `sigma` standard deviations of the last `window` (spec §9.3). */
export function dropOutliers(obs: Obs[], sigma: number, window: number): Obs[] {
  const recent = [...obs].sort((a, b) => a.ts - b.ts).slice(-window);
  if (recent.length < 3) return recent;
  const mean = recent.reduce((s, o) => s + o.price, 0) / recent.length;
  const sd = Math.sqrt(recent.reduce((s, o) => s + (o.price - mean) ** 2, 0) / recent.length);
  if (sd === 0) return recent;
  return recent.filter((o) => Math.abs(o.price - mean) <= sigma * sd);
}

/** Time-weighted average over [now − windowSec, now]; each observation holds until the next. */
export function twap(obs: Obs[], windowSec: number, now: number): number | null {
  const sorted = [...obs].sort((a, b) => a.ts - b.ts);
  if (sorted.length === 0) return null;
  const start = now - windowSec;
  // price in force at the window start = last observation before it
  let current: Obs | undefined;
  const inWindow: Obs[] = [];
  for (const o of sorted) {
    if (o.ts <= start) current = o;
    else if (o.ts <= now) inWindow.push(o);
  }
  if (!current && inWindow.length === 0) return null;
  let t = start;
  let p = current?.price ?? inWindow[0]?.price ?? 0;
  if (!current) t = inWindow[0]?.ts ?? start;
  let acc = 0;
  for (const o of inWindow) {
    acc += p * (o.ts - t);
    t = o.ts;
    p = o.price;
  }
  acc += p * (now - t);
  const span = now - (current ? start : (inWindow[0]?.ts ?? start));
  return span > 0 ? acc / span : p;
}
