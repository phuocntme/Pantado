import { z } from "zod";
import {
  addressOrTodoSchema,
  addressSchema,
  bpsSchema,
  decimalStringSchema,
  TODO,
} from "./common.js";

/** spec §4 — `config/assets.json`. */

export const assetKindSchema = z.enum(["stock", "token", "quote"]);
export type AssetKind = z.infer<typeof assetKindSchema>;

export const venueNameSchema = z.enum(["stock-venue", "token-venue", "dex-venue"]);
export type VenueName = z.infer<typeof venueNameSchema>;

const tokenDisplaySchema = z.strictObject({
  chain: z.literal("avalanche"),
  address: addressOrTodoSchema,
  confirmed: z.boolean(),
  source: z.enum(["fixed", "price-engine"]),
});

const stockDisplaySchema = z.strictObject({
  chain: z.literal("robinhood"),
  token: addressOrTodoSchema,
  referencePool: addressOrTodoSchema,
  /** Pool type of the reference pool (V2); required before the pool is read. */
  dex: z.enum(["uniswap-v2", "uniswap-v3", "liquidity-book"]).optional(),
  confirmed: z.boolean(),
  source: z.literal("reference-market"),
  badge: z.string().min(1),
});

/** On a test network the asset is deployed by us ("deploy"). */
const fujiExecutionSchema = z.strictObject({
  address: z.union([z.literal("deploy"), addressSchema]),
  mock: z.boolean().optional(),
  pToken: z.string().regex(/^p[A-Z0-9]+$/).optional(),
  priceSource: z.enum(["push", "feed"]).optional(),
});

const mainnetExecutionSchema = z.strictObject({
  address: z.union([addressOrTodoSchema, z.null()]),
  confirmed: z.boolean().optional(),
});

const priceSchema = z
  .strictObject({
    canonical: z.enum(["fixed", "avalanche-price-engine", "robinhood-reference-twap60"]),
    fixedUsd: decimalStringSchema.optional(),
    crossCheck: z
      .string()
      .regex(/^(chainlink|stock-api):[A-Za-z0-9./]+$/)
      .nullable(),
    seedUsd: decimalStringSchema.optional(),
    maxAgeSec: z.number().int().min(0),
    bandMinUsd: decimalStringSchema,
    bandMaxUsd: decimalStringSchema,
  })
  .refine((p) => p.canonical !== "fixed" || p.fixedUsd !== undefined, {
    message: "fixed price needs fixedUsd",
  })
  .refine((p) => p.canonical === "fixed" || p.seedUsd !== undefined, {
    message: "pushed price needs seedUsd",
  })
  .refine((p) => Number(p.bandMinUsd) <= Number(p.bandMaxUsd), {
    message: "bandMinUsd must be <= bandMaxUsd",
  })
  .refine(
    (p) => {
      const v = Number(p.seedUsd ?? p.fixedUsd);
      return v >= Number(p.bandMinUsd) && v <= Number(p.bandMaxUsd);
    },
    { message: "seed / fixed price must lie inside the band" },
  );

const venueSchema = z.strictObject({
  contest: venueNameSchema.nullable(),
  production: venueNameSchema.nullable(),
});

const baseFields = {
  id: z.string().regex(/^[a-z0-9]+$/, "id: lowercase symbol without dots"),
  symbol: z.string().min(1).max(12),
  name: z.string().min(1),
  decimals: z.number().int().min(0).max(36),
  execution: z.strictObject({
    fuji: fujiExecutionSchema,
    avalanche: mainnetExecutionSchema,
  }),
  price: priceSchema,
  venue: venueSchema,
  logoURI: z.string().url().nullable(),
};

export const quoteAssetSchema = z.strictObject({
  ...baseFields,
  kind: z.literal("quote"),
  display: tokenDisplaySchema,
});

export const tokenAssetSchema = z.strictObject({
  ...baseFields,
  kind: z.literal("token"),
  display: tokenDisplaySchema,
  risk: z.strictObject({ spreadBps: bpsSchema }),
  circulatingSupply: decimalStringSchema.nullable(),
});

export const stockAssetSchema = z.strictObject({
  ...baseFields,
  kind: z.literal("stock"),
  tier: z.union([z.literal(1), z.literal(2)]),
  display: stockDisplaySchema,
  risk: z.strictObject({
    sizeCapUsd: z.number().int().positive(),
    oiCapUsd: z.number().int().positive(),
    spreadBps: bpsSchema,
  }),
});

export const assetSchema = z.discriminatedUnion("kind", [
  quoteAssetSchema,
  tokenAssetSchema,
  stockAssetSchema,
]);
export type Asset = z.infer<typeof assetSchema>;
export type StockAsset = z.infer<typeof stockAssetSchema>;
export type TokenAsset = z.infer<typeof tokenAssetSchema>;
export type QuoteAsset = z.infer<typeof quoteAssetSchema>;

/** Asset id = lowercase symbol with dots removed (STRUCTURE.md, Naming). */
export function expectedAssetId(symbol: string): string {
  return symbol.toLowerCase().replace(/\./g, "");
}

export const assetsFileSchema = z
  .strictObject({
    $comment: z.string().optional(),
    version: z.literal(1),
    assets: z.array(assetSchema).min(1),
  })
  .superRefine((file, ctx) => {
    const ids = new Set<string>();
    const symbols = new Set<string>();
    let quotes = 0;
    file.assets.forEach((a, i) => {
      const path = ["assets", i];
      if (ids.has(a.id)) ctx.addIssue({ code: "custom", path, message: `duplicate id ${a.id}` });
      ids.add(a.id);
      if (symbols.has(a.symbol))
        ctx.addIssue({ code: "custom", path, message: `duplicate symbol ${a.symbol}` });
      symbols.add(a.symbol);
      if (a.id !== expectedAssetId(a.symbol))
        ctx.addIssue({
          code: "custom",
          path,
          message: `id ${a.id} must be ${expectedAssetId(a.symbol)}`,
        });
      if (a.kind === "quote") quotes += 1;
      if (a.kind === "stock") {
        if (a.execution.fuji.pToken !== `p${a.symbol}`)
          ctx.addIssue({ code: "custom", path, message: `pToken must be p${a.symbol}` });
        if (a.venue.contest !== "stock-venue")
          ctx.addIssue({ code: "custom", path, message: "stocks use stock-venue in contest" });
      }
      if (a.kind === "token" && a.venue.contest !== "token-venue")
        ctx.addIssue({ code: "custom", path, message: "tokens use token-venue in contest" });
      if (a.kind === "quote" && (a.venue.contest !== null || a.venue.production !== null))
        ctx.addIssue({ code: "custom", path, message: "quote asset has no venue" });
      if (a.kind !== "stock" && a.display.confirmed && a.display.address === TODO)
        ctx.addIssue({ code: "custom", path, message: "confirmed address cannot be TODO" });
    });
    if (quotes !== 1)
      ctx.addIssue({ code: "custom", path: ["assets"], message: "exactly one quote asset" });
  });
export type AssetsFile = z.infer<typeof assetsFileSchema>;
