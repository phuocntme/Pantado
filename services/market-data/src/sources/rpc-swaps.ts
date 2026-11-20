import { createPublicClient, erc20Abi, fallback, http, parseAbiItem, type Address, type PublicClient } from "viem";
import type { Dex } from "@pantado/shared";
import type { Obs } from "../engine/stats.js";

const V3_SWAP = parseAbiItem(
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
);
const V2_RESERVES = [parseAbiItem("function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)")] as const;
const V2_SWAP = parseAbiItem(
  "event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)",
);

const LB_SWAP = parseAbiItem(
  "event Swap(address indexed sender, address indexed to, uint24 id, bytes32 amountsIn, bytes32 amountsOut, uint24 volatilityAccumulator, bytes32 totalFees, bytes32 protocolFees)",
);
const LB_ACTIVE = [parseAbiItem("function getActiveId() view returns (uint24)")] as const;
// first word of slot0 only: forks append or reorder the later fields
const V3_SLOT0 = [parseAbiItem("function slot0() view returns (uint160 sqrtPriceX96)")] as const;
const V3_LIQUIDITY = [parseAbiItem("function liquidity() view returns (uint128)")] as const;
const SWAP_EVENTS = [V2_SWAP, V3_SWAP, LB_SWAP] as const;
const LB_ID_ZERO = 2 ** 23;
const U128 = (1n << 128n) - 1n;

/** tokenY per tokenX (whole units) at a liquidity-book bin id. */
export function lbPrice(id: number, binStep: number, decX: number, decY: number): number {
  return (1 + binStep / 10_000) ** (id - LB_ID_ZERO) * 10 ** (decX - decY);
}

/** One decoded swap: `price` = token1 per token0, `amount0` / `amount1` = traded size in whole units. */
export interface SwapRecord {
  pool: string; // lower-case address
  block: bigint;
  logIndex: number;
  ts: number;
  price: number;
  amount0: number;
  amount1: number;
}

/** token1 per token0 (whole units) from a v3 sqrtPriceX96. */
export function v3Price(sqrtPriceX96: bigint, dec0: number, dec1: number): number {
  const q = Number(sqrtPriceX96) / 2 ** 96;
  return q * q * 10 ** (dec0 - dec1);
}

/** token1 per token0 (whole units) from a v2 swap's amounts; null if degenerate. */
export function v2Price(a0In: bigint, a1In: bigint, a0Out: bigint, a1Out: bigint, dec0: number, dec1: number): number | null {
  const d0 = Number(a0In > 0n ? a0In : a0Out) / 10 ** dec0;
  const d1 = Number(a1In > 0n ? a1In : a1Out) / 10 ** dec1;
  return d0 > 0 && d1 > 0 ? d1 / d0 : null;
}

/** Order two tokens the way v2/v3 pools do (lower address is token0). */
export function poolOrder(a: Address, b: Address): [Address, Address] {
  return BigInt(a) < BigInt(b) ? [a, b] : [b, a];
}

export interface PoolRef {
  address: Address;
  dex: Dex;
  /** Liquidity book only. */
  binStep?: number;
  token0: Address; // on-chain token addresses, pool order
  token1: Address;
  dec0: number;
  dec1: number;
}

export interface SwapReaderOptions {
  /** Largest block range per eth_getLogs call (public RPCs cap it). */
  maxLogRange?: bigint;
  /** Most log requests in flight at once (public RPCs rate-limit bursts). */
  maxInFlight?: number;
  /** Logs without `blockTimestamp`: interpolate swap times between blocks this far apart (default 5000). */
  timeAnchorBlocks?: number;
}

type AnyLog = { address: Address; blockNumber: bigint | null; logIndex: number | null; blockTimestamp?: bigint | null; eventName: string; args: Record<string, unknown> };

const big = (x: unknown): bigint | null => (typeof x === "bigint" ? x : null);
const abs = (x: bigint): bigint => (x < 0n ? -x : x);

/** Price and size of one swap log of pool `p` (any supported pool type); null if it is not a usable swap. */
export function decodeSwap(p: PoolRef, args: Record<string, unknown>): { price: number; amount0: number; amount1: number } | null {
  if (p.dex === "uniswap-v3") {
    const sp = big(args.sqrtPriceX96);
    const a0 = big(args.amount0);
    const a1 = big(args.amount1);
    if (sp === null) return null;
    return { price: v3Price(sp, p.dec0, p.dec1), amount0: Number(abs(a0 ?? 0n)) / 10 ** p.dec0, amount1: Number(abs(a1 ?? 0n)) / 10 ** p.dec1 };
  }
  if (p.dex === "uniswap-v2") {
    const [i0, i1, o0, o1] = [big(args.amount0In), big(args.amount1In), big(args.amount0Out), big(args.amount1Out)];
    if (i0 === null || i1 === null || o0 === null || o1 === null) return null;
    const price = v2Price(i0, i1, o0, o1, p.dec0, p.dec1);
    if (price === null) return null;
    return { price, amount0: Number(i0 > 0n ? i0 : o0) / 10 ** p.dec0, amount1: Number(i1 > 0n ? i1 : o1) / 10 ** p.dec1 };
  }
  const id = args.id;
  const ins = args.amountsIn;
  const outs = args.amountsOut;
  if (typeof id !== "number" || typeof ins !== "string" || typeof outs !== "string" || !p.binStep) return null;
  const a = BigInt(ins);
  const b = BigInt(outs);
  const x = (a & U128) + (b & U128);
  const y = (a >> 128n) + (b >> 128n);
  return { price: lbPrice(id, p.binStep, p.dec0, p.dec1), amount0: Number(x) / 10 ** p.dec0, amount1: Number(y) / 10 ** p.dec1 };
}

/** Small counting semaphore. */
class Limiter {
  private active = 0;
  private readonly queue: (() => void)[] = [];
  constructor(private readonly max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

const CHUNK_CONCURRENCY = 4;

interface PoolCursor {
  toBlock: bigint;
  obs: Obs[];
}

/**
 * Reads recent swaps of whitelisted pools straight from chain logs. Windows are in seconds, not blocks
 * (block times differ by chain); each pool keeps a cursor so a refresh only reads new blocks.
 */
export class RpcSwapReader {
  readonly client: PublicClient;
  private readonly blockTime = new Map<bigint, number>();
  private readonly cursors = new Map<string, PoolCursor>();
  private spb: { value: number; at: number } | null = null; // seconds per block, re-measured hourly
  private readonly maxLogRange: bigint;
  private readonly anchorBlocks: bigint;
  private readonly anchorClient: PublicClient;
  /** At most one batch of anchor reads in flight (public RPCs answer bursts with 429). */
  private readonly anchorLimiter = new Limiter(25);
  private readonly limiter: Limiter;

  constructor(rpc: string[] | PublicClient, opts: SwapReaderOptions = {}) {
    this.client = Array.isArray(rpc)
      ? (createPublicClient({ transport: fallback(rpc.map((u) => http(u, { timeout: 8_000, retryCount: 1 }))) }) as PublicClient)
      : rpc;
    // anchor block reads go out as JSON-RPC batches (a chunk needs dozens of them at once)
    this.anchorClient = Array.isArray(rpc)
      ? (createPublicClient({ transport: fallback(rpc.map((u) => http(u, { timeout: 20_000, retryCount: 4, retryDelay: 1_000, batch: { batchSize: 25, wait: 10 } }))) }) as PublicClient)
      : rpc;
    this.maxLogRange = opts.maxLogRange ?? 100n;
    this.anchorBlocks = BigInt(opts.timeAnchorBlocks ?? 5000);
    this.limiter = new Limiter(opts.maxInFlight ?? 4);
  }

  private async ts(block: bigint): Promise<number> {
    const hit = this.blockTime.get(block);
    if (hit !== undefined) return hit;
    const t = Number((await this.limiter.run(() => this.client.getBlock({ blockNumber: block }))).timestamp);
    if (this.blockTime.size > 20_000) this.blockTime.clear();
    this.blockTime.set(block, t);
    return t;
  }

  /** Average seconds per block over the last 10k blocks. */
  async secondsPerBlock(head: bigint): Promise<number> {
    if (this.spb && Date.now() - this.spb.at < 3_600_000) return this.spb.value;
    const span = head > 10_000n ? 10_000n : head;
    if (span === 0n) return 1;
    const [a, b] = await Promise.all([this.ts(head - span), this.ts(head)]);
    const value = Math.max((b - a) / Number(span), 0.01);
    this.spb = { value, at: Date.now() };
    return value;
  }

  /** Logs of one pool in [from, to], fetched in `maxLogRange` chunks, a few chunks at a time. */
  private async read(p: PoolRef, from: bigint, to: bigint, at: (bn: bigint) => number): Promise<Obs[]> {
    const ranges: [bigint, bigint][] = [];
    for (let s = from; s <= to; s += this.maxLogRange) ranges.push([s, s + this.maxLogRange - 1n < to ? s + this.maxLogRange - 1n : to]);
    const out: Obs[][] = [];
    for (let i = 0; i < ranges.length; i += CHUNK_CONCURRENCY) {
      out.push(...(await Promise.all(ranges.slice(i, i + CHUNK_CONCURRENCY).map(([s, e]) => this.readRange(p, s, e, at)))));
    }
    return out.flat();
  }

  private async readRange(p: PoolRef, s: bigint, e: bigint, at: (bn: bigint) => number): Promise<Obs[]> {
    const event = p.dex === "uniswap-v3" ? V3_SWAP : p.dex === "uniswap-v2" ? V2_SWAP : LB_SWAP;
    const logs = (await this.limiter.run(() => this.client.getLogs({ address: p.address, event, fromBlock: s, toBlock: e }))) as unknown as AnyLog[];
    const out: Obs[] = [];
    for (const l of logs) {
      if (l.blockNumber === null) continue;
      const d = decodeSwap(p, l.args);
      if (d && d.price > 0) out.push({ ts: at(l.blockNumber), price: d.price });
    }
    return out;
  }

  /**
   * Swaps of `p` in the last `windowSec` seconds, oldest first; `price` = token1 per token0. A swap's time is
   * interpolated from the head block's timestamp and the measured block time (no per-log block fetch).
   */
  async swaps(p: PoolRef, windowSec: number, head?: bigint): Promise<Obs[]> {
    const to = head ?? (await this.client.getBlockNumber());
    const nowTs = await this.ts(to);
    const spb = await this.secondsPerBlock(to);
    const at = (bn: bigint): number => Math.round(nowTs - Number(to - bn) * spb);
    const key = p.address.toLowerCase();
    const cur = this.cursors.get(key);
    let from: bigint;
    if (cur && cur.toBlock < to) from = cur.toBlock + 1n;
    else if (cur) from = to + 1n; // nothing new
    else {
      const back = BigInt(Math.ceil((windowSec * 1.1) / spb));
      from = to > back ? to - back : 0n;
    }
    const fresh = from <= to ? await this.read(p, from, to, at) : [];
    const obs = [...(cur?.obs ?? []), ...fresh].filter((o) => o.ts >= nowTs - windowSec);
    this.cursors.set(key, { toBlock: to, obs });
    return obs;
  }

  /**
   * `swaps()` for many pools at once: pools whose cursors stand at the same block are read together, one
   * eth_getLogs per `maxAddresses` pools and `maxLogRange` blocks (a refresh of 60 pools is a handful of calls).
   */
  async swapsMany(pools: PoolRef[], windowSec: number, head?: bigint, maxAddresses = 10): Promise<Map<string, Obs[]>> {
    const to = head ?? (await this.client.getBlockNumber());
    const nowTs = await this.ts(to);
    const spb = await this.secondsPerBlock(to);
    const at = (bn: bigint): number => Math.round(nowTs - Number(to - bn) * spb);
    const back = BigInt(Math.ceil((windowSec * 1.1) / spb));
    const fromOf = (p: PoolRef): bigint => {
      const cur = this.cursors.get(p.address.toLowerCase());
      return cur ? cur.toBlock + 1n : to > back ? to - back : 0n;
    };
    const groups = new Map<bigint, PoolRef[]>();
    for (const p of pools) {
      const f = fromOf(p);
      groups.set(f, [...(groups.get(f) ?? []), p]);
    }
    const fresh = new Map<string, Obs[]>();
    for (const [from, group] of groups) {
      if (from > to) continue;
      const byAddr = new Map(group.map((p) => [p.address.toLowerCase(), p]));
      const tasks: (() => Promise<AnyLog[]>)[] = [];
      for (let s = from; s <= to; s += this.maxLogRange) {
        const e = s + this.maxLogRange - 1n < to ? s + this.maxLogRange - 1n : to;
        for (let i = 0; i < group.length; i += maxAddresses) {
          const addrs = group.slice(i, i + maxAddresses).map((p) => p.address);
          tasks.push(() => this.limiter.run(() => this.client.getLogs({ address: addrs, events: SWAP_EVENTS, fromBlock: s, toBlock: e })) as Promise<unknown> as Promise<AnyLog[]>);
        }
      }
      const logs = (await Promise.all(tasks.map((t) => t()))).flat();
      logs.sort((a, b) => (a.blockNumber === b.blockNumber ? (a.logIndex ?? 0) - (b.logIndex ?? 0) : (a.blockNumber ?? 0n) < (b.blockNumber ?? 0n) ? -1 : 1));
      for (const l of logs) {
        const p = byAddr.get(l.address.toLowerCase());
        if (!p || l.blockNumber === null) continue;
        const d = decodeSwap(p, l.args);
        if (!d || !(d.price > 0) || !Number.isFinite(d.price)) continue;
        const k = p.address.toLowerCase();
        fresh.set(k, [...(fresh.get(k) ?? []), { ts: at(l.blockNumber), price: d.price }]);
      }
    }
    const out = new Map<string, Obs[]>();
    for (const p of pools) {
      const k = p.address.toLowerCase();
      const cur = this.cursors.get(k);
      const obs = [...(cur?.obs ?? []), ...(fresh.get(k) ?? [])].filter((o) => o.ts >= nowTs - windowSec);
      this.cursors.set(k, { toBlock: to, obs });
      out.set(k, obs);
    }
    return out;
  }

  /** Timestamp of `block`. */
  blockTs(block: bigint): Promise<number> {
    return this.ts(block);
  }

  /** Timestamp of the latest block (the "now" of this chain). */
  async headTs(head?: bigint): Promise<number> {
    return this.ts(head ?? (await this.client.getBlockNumber()));
  }

  /**
   * Latest block with timestamp ≤ `ts` (secant search on block timestamps; a handful of reads). With
   * `toleranceSec` > 0 the search stops once a block within that many seconds before `ts` is found.
   */
  async blockAt(ts: number, head?: bigint, toleranceSec = 0): Promise<bigint> {
    let hi = head ?? (await this.client.getBlockNumber());
    let tHi = await this.ts(hi);
    if (ts >= tHi) return hi;
    // start from the tightest bracket among blocks already read (consecutive lookups are close together)
    let lo = -1n;
    let tLo = 0;
    for (const [b, t] of this.blockTime) {
      if (b > hi) continue;
      if (t <= ts && (lo < 0n || b > lo)) [lo, tLo] = [b, t];
      else if (t > ts && b < hi) [hi, tHi] = [b, t];
    }
    if (lo < 0n) {
      const spb = await this.secondsPerBlock(hi);
      lo = hi - BigInt(Math.ceil((tHi - ts) / spb) * 2 + 10);
      if (lo < 0n) lo = 0n;
      tLo = await this.ts(lo);
      if (ts <= tLo) return lo;
    }
    if (ts - tLo <= toleranceSec) return lo;
    for (let i = 0; i < 40 && hi - lo > 1n && ts - tLo > toleranceSec; i++) {
      // interpolate, then keep the guess strictly inside (lo, hi)
      let mid = lo + BigInt(Math.floor((Number(hi - lo) * (ts - tLo)) / Math.max(tHi - tLo, 1)));
      if (mid <= lo) mid = lo + 1n;
      if (mid >= hi) mid = hi - 1n;
      const tMid = await this.ts(mid);
      if (tMid <= ts) [lo, tLo] = [mid, tMid];
      else [hi, tHi] = [mid, tMid];
      if (hi - lo > 2n && i % 2 === 1) {
        // bisect every other step so slow-converging interpolation still halves the range
        const b = (lo + hi) / 2n;
        const tb = await this.ts(b);
        if (tb <= ts) [lo, tLo] = [b, tb];
        else [hi, tHi] = [b, tb];
      }
    }
    return lo;
  }

  /**
   * Every swap of `pools` in blocks [from, to], oldest first, with its time: one eth_getLogs per
   * `maxAddresses` pools (public RPCs cap the address list). A range the RPC refuses (too many logs) is split.
   */
  async scan(pools: PoolRef[], from: bigint, to: bigint, maxAddresses = 10): Promise<SwapRecord[]> {
    const byAddr = new Map(pools.map((p) => [p.address.toLowerCase(), p]));
    const groups: Address[][] = [];
    for (let i = 0; i < pools.length; i += maxAddresses) groups.push(pools.slice(i, i + maxAddresses).map((p) => p.address));
    const logs = (await Promise.all(groups.map((g) => this.logsSplitting(g, from, to)))).flat();
    // logs without block times: read every anchor this chunk needs at once (one batched request)
    const need = new Set<bigint>();
    for (const l of logs)
      if (!l.blockTimestamp && l.blockNumber !== null) {
        const lo = (l.blockNumber / this.anchorBlocks) * this.anchorBlocks;
        need.add(lo).add(lo + this.anchorBlocks);
      }
    await Promise.all([...need].map((b) => this.anchorTs(b)));
    const out: SwapRecord[] = [];
    for (const l of logs) {
      const p = byAddr.get(l.address.toLowerCase());
      if (!p || l.blockNumber === null) continue;
      const d = decodeSwap(p, l.args);
      if (!d || !(d.price > 0) || !Number.isFinite(d.price)) continue;
      const ts = l.blockTimestamp ? Number(l.blockTimestamp) : await this.interpolatedTs(l.blockNumber);
      out.push({ pool: l.address.toLowerCase(), block: l.blockNumber, logIndex: l.logIndex ?? 0, ts, ...d });
    }
    return out.sort((a, b) => (a.block === b.block ? a.logIndex - b.logIndex : a.block < b.block ? -1 : 1));
  }

  private async logsSplitting(address: Address[], from: bigint, to: bigint): Promise<AnyLog[]> {
    try {
      return (await this.limiter.run(() => this.client.getLogs({ address, events: SWAP_EVENTS, fromBlock: from, toBlock: to }))) as unknown as AnyLog[];
    } catch (e) {
      if (to - from < 500n) throw e;
      const mid = (from + to) / 2n;
      const [a, b] = await Promise.all([this.logsSplitting(address, from, mid), this.logsSplitting(address, mid + 1n, to)]);
      return [...a, ...b];
    }
  }

  /** Time of `block` interpolated between the nearest anchor blocks (multiples of `timeAnchorBlocks`). */
  private async interpolatedTs(block: bigint): Promise<number> {
    const a = this.anchorBlocks;
    const lo = (block / a) * a;
    const hi = lo + a;
    const [tLo, tHi] = await Promise.all([this.anchorTs(lo), this.anchorTs(hi)]);
    if (tHi === null) return tLo ?? 0;
    return Math.round((tLo ?? 0) + ((tHi - (tLo ?? 0)) * Number(block - lo)) / Number(a));
  }

  private readonly anchors = new Map<bigint, Promise<number | null>>();

  /** Block timestamp of an anchor (null if the block does not exist yet). Cached for good: anchors never change. */
  private anchorTs(block: bigint): Promise<number | null> {
    let hit = this.anchors.get(block);
    if (!hit) {
      hit = this.anchorLimiter
        .run(() => this.anchorClient.getBlock({ blockNumber: block }))
        .then((b) => Number(b.timestamp))
        .catch((e: unknown) => {
          this.anchors.delete(block);
          if (e instanceof Error && /not found|could not be found/i.test(e.message)) return null;
          throw e;
        });
      this.anchors.set(block, hit);
      if (this.anchors.size > 50_000) this.anchors.delete(this.anchors.keys().next().value ?? 0n);
    }
    return hit;
  }

  /**
   * Spot price from pool state (token1 per token0), stamped with the head block's time: a v2 pool's reserves,
   * a liquidity book's active bin, or a v3 pool's current price while liquidity is active at its tick (a tick
   * with no liquidity can sit at a range edge long after the market moved). A quiet pool still quotes.
   */
  async v2Spot(p: PoolRef, head?: bigint): Promise<Obs | null> {
    if (p.dex === "uniswap-v3") {
      const [sp, liq] = await this.limiter.run(() =>
        Promise.all([
          this.client.readContract({ address: p.address, abi: V3_SLOT0, functionName: "slot0" }),
          this.client.readContract({ address: p.address, abi: V3_LIQUIDITY, functionName: "liquidity" }),
        ]),
      );
      if (liq === 0n || sp === 0n) return null;
      return { ts: await this.headTs(head), price: v3Price(sp, p.dec0, p.dec1) };
    }
    if (p.dex === "liquidity-book") {
      if (!p.binStep) return null;
      const id = await this.limiter.run(() => this.client.readContract({ address: p.address, abi: LB_ACTIVE, functionName: "getActiveId" }));
      return { ts: await this.headTs(head), price: lbPrice(id, p.binStep, p.dec0, p.dec1) };
    }
    if (p.dex !== "uniswap-v2") return null;
    const [r0, r1] = await this.limiter.run(() => this.client.readContract({ address: p.address, abi: V2_RESERVES, functionName: "getReserves" }));
    if (r0 === 0n || r1 === 0n) return null;
    const price = Number(r1) / 10 ** p.dec1 / (Number(r0) / 10 ** p.dec0);
    return { ts: await this.headTs(head), price };
  }

  private readonly balances = new Map<string, { at: number; b0: bigint; b1: bigint }>();

  /** Pool liquidity in USD from its token balances (cached `balanceTtlMs`) and known USD prices. */
  async liquidityUsd(p: PoolRef, usd0: number | null, usd1: number | null, balanceTtlMs = 60_000): Promise<number> {
    const key = p.address.toLowerCase();
    const hit = this.balances.get(key);
    const [b0, b1] = hit && Date.now() - hit.at < balanceTtlMs ? [hit.b0, hit.b1] : await this.readBalances(p);
    const v0 = usd0 === null ? 0 : (Number(b0) / 10 ** p.dec0) * usd0;
    const v1 = usd1 === null ? 0 : (Number(b1) / 10 ** p.dec1) * usd1;
    // one side unknown: count the known side twice (balanced pool assumption)
    return usd0 === null ? 2 * v1 : usd1 === null ? 2 * v0 : v0 + v1;
  }

  private async readBalances(p: PoolRef): Promise<[bigint, bigint]> {
    const [b0, b1] = await this.limiter.run(() => Promise.all([
      this.client.readContract({ address: p.token0, abi: erc20Abi, functionName: "balanceOf", args: [p.address] }),
      this.client.readContract({ address: p.token1, abi: erc20Abi, functionName: "balanceOf", args: [p.address] }),
    ]));
    this.balances.set(p.address.toLowerCase(), { at: Date.now(), b0, b1 });
    return [b0, b1];
  }
}
