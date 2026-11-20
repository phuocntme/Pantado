import { mulBps } from "./fixed.js";
import { quoteBuy, quoteSell, type Market } from "./venue.js";

/** SwapRouter.quote: fee in USDC on the USDC leg. `null` market = the token is USDC. */
export function quoteSwap(
  inMarket: Market | null,
  outMarket: Market | null,
  amountIn: bigint,
  feeBps: number,
  usdcDecimals: number,
  usdcInventoryIn = 0n,
): { amountOut: bigint; fee: bigint } {
  const usdc = inMarket === null ? amountIn : quoteSell(inMarket, amountIn, usdcDecimals, usdcInventoryIn);
  const fee = mulBps(usdc, feeBps);
  const net = usdc - fee;
  return { amountOut: outMarket === null ? net : quoteBuy(outMarket, net, usdcDecimals), fee };
}
