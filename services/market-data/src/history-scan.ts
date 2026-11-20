import type { PriceHistory } from "./history.js";
import type { PoolRef, RpcSwapReader, SwapRecord } from "./sources/rpc-swaps.js";

/** How one asset's history is read: its history pool, which side it is on, and what the pool quotes it in. */
export interface HistoryJob {
  id: string;
  pool: PoolRef;
  /** true when the asset is token1 of the pool (pool prices are token1 per token0). */
  invert: boolean;
  /** "usd" for USDC / USDG pools, else the asset id whose USD price multiplies (e.g. "wavax"). */
  quote: string;
}

export interface ScanOptions {
  /** First block to read (the block at `history.since`). */
  sinceBlock: bigint;
  /** Blocks per eth_getLogs. */
  logRange: bigint;
  maxAddresses: number;
  /** Swaps worth less than this in USD are skipped. */
  minSwapUsd: number;
  /** Chunks fetched at once. */
  parallel?: number;
  /** Most backward rounds (of `parallel` chunks) per call, so new blocks keep being followed during a long backfill. */
  backwardRounds?: number;
  stopped?: () => boolean;
  onProgress?: (p: { chain: string; firstBlock: bigint; head: bigint; sinceBlock: bigint }) => void;
}

/**
 * Reads every swap of the history pools of one chain into `history`: new blocks first (up to the head), then
 * back in time chunk by chunk until `sinceBlock`. Progress per pool lives in `history.scanned`, so a restart
 * resumes and a pool added later is read back on its own. Chunks are aligned to `logRange` so pools that
 * reach the same block are read together.
 */
export async function scanHistory(
  history: PriceHistory,
  chain: string,
  reader: RpcSwapReader,
  jobs: HistoryJob[],
  opts: ScanOptions,
): Promise<{ chunks: number; swaps: number; complete: boolean }> {
  const head = await reader.client.getBlockNumber();
  const R = opts.logRange;
  const key = (p: PoolRef): string => `${chain}:${p.address.toLowerCase()}`;
  const pools = [...new Map(jobs.map((j) => [j.pool.address.toLowerCase(), j.pool])).values()];
  const range = (p: PoolRef): [bigint, bigint] => {
    const r = history.scanned.get(key(p));
    return r ? [BigInt(r[0]), BigInt(r[1])] : [head + 1n, head]; // new pool: nothing read, start at the head
  };
  let chunks = 0;
  let swaps = 0;
  const jobOf = new Map(jobs.map((j) => [j.id, j]));
  /** `group` plus the pools of the assets its jobs are quoted in (read again: adding a swap twice changes nothing). */
  const withQuotes = (group: PoolRef[]): PoolRef[] => {
    const out = new Map(group.map((p) => [p.address.toLowerCase(), p]));
    for (let level = 0; level < 2; level++)
      for (const j of jobs)
        if (out.has(j.pool.address.toLowerCase()) && j.quote !== "usd") {
          const q = jobOf.get(j.quote);
          if (q) out.set(q.pool.address.toLowerCase(), q.pool);
        }
    return [...out.values()];
  };

  // 1) forward: every pool up to the head (pools at the same last block are read together)
  for (;;) {
    if (opts.stopped?.()) return { chunks, swaps, complete: false };
    const behind = pools.filter((p) => range(p)[1] < head && range(p)[0] <= range(p)[1]);
    if (!behind.length) break;
    const from = behind.map((p) => range(p)[1]).reduce((a, b) => (a < b ? a : b)) + 1n;
    const group = behind.filter((p) => range(p)[1] + 1n === from);
    const to = from + R - 1n < head ? from + R - 1n : head;
    const read = withQuotes(group);
    const recs = await reader.scan(read, from, to, opts.maxAddresses);
    swaps += apply(recs, read);
    for (const p of group) history.scanned.set(key(p), [Number(range(p)[0]), Number(to)]);
    chunks++;
  }
  // a new pool starts empty at the head
  for (const p of pools) if (!history.scanned.has(key(p))) history.scanned.set(key(p), [Number(head + 1n), Number(head)]);

  // 2) backward: the pools that reach furthest forward-in-time first, a few aligned chunks at a time
  const parallel = opts.parallel ?? 4;
  let rounds = 0;
  for (;;) {
    const open = pools.filter((p) => range(p)[0] > opts.sinceBlock);
    if (!open.length) return { chunks, swaps, complete: true };
    if (opts.stopped?.() || rounds++ >= (opts.backwardRounds ?? Number.POSITIVE_INFINITY)) return { chunks, swaps, complete: false };
    const top = open.map((p) => range(p)[0]).reduce((a, b) => (a > b ? a : b));
    const group = open.filter((p) => range(p)[0] === top);
    // next chunks below `top`, aligned to multiples of R, stopping at the next group's start
    const below = open.map((p) => range(p)[0]).filter((b) => b < top);
    const floor = [opts.sinceBlock, ...below].reduce((a, b) => (a > b ? a : b));
    const spans: [bigint, bigint][] = [];
    let hi = top - 1n;
    while (spans.length < parallel && hi >= floor) {
      const lo0 = (hi / R) * R;
      const lo = lo0 < floor ? floor : lo0;
      spans.push([lo, hi]);
      hi = lo - 1n;
    }
    if (!spans.length) return { chunks, swaps, complete: true };
    const pools2 = withQuotes(group);
    const read = await Promise.all(spans.map(([lo, hi2]) => reader.scan(pools2, lo, hi2, opts.maxAddresses)));
    for (let i = 0; i < spans.length; i++) {
      const span = spans[i];
      if (!span) continue;
      swaps += apply(read[i] ?? [], pools2);
      for (const p of group) history.scanned.set(key(p), [Number(span[0]), Number(range(p)[1])]);
      chunks++;
    }
    const first = spans[spans.length - 1]?.[0] ?? opts.sinceBlock;
    const ts = await reader.blockTs(first);
    for (const j of jobs) if (group.some((p) => p.address.toLowerCase() === j.pool.address.toLowerCase())) history.setCovered(j.id, ts);
    opts.onProgress?.({ chain, firstBlock: first, head, sinceBlock: opts.sinceBlock });
  }

  /** Swaps of one chunk into USD bars, in order, so WAVAX-quoted ones use the WAVAX price of that moment. */
  function apply(recs: SwapRecord[], group: PoolRef[]): number {
    const inGroup = new Set(group.map((p) => p.address.toLowerCase()));
    const byPool = new Map<string, HistoryJob[]>();
    for (const j of jobs) {
      const a = j.pool.address.toLowerCase();
      if (!inGroup.has(a)) continue;
      byPool.set(a, [...(byPool.get(a) ?? []), j]);
    }
    const lastUsd = new Map<string, number>();
    const firstUsd = new Map<string, number>();
    // pass 1: USD prices of USD-quoted assets in this chunk (the multipliers of the others)
    for (const r of recs)
      for (const j of byPool.get(r.pool) ?? [])
        if (j.quote === "usd" && !firstUsd.has(j.id)) {
          const usd = assetPrice(j, r);
          if (usd) firstUsd.set(j.id, usd);
        }
    let n = 0;
    for (const r of recs) {
      for (const j of byPool.get(r.pool) ?? []) {
        const px = assetPrice(j, r);
        if (!px) continue;
        const mult = j.quote === "usd" ? 1 : (lastUsd.get(j.quote) ?? history.closeAt(j.quote, r.ts) ?? firstUsd.get(j.quote) ?? null);
        if (mult === null || !(mult > 0)) continue;
        // size of the quote side in USD: dust trades print stray prices
        const quoteAmount = j.invert ? r.amount0 : r.amount1;
        if (quoteAmount * mult < opts.minSwapUsd) continue;
        const usd = px * mult;
        lastUsd.set(j.id, usd);
        history.addSwap(j.id, r.ts, usd);
        n++;
      }
    }
    return n;
  }
}

/** The asset's price in its quote from one swap (orientation-aware). */
function assetPrice(j: HistoryJob, r: SwapRecord): number | null {
  if (!(r.price > 0)) return null;
  const p = j.invert ? 1 / r.price : r.price;
  return Number.isFinite(p) && p > 0 ? p : null;
}
