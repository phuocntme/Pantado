/**
 * Instant swap estimate from the prices already on screen, shown while the on-chain quote (`/quote/swap`) loads:
 * the same path as the venues' quote (shared/math/swap.ts) — sell at oracle price − spread, router fee on the USDC
 * leg, buy at oracle price + spread — without inventory limits or price moves since the last push. Never signed:
 * the swap waits for the exact quote and its minimum.
 */
export interface Side {
  /** USD price; null = unknown */
  usd: number | null;
  /** venue spread in bps; 0 for USDC */
  spreadBps: number;
  isUsdc: boolean;
}

export function estimateSwap(amountIn: number, from: Side, to: Side, feeBps: number): { out: number; feeUsd: number } | null {
  if (!(amountIn > 0)) return null;
  const pIn = from.isUsdc ? 1 : from.usd;
  const pOut = to.isUsdc ? 1 : to.usd;
  if (!pIn || !pOut) return null;
  const usdc = from.isUsdc ? amountIn : amountIn * pIn * (1 - from.spreadBps / 10_000);
  const feeUsd = usdc * (feeBps / 10_000);
  const net = usdc - feeUsd;
  const out = to.isUsdc ? net : net / (pOut * (1 + to.spreadBps / 10_000));
  return { out, feeUsd };
}
