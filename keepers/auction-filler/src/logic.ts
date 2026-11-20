export interface AuctionView {
  lot: bigint; // units of the sold asset i
  filled: bigint;
  price: bigint; // j per i, 1e18 (whole tokens)
  priceI: bigint; // USD 1e18
  priceJ: bigint; // USD 1e18
  decI: number;
  decJ: number;
}

export interface FillConfig {
  minEdgeBps: number;
  maxFillUsdE18: bigint;
}

/** Edge of filling at the auction price vs the oracle reference, in bps (positive = filler gains). */
export function edgeBps(a: AuctionView): number {
  const fair = (a.priceI * 10n ** 18n) / a.priceJ;
  if (fair === 0n) return Number.NEGATIVE_INFINITY;
  return Number(((fair - a.price) * 1_000_000n) / fair) / 100;
}

/** Bought-asset amount owed for `amountOut` of the sold asset, rounded up like the contract. */
export function payFor(a: AuctionView, amountOut: bigint): bigint {
  const num = amountOut * 10n ** BigInt(a.decJ) * a.price;
  const den = 10n ** BigInt(a.decI) * 10n ** 18n;
  return (num + den - 1n) / den;
}

/** How much to fill now, or null. Pure. */
export function fillDecision(a: AuctionView, cfg: FillConfig): { amountOut: bigint; pay: bigint; edgeBps: number } | null {
  const remaining = a.lot - a.filled;
  if (remaining <= 0n) return null;
  const e = edgeBps(a);
  if (e < cfg.minEdgeBps) return null;
  const maxByUsd = (cfg.maxFillUsdE18 * 10n ** BigInt(a.decI)) / a.priceI;
  const amountOut = remaining < maxByUsd ? remaining : maxByUsd;
  if (amountOut === 0n) return null;
  return { amountOut, pay: payFor(a, amountOut), edgeBps: e };
}
