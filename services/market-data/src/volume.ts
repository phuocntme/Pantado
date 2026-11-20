/**
 * Reference-market 24h volume (spec §9.4 board volume): USD value of every swap in the whitelisted mainnet pools
 * over a rolling window — Avalanche pools for tokens, the Robinhood Chain reference pools for stocks. Index volume
 * is Pantado's own (the API reads it from the indexer); this module never sees it.
 *
 * A swap counts toward both assets of its pool (an asset's volume is the volume of the pools it trades in), and once
 * toward the market total.
 */
import type { PoolRef, SwapRecord } from "./sources/rpc-swaps.js";

export interface VolumePool {
  ref: PoolRef;
  /** registry ids of token0 / token1; null for a side outside the registry (the stocks' reference quote) */
  ids: [string | null, string | null];
  /** USD per whole unit of a side that is not a registry asset (the reference quote: 1) */
  fixedUsd?: [number | null, number | null];
}

/**
 * USD value of one swap: the side with the best-known price — the first of `priority` present in the pool, else a
 * fixed-price side, else any priced side. Null when neither side is priced.
 */
export function swapUsd(r: SwapRecord, pool: VolumePool, price: (id: string) => number | null, priority: string[]): number | null {
  const sides: { amount: number; usd: number | null; rank: number }[] = [0, 1].map((i) => {
    const id = pool.ids[i as 0 | 1];
    const fixed = pool.fixedUsd?.[i as 0 | 1] ?? null;
    const usd = fixed ?? (id ? price(id) : null);
    const p = id ? priority.indexOf(id) : -1;
    return { amount: i === 0 ? r.amount0 : r.amount1, usd, rank: fixed !== null ? -0.5 : p >= 0 ? p - priority.length - 1 : 0 };
  });
  const usable = sides.filter((s) => s.usd !== null && s.usd > 0 && Number.isFinite(s.amount));
  if (!usable.length) return null;
  usable.sort((a, b) => a.rank - b.rank);
  const best = usable[0] as { amount: number; usd: number };
  return best.amount * best.usd;
}

/** Rolling-window swap volume per pool, summed per asset on read. */
export class Volume24h {
  private readonly events = new Map<string, { ts: number; usd: number }[]>();
  private readonly idsOf = new Map<string, [string | null, string | null]>();
  /** per chain: the window is complete from this time on (null until the first catch-up ends) */
  private readonly covered = new Map<string, number>();

  constructor(readonly windowSec = 86_400) {}

  register(pools: VolumePool[]): void {
    for (const p of pools) this.idsOf.set(p.ref.address.toLowerCase(), p.ids);
  }

  add(pool: string, ts: number, usd: number): void {
    const k = pool.toLowerCase();
    const xs = this.events.get(k) ?? [];
    xs.push({ ts, usd });
    this.events.set(k, xs);
  }

  setCovered(chain: string, fromTs: number): void {
    this.covered.set(chain, fromTs);
  }

  /** true once every chain that registered pools has read a full window */
  ready(chains: string[]): boolean {
    return chains.every((c) => this.covered.has(c));
  }

  prune(now: number): void {
    const cut = now - this.windowSec;
    for (const [k, xs] of this.events) {
      const kept = xs.filter((e) => e.ts > cut);
      if (kept.length) this.events.set(k, kept);
      else this.events.delete(k);
    }
  }

  /** Per-asset volume and the market total (each swap once) over (now − window, now]. */
  totals(now: number): { byAsset: Map<string, number>; total: number } {
    const cut = now - this.windowSec;
    const byAsset = new Map<string, number>();
    let total = 0;
    for (const [k, xs] of this.events) {
      let v = 0;
      for (const e of xs) if (e.ts > cut && e.ts <= now) v += e.usd;
      if (!v) continue;
      total += v;
      for (const id of this.idsOf.get(k) ?? []) if (id) byAsset.set(id, (byAsset.get(id) ?? 0) + v);
    }
    return { byAsset, total };
  }
}

export interface VolumeReader {
  scan(pools: PoolRef[], from: bigint, to: bigint, maxAddresses?: number): Promise<SwapRecord[]>;
}

/**
 * Read swaps of `pools` in [from, to] in `logRange` chunks into `vol`, all or nothing: a read that fails (or is
 * stopped) part-way adds no swap, so retrying the same range never counts one twice. Returns the swaps counted.
 */
export async function readVolume(
  vol: Volume24h,
  reader: VolumeReader,
  pools: VolumePool[],
  from: bigint,
  to: bigint,
  opts: { logRange: bigint; maxAddresses: number; price: (id: string) => number | null; priority: string[]; stopped?: () => boolean },
): Promise<number> {
  const byAddr = new Map(pools.map((p) => [p.ref.address.toLowerCase(), p]));
  const refs = pools.map((p) => p.ref);
  const found: { pool: string; ts: number; usd: number }[] = [];
  for (let lo = from; lo <= to; lo += opts.logRange) {
    if (opts.stopped?.()) return 0;
    const hi = lo + opts.logRange - 1n < to ? lo + opts.logRange - 1n : to;
    for (const r of await reader.scan(refs, lo, hi, opts.maxAddresses)) {
      const p = byAddr.get(r.pool);
      if (!p) continue;
      const usd = swapUsd(r, p, opts.price, opts.priority);
      if (usd !== null) found.push({ pool: r.pool, ts: r.ts, usd });
    }
  }
  for (const f of found) vol.add(f.pool, f.ts, f.usd);
  return found.length;
}
