import { z } from "zod";
import { decimalStringSchema } from "./common.js";

/**
 * Canonical prices served by market-data at `GET /internal/prices` (spec §8) and read by the price pusher.
 * One canonical price per asset; `crossCheck` is the independent source used for the deviation guard.
 */
export const priceQuoteSchema = z.object({
  usd: decimalStringSchema,
  ts: z.number().int().nonnegative(), // unix seconds of the observation
  source: z.string(),
});
export type PriceQuote = z.infer<typeof priceQuoteSchema>;

export const canonicalPriceSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+$/),
  canonical: priceQuoteSchema,
  crossCheck: priceQuoteSchema.nullable(),
});
export type CanonicalPrice = z.infer<typeof canonicalPriceSchema>;

export const internalPricesSchema = z.object({
  asOf: z.number().int(),
  prices: z.array(canonicalPriceSchema),
});
export type InternalPrices = z.infer<typeof internalPricesSchema>;

/** |a − b| / b in bps (b > 0), on decimal strings without float loss for typical magnitudes. */
export function deviationBps(a: string, b: string): number {
  const x = Number(a);
  const y = Number(b);
  if (!(y > 0)) return Number.POSITIVE_INFINITY;
  return (Math.abs(x - y) / y) * 10_000;
}
