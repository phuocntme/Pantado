import { z } from "zod";
import { addressSchema, bpsSchema, chainIdSchema, uintStringSchema } from "./common.js";
import { assetKindSchema, venueNameSchema } from "./assets.js";
import { executionNetworkSchema } from "./network.js";

/**
 * Schemas for files written by `scripts/gen-config.ts`. Never edit those files by hand.
 *
 * Contract assets file: keys of each asset are in alphabetical order so Foundry's
 * `vm.parseJson` can decode the array into a Solidity struct directly.
 */

export const contractAssetSchema = z.strictObject({
  addr: z.union([z.literal("deploy"), z.literal("TODO"), addressSchema]),
  bandMaxE18: uintStringSchema,
  bandMinE18: uintStringSchema,
  decimals: z.number().int().min(0).max(36),
  id: z.string(),
  kind: assetKindSchema,
  maxAgeSec: z.number().int().min(0),
  mock: z.boolean(),
  name: z.string(),
  oiCapUsd: z.number().int().min(0),
  pTokenName: z.string(),
  pTokenSymbol: z.string(),
  priceE18: uintStringSchema,
  sizeCapUsd: z.number().int().min(0),
  spreadBps: bpsSchema,
  symbol: z.string(),
  tier: z.number().int().min(0).max(2),
  venue: z.union([venueNameSchema, z.literal("none")]),
});
export type ContractAsset = z.infer<typeof contractAssetSchema>;

export const contractAssetsFileSchema = z.strictObject({
  $comment: z.string(),
  network: executionNetworkSchema,
  chainId: z.number().int().positive(),
  profile: z.string(),
  quote: z.string(),
  assets: z.array(contractAssetSchema).min(1),
});
export type ContractAssetsFile = z.infer<typeof contractAssetsFileSchema>;

export const indexerWhitelistsSchema = z.strictObject({
  $comment: z.string(),
  avalanche: z.strictObject({
    chainId: chainIdSchema,
    tokens: z.array(
      z.strictObject({
        id: z.string(),
        symbol: z.string(),
        address: addressSchema,
        decimals: z.number().int(),
      }),
    ),
    pending: z.array(z.string()),
  }),
  robinhood: z.strictObject({
    chainId: chainIdSchema,
    stocks: z.array(
      z.strictObject({
        id: z.string(),
        symbol: z.string(),
        token: addressSchema,
        referencePool: addressSchema,
      }),
    ),
    pending: z.array(z.string()),
  }),
  execution: z.array(
    z.strictObject({ id: z.string(), symbol: z.string(), kind: assetKindSchema }),
  ),
});
export type IndexerWhitelists = z.infer<typeof indexerWhitelistsSchema>;

export const appAssetSchema = z.strictObject({
  id: z.string(),
  symbol: z.string(),
  displaySymbol: z.string(),
  name: z.string(),
  kind: assetKindSchema,
  tier: z.number().int().nullable(),
  decimals: z.number().int(),
  displayChain: z.enum(["avalanche", "robinhood"]),
  displayAddress: addressSchema.nullable(),
  badge: z.string().nullable(),
  logoURI: z.string().nullable(),
  color: z.string().regex(/^#[0-9A-F]{6}$/),
  sizeCapUsd: z.number().int().nullable(),
  venue: z.strictObject({
    contest: venueNameSchema.nullable(),
    production: venueNameSchema.nullable(),
  }),
});
export type AppAsset = z.infer<typeof appAssetSchema>;

export const appAssetsFileSchema = z.strictObject({
  $comment: z.string(),
  assets: z.array(appAssetSchema).min(1),
});
export type AppAssetsFile = z.infer<typeof appAssetsFileSchema>;
