/** BigInt ports of FixedPoint.sol / OpenZeppelin Math.mulDiv. Same rounding as the contracts. */
export const WAD = 10n ** 18n;
export const BPS = 10_000n;

export function mulDiv(a: bigint, b: bigint, d: bigint): bigint {
  if (d === 0n) throw new RangeError("division by zero");
  return (a * b) / d;
}

export function mulDivUp(a: bigint, b: bigint, d: bigint): bigint {
  if (d === 0n) throw new RangeError("division by zero");
  const p = a * b;
  return p === 0n ? 0n : (p - 1n) / d + 1n;
}

export const mulWad = (a: bigint, b: bigint): bigint => mulDiv(a, b, WAD);
export const mulBps = (a: bigint, bps: bigint | number): bigint => mulDiv(a, BigInt(bps), BPS);
export const mulBpsUp = (a: bigint, bps: bigint | number): bigint => mulDivUp(a, BigInt(bps), BPS);

/** USD (1e18) value of `amount` base units at `priceWad`. */
export const valueOf = (amount: bigint, priceWad: bigint, decimals: number): bigint =>
  mulDiv(amount, priceWad, 10n ** BigInt(decimals));

/** Base units worth `usdWad` at `priceWad` (floor). */
export const amountFor = (usdWad: bigint, priceWad: bigint, decimals: number): bigint =>
  mulDiv(usdWad, 10n ** BigInt(decimals), priceWad);
