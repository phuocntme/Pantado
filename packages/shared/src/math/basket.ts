import { mulBps, mulDiv, valueOf, WAD } from "./fixed.js";
import { QuoteError, quoteBuy, quoteSell, type Market } from "./venue.js";

/** On-chain state of one index needed for quotes (IndexLens.previewBuy / previewSell). */
export interface BasketState {
  supply: bigint;
  tradeFeeBps: number;
  deadUnits: bigint;
  startLevelUsd: bigint;
  usdcDecimals: number;
  usdcVenueInventory: Record<string, bigint>; // venue address → its USDC balance (token venue sells)
  legs: {
    asset: string;
    decimals: number;
    balance: bigint;
    targetBps: number;
    fresh: boolean;
    /** AssetRegistry pause of new buys (checked by the vault). */
    registryBuysPaused?: boolean;
    venue: string;
    market: Market;
  }[];
}

export interface BuyQuote {
  units: bigint;
  fee: bigint;
  spends: bigint[];
  outs: bigint[];
}

function requireFresh(s: BasketState): void {
  for (const l of s.legs) if (!l.fresh) throw new QuoteError("PriceStale", `price of ${l.asset} is stale`);
}

/** Same math as IndexVault.firstBuy / buy and IndexLens.previewBuy. */
export function previewBuy(s: BasketState, usdcIn: bigint): BuyQuote {
  requireFresh(s);
  const n = s.legs.length;
  const fee = mulBps(usdcIn, s.tradeFeeBps);
  const net = usdcIn - fee;
  const spends: bigint[] = new Array<bigint>(n).fill(0n);
  const outs: bigint[] = new Array<bigint>(n).fill(0n);

  if (s.supply === 0n) {
    let spent = 0n;
    let v = 0n;
    s.legs.forEach((l, i) => {
      if (l.registryBuysPaused) throw new QuoteError("BuysPausedFor", l.asset);
      const spend = i === n - 1 ? net - spent : mulBps(net, l.targetBps);
      spent += spend;
      spends[i] = spend;
      const q = quoteBuy(l.market, spend, s.usdcDecimals);
      outs[i] = q;
      v += valueOf(q, l.market.priceWad, l.decimals);
    });
    const total = v / s.startLevelUsd;
    return { units: total > s.deadUnits ? total - s.deadUnits : 0n, fee, spends, outs };
  }

  const vals = s.legs.map((l) => valueOf(l.balance, l.market.priceWad, l.decimals));
  const value = vals.reduce((a, b) => a + b, 0n);
  if (value === 0n) throw new QuoteError("EmptyBasket", "empty basket");
  let last = 0;
  s.legs.forEach((l, i) => {
    if (l.balance !== 0n) last = i;
  });
  let units: bigint | null = null;
  let spent = 0n;
  s.legs.forEach((l, i) => {
    if (l.registryBuysPaused) throw new QuoteError("BuysPausedFor", l.asset);
    if (l.balance === 0n) return;
    const spend = i === last ? net - spent : mulDiv(net, vals[i] ?? 0n, value);
    spent += spend;
    spends[i] = spend;
    const q = spend === 0n ? 0n : quoteBuy(l.market, spend, s.usdcDecimals);
    outs[i] = q;
    const r = mulDiv(s.supply, q, l.balance);
    if (units === null || r < units) units = r;
  });
  return { units: units ?? 0n, fee, spends, outs };
}

/**
 * USDC each leg would spend on a buy of `usdcIn` (IndexVault.firstBuy / buy split), without asking any venue —
 * what a DEX quote must be fetched for before previewBuy.
 */
export function buySpends(s: BasketState, usdcIn: bigint): bigint[] {
  const n = s.legs.length;
  const net = usdcIn - mulBps(usdcIn, s.tradeFeeBps);
  const spends: bigint[] = new Array<bigint>(n).fill(0n);
  if (s.supply === 0n) {
    let spent = 0n;
    s.legs.forEach((l, i) => {
      const spend = i === n - 1 ? net - spent : mulBps(net, l.targetBps);
      spent += spend;
      spends[i] = spend;
    });
    return spends;
  }
  const vals = s.legs.map((l) => valueOf(l.balance, l.market.priceWad, l.decimals));
  const value = vals.reduce((a, b) => a + b, 0n);
  if (value === 0n) return spends;
  let last = 0;
  s.legs.forEach((l, i) => {
    if (l.balance !== 0n) last = i;
  });
  let spent = 0n;
  s.legs.forEach((l, i) => {
    if (l.balance === 0n) return;
    const spend = i === last ? net - spent : mulDiv(net, vals[i] ?? 0n, value);
    spent += spend;
    spends[i] = spend;
  });
  return spends;
}

/** Amount of each asset a sale of `units` sends to its venue (IndexVault.sell). */
export const sellAmounts = (s: BasketState, units: bigint): bigint[] => s.legs.map((l) => mulDiv(l.balance, units, s.supply));

/** Same math as IndexVault.sell / IndexLens.previewSell. */
export function previewSell(s: BasketState, units: bigint): { usdcOut: bigint; fee: bigint; gross: bigint } {
  requireFresh(s);
  let gross = 0n;
  for (const l of s.legs) {
    const out = mulDiv(l.balance, units, s.supply);
    if (out === 0n) continue;
    gross += quoteSell(l.market, out, s.usdcDecimals, s.usdcVenueInventory[l.venue] ?? 0n);
  }
  const fee = mulBps(gross, s.tradeFeeBps);
  return { usdcOut: gross - fee, fee, gross };
}

/** Redeem in-kind: never needs prices. */
export function previewRedeem(balances: bigint[], supply: bigint, units: bigint): bigint[] {
  return balances.map((b) => mulDiv(b, units, supply));
}

/** Level L = V / S (USD 1e18 per unit), same as IndexLens.level. */
export function level(balances: bigint[], pricesWad: bigint[], decimals: number[], supply: bigint): bigint {
  if (supply === 0n) return 0n;
  let v = 0n;
  balances.forEach((b, i) => {
    v += valueOf(b, pricesWad[i] ?? 0n, decimals[i] ?? 18);
  });
  return mulDiv(v, WAD, supply);
}

/** Relative drift |c − w| / w in bps (IndexLens.relativeDriftBps). */
export function relativeDriftBps(value: bigint, total: bigint, targetBps: number): bigint {
  const a = value * 10_000n;
  const b = BigInt(targetBps) * total;
  const d = a > b ? a - b : b - a;
  return mulDiv(d, 10_000n, b);
}
