import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * One bar in USD. `f` / `z` are the times of its first and last swap, so swaps read out of order (history is
 * scanned newest chunk first) still set the right open and close.
 */
interface Bar {
  o: number;
  h: number;
  l: number;
  c: number;
  f: number;
  z: number;
}

export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface Changes {
  d1: number | null;
  d7: number | null;
  d30: number | null;
}

const DAY = 86_400;
const WEEK = 7 * DAY;
/** 1970-01-01 was a Thursday: shift so weekly buckets start on Monday 00:00 UTC. */
const MONDAY = 4 * DAY;

export function bucketStart(t: number, sec: number): number {
  return sec === WEEK ? Math.floor((t - MONDAY) / WEEK) * WEEK + MONDAY : Math.floor(t / sec) * sec;
}

/** Unix seconds of a `YYYY-MM-DD` UTC date. */
export function dateTs(day: string): number {
  return Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000);
}

function binarySearch(xs: number[], t: number): number {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((xs[mid] ?? 0) < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

class Series {
  readonly bars = new Map<number, Bar>();
  private sortedKeys: number[] | null = null;
  /** History is complete from this time on (the scan has read every swap since). */
  coveredFrom = Number.POSITIVE_INFINITY;

  keys(): number[] {
    if (!this.sortedKeys) this.sortedKeys = [...this.bars.keys()].sort((a, b) => a - b);
    return this.sortedKeys;
  }

  set(t: number, b: Bar): void {
    if (!this.bars.has(t)) this.sortedKeys = null;
    this.bars.set(t, b);
  }

  delete(t: number): void {
    if (this.bars.delete(t)) this.sortedKeys = null;
  }
}

/**
 * Price history per asset as `barSec` bars built from every swap of the asset's history pool (spec §9.2
 * candles, §9.4 board changes). Longer candles are aggregated on read; buckets without a swap repeat the
 * previous close. Persisted to a JSON file so a restart does not re-read the chains.
 */
export class PriceHistory {
  private readonly series = new Map<string, Series>();

  constructor(
    /** Oldest time kept (unix seconds). */
    readonly since: number,
    readonly barSec = 900,
  ) {}

  private get(id: string): Series {
    let s = this.series.get(id);
    if (!s) this.series.set(id, (s = new Series()));
    return s;
  }

  ids(): string[] {
    return [...this.series.keys()];
  }

  /** A swap at `ts` priced the asset at `usd`. */
  addSwap(id: string, ts: number, usd: number): void {
    if (!(usd > 0) || !Number.isFinite(usd) || ts < this.since) return;
    const t = Math.floor(ts / this.barSec) * this.barSec;
    const s = this.get(id);
    const b = s.bars.get(t);
    if (!b) {
      s.set(t, { o: usd, h: usd, l: usd, c: usd, f: ts, z: ts });
      return;
    }
    if (usd > b.h) b.h = usd;
    if (usd < b.l) b.l = usd;
    if (ts >= b.z) {
      b.c = usd;
      b.z = ts;
    }
    if (ts < b.f) {
      b.o = usd;
      b.f = ts;
    }
  }

  /** Every swap of `id` from `ts` on has been read. */
  setCovered(id: string, ts: number): void {
    this.get(id).coveredFrom = Math.max(ts, this.since);
  }

  /** Blocks of each pool already read, `${chain}:${pool}` → [first, last] (persisted with the bars). */
  readonly scanned = new Map<string, [number, number]>();

  coveredFrom(id: string): number | null {
    const c = this.series.get(id)?.coveredFrom;
    return c === undefined || c === Number.POSITIVE_INFINITY ? null : c;
  }

  /** Close of the last swap at or before `ts`; null when nothing is known that far back. */
  closeAt(id: string, ts: number): number | null {
    const s = this.series.get(id);
    if (!s) return null;
    const keys = s.keys();
    let i = binarySearch(keys, Math.floor(ts / this.barSec) * this.barSec + 1) - 1;
    for (; i >= 0; i--) {
      const b = s.bars.get(keys[i] ?? 0);
      if (!b) continue;
      if (b.z <= ts) return b.c;
      // the bar holding `ts` also has later swaps: its open is the best price at or before `ts` within it
      if (b.f <= ts) return b.o;
    }
    return null;
  }

  /**
   * Candles of `sec` (a multiple of the bar length; weeks start on Monday), oldest first, the newest `limit`
   * ending before `before` (exclusive bucket start) if given. Buckets with no swap between the first and
   * `until` repeat the previous close.
   */
  candles(id: string, sec: number, limit: number, opts: { before?: number; until?: number } = {}): Candle[] {
    const s = this.series.get(id);
    if (!s || !s.bars.size) return [];
    const keys = s.keys();
    const endBucket = bucketStart(Math.max(opts.until ?? 0, keys[keys.length - 1] ?? 0), sec);
    const last = opts.before !== undefined ? Math.min(endBucket, bucketStart(opts.before, sec) - 1) : endBucket;
    // walk back from `last` collecting `limit` buckets; start from the bars of those buckets
    const firstKey = keys[0] ?? 0;
    const out: Candle[] = [];
    let k = binarySearch(keys, nextBucket(bucketStart(last, sec), sec)) - 1; // last bar inside a wanted bucket
    // aggregate backwards: bars are visited newest first
    const filled: Candle[] = [];
    let bucket = bucketStart(last, sec);
    while (filled.length < limit && bucket >= bucketStart(firstKey, sec)) {
      const lo = bucket;
      const hi = nextBucket(bucket, sec);
      let cur: Candle | null = null;
      while (k >= 0 && (keys[k] ?? 0) >= lo) {
        const t = keys[k] ?? 0;
        const b = s.bars.get(t);
        k--;
        if (!b || t >= hi) continue;
        cur = cur ? { t: lo, o: b.o, h: Math.max(cur.h, b.h), l: Math.min(cur.l, b.l), c: cur.c } : { t: lo, o: b.o, h: b.h, l: b.l, c: b.c };
      }
      filled.push(cur ?? { t: lo, o: Number.NaN, h: Number.NaN, l: Number.NaN, c: Number.NaN });
      bucket = prevBucket(bucket, sec);
    }
    filled.reverse();
    // a bucket without swaps: flat at the previous close (known from the bar before it)
    let prev: number | null = null;
    const head = filled[0];
    if (head && Number.isNaN(head.c)) prev = this.closeAt(id, head.t - 1);
    for (const c of filled) {
      if (Number.isNaN(c.c)) {
        if (prev === null) continue;
        out.push({ t: c.t, o: prev, h: prev, l: prev, c: prev });
      } else {
        out.push(c);
        prev = c.c;
      }
    }
    return out;
  }

  /** Change of `usd` (the current price) vs. the price 24 h, 7 d and 30 d before `now` (null where not covered). */
  changes(id: string, now: number, usd: number): Changes {
    const from = this.coveredFrom(id);
    const at = (ago: number): number | null => {
      const ts = now - ago;
      if (from === null || ts < from) return null;
      const c = this.closeAt(id, ts);
      return c && c > 0 ? usd / c - 1 : null;
    };
    return { d1: at(DAY), d7: at(7 * DAY), d30: at(30 * DAY) };
  }

  /** Bars kept per asset (for logs and tests). */
  size(id: string): number {
    return this.series.get(id)?.bars.size ?? 0;
  }

  toJSON(): HistoryJson {
    const assets: HistoryJson["assets"] = {};
    for (const [id, s] of this.series) {
      const keys = s.keys();
      const rows: number[][] = [[], [], [], [], [], [], []];
      let prevT = 0;
      for (const t of keys) {
        const b = s.bars.get(t);
        if (!b) continue;
        rows[0]?.push((t - prevT) / this.barSec);
        prevT = t;
        rows[1]?.push(round(b.o));
        rows[2]?.push(round(b.h));
        rows[3]?.push(round(b.l));
        rows[4]?.push(round(b.c));
        rows[5]?.push(b.f - t);
        rows[6]?.push(b.z - t);
      }
      assets[id] = { coveredFrom: s.coveredFrom === Number.POSITIVE_INFINITY ? null : s.coveredFrom, bars: rows };
    }
    return { v: 2, barSec: this.barSec, assets, scanned: Object.fromEntries(this.scanned) };
  }

  load(json: unknown): boolean {
    if (!isHistoryJson(json) || json.barSec !== this.barSec) return false;
    for (const [k, r] of Object.entries(json.scanned ?? {}))
      if (Array.isArray(r) && typeof r[0] === "number" && typeof r[1] === "number") this.scanned.set(k, [r[0], r[1]]);
    for (const [id, a] of Object.entries(json.assets)) {
      const s = this.get(id);
      if (typeof a.coveredFrom === "number") s.coveredFrom = Math.max(a.coveredFrom, this.since);
      const [dt, o, h, l, c, f, z] = a.bars;
      if (!dt || !o || !h || !l || !c || !f || !z) continue;
      let t = 0;
      for (let i = 0; i < dt.length; i++) {
        t += (dt[i] ?? 0) * this.barSec;
        if (t < this.since) continue;
        const bar = { o: o[i] ?? 0, h: h[i] ?? 0, l: l[i] ?? 0, c: c[i] ?? 0, f: t + (f[i] ?? 0), z: t + (z[i] ?? 0) };
        if (bar.c > 0) s.set(t, bar);
      }
    }
    return true;
  }

  saveFile(path: string): void {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.toJSON()));
    renameSync(tmp, path);
  }

  loadFile(path: string): boolean {
    try {
      return this.load(JSON.parse(readFileSync(path, "utf8")));
    } catch {
      return false;
    }
  }
}

interface HistoryJson {
  v: 2;
  barSec: number;
  /** Per asset: bar columns [Δt in bars, o, h, l, c, first-swap offset, last-swap offset]. */
  assets: Record<string, { coveredFrom: number | null; bars: number[][] }>;
  scanned?: Record<string, [number, number]>;
}

function isHistoryJson(x: unknown): x is HistoryJson {
  if (!x || typeof x !== "object") return false;
  const j = x as Partial<HistoryJson>;
  return j.v === 2 && typeof j.barSec === "number" && !!j.assets && typeof j.assets === "object";
}

/** 7 significant digits: plenty for a chart, a third of the file size. */
function round(x: number): number {
  return Number(x.toPrecision(7));
}

function nextBucket(t: number, sec: number): number {
  return t + sec;
}

function prevBucket(t: number, sec: number): number {
  return t - sec;
}
