import { amountFor, mulBps, mulBpsUp, mulDiv, mulWad, valueOf, WAD } from "./fixed.js";

/** Typed venue failure mirroring the contract custom error names. */
export class QuoteError extends Error {
  override readonly name = "QuoteError";
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface TokenMarket {
  kind: "token";
  decimals: number;
  spreadBps: number;
  priceWad: bigint;
  /** Venue balance of the output token (inventory check). */
  inventoryOut: bigint;
}

export interface StockMarket {
  kind: "stock";
  spreadBps: number;
  priceWad: bigint;
  buysPaused: boolean;
  sizeCapUsdWad: bigint;
  oiCapUsdWad: bigint;
  outstanding: bigint; // pToken totalSupply
  /** Σ outstanding × mid over every pToken of the venue (at last prices). */
  totalExposureUsdWad: bigint;
  reserve: bigint; // USDC base units
  reserveRatioBps: number;
}

/**
 * DexVenue (production): the output of a hop path through real pools is only known on-chain, so the quote service
 * asks `DexVenue.quote` for the exact amounts a plan needs and records them here, keyed by input amount
 * (decimal string); the pure previews then read them like any other venue's math.
 */
export interface DexMarket {
  kind: "dex";
  decimals: number;
  priceWad: bigint;
  /** USDC in → token out */
  buyOut: Record<string, bigint>;
  /** token in → USDC out */
  sellOut: Record<string, bigint>;
}

export type Market = TokenMarket | StockMarket | DexMarket;

function dexLookup(table: Record<string, bigint>, amountIn: bigint): bigint {
  const v = table[amountIn.toString()];
  if (v === undefined) throw new QuoteError("QuoteMissing", `no DEX quote for ${amountIn}`);
  return v;
}

/** DexVenue.quote for USDC → token (from the on-chain quote recorded for this amount). */
export const dexBuy = (m: DexMarket, usdcIn: bigint): bigint => dexLookup(m.buyOut, usdcIn);
/** DexVenue.quote for token → USDC. */
export const dexSell = (m: DexMarket, amountIn: bigint): bigint => dexLookup(m.sellOut, amountIn);

/** Venue output selling `amountIn` of an asset for USDC, whatever the venue. */
export function quoteSell(m: Market, amountIn: bigint, usdcDecimals: number, usdcInventory: bigint): bigint {
  if (m.kind === "dex") return dexSell(m, amountIn);
  return m.kind === "stock" ? stockSell(m, amountIn, usdcDecimals) : tokenSell(m, amountIn, usdcDecimals, usdcInventory);
}

/** TokenVenue.quote for USDC → token. */
export function tokenBuy(m: TokenMarket, usdcIn: bigint, usdcDecimals: number): bigint {
  const usd = valueOf(usdcIn, WAD, usdcDecimals);
  const net = mulBps(usd, 10_000 - m.spreadBps);
  const out = amountFor(net, m.priceWad, m.decimals);
  if (out > m.inventoryOut) throw new QuoteError("InsufficientInventory", "venue inventory too low");
  return out;
}

/** TokenVenue.quote for token → USDC (`inventoryOut` = venue USDC). */
export function tokenSell(m: TokenMarket, amountIn: bigint, usdcDecimals: number, usdcInventory: bigint): bigint {
  const usd = valueOf(amountIn, m.priceWad, m.decimals);
  const net = mulBps(usd, 10_000 - m.spreadBps);
  const out = amountFor(net, WAD, usdcDecimals);
  if (out > usdcInventory) throw new QuoteError("InsufficientInventory", "venue USDC too low");
  return out;
}

/** StockVenue._quoteBuy. */
export function stockBuy(m: StockMarket, usdcIn: bigint, usdcDecimals: number): bigint {
  if (m.buysPaused) throw new QuoteError("BuysPausedFor", "buys paused");
  const usd = valueOf(usdcIn, WAD, usdcDecimals);
  if (usd > m.sizeCapUsdWad) throw new QuoteError("SizeCapExceeded", "above max per trade");
  const exec = mulBpsUp(m.priceWad, 10_000 + m.spreadBps);
  const out = mulDiv(usd, WAD, exec);
  const newOi = mulWad(m.outstanding + out, m.priceWad);
  if (newOi > m.oiCapUsdWad) throw new QuoteError("OiCapExceeded", "open-interest cap");
  const exposure = m.totalExposureUsdWad + mulWad(out, m.priceWad);
  const reserveUsd = valueOf(m.reserve + usdcIn, WAD, usdcDecimals);
  if (mulDiv(exposure, BigInt(m.reserveRatioBps), 10_000n) > reserveUsd) throw new QuoteError("ReserveGuard", "reserve guard");
  return out;
}

/** StockVenue._quoteSell. */
export function stockSell(m: StockMarket, amountIn: bigint, usdcDecimals: number): bigint {
  const exec = mulBps(m.priceWad, 10_000 - m.spreadBps);
  const out = amountFor(mulWad(amountIn, exec), WAD, usdcDecimals);
  if (out > m.reserve) throw new QuoteError("InsufficientReserve", "reserve too low");
  return out;
}

export function quoteBuy(m: Market, usdcIn: bigint, usdcDecimals: number): bigint {
  if (m.kind === "dex") return dexBuy(m, usdcIn);
  return m.kind === "token" ? tokenBuy(m, usdcIn, usdcDecimals) : stockBuy(m, usdcIn, usdcDecimals);
}
