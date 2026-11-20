import { z } from "zod";
import { bpsSchema, uintStringSchema } from "./common.js";

/**
 * `contracts/config/params.json` — contract parameters (STRUCTURE.md, Contracts table).
 * All values are integers so Solidity scripts can read them with `vm.parseJsonUint`.
 * USDC amounts are whole USDC; scripts scale them by the quote token's decimals.
 */

const pos = z.number().int().positive();

export const paramsSchema = z
  .strictObject({
    $comment: z.string().optional(),
    treasury: z.union([z.literal("deployer"), z.string().regex(/^0x[0-9a-fA-F]{40}$/)]),
    factory: z.strictObject({
      creationFeeUsdc: pos,
      minFirstBuyUsdc: pos,
      minAssets: pos,
      maxAssets: pos,
      minWeightBps: bpsSchema,
      tickerMinLen: pos,
      tickerMaxLen: pos,
    }),
    vault: z.strictObject({
      tradeFeeBps: bpsSchema,
      deadUnitsWei: uintStringSchema,
      startLevelUsd: pos,
    }),
    fees: z.strictObject({
      protocolBps: bpsSchema,
      creatorBps: bpsSchema,
    }),
    rebalancer: z.strictObject({
      noticeSec: pos,
      modeChangeDelaySec: pos,
      driftBps: pos,
      driftMinBps: pos,
      driftMaxBps: pos,
      intervalSec: pos,
      dailyCapBps: bpsSchema,
      lossBudgetBps: bpsSchema,
      maxDurationSec: pos,
      premiumBps: bpsSchema,
      floorBps: bpsSchema,
      auctionSec: pos,
      lotCapBps: bpsSchema,
    }),
    stockVenue: z.strictObject({
      spreadBps: bpsSchema,
      reserveRatioBps: pos,
      seedReserveUsdc: pos,
    }),
    tokenVenue: z.strictObject({
      seedInventoryUsd: pos,
      seedUsdc: pos,
    }),
    swapRouter: z.strictObject({
      swapFeeBps: bpsSchema,
    }),
    demoOverrides: z.strictObject({
      noticeSec: pos,
      modeChangeDelaySec: pos,
    }),
  })
  .superRefine((p, ctx) => {
    const issue = (message: string): void => ctx.addIssue({ code: "custom", message });
    if (p.fees.protocolBps + p.fees.creatorBps !== p.vault.tradeFeeBps)
      issue("fees.protocolBps + fees.creatorBps must equal vault.tradeFeeBps");
    if (p.factory.minAssets > p.factory.maxAssets) issue("minAssets > maxAssets");
    if (p.factory.minWeightBps * p.factory.maxAssets > 10_000)
      issue("minWeightBps × maxAssets exceeds 10000");
    if (p.factory.tickerMinLen > p.factory.tickerMaxLen) issue("tickerMinLen > tickerMaxLen");
    const r = p.rebalancer;
    if (r.driftBps < r.driftMinBps || r.driftBps > r.driftMaxBps)
      issue("rebalancer.driftBps outside [driftMinBps, driftMaxBps]");
    if (p.stockVenue.reserveRatioBps < 10_000) issue("reserveRatioBps must be >= 10000");
  });
export type Params = z.infer<typeof paramsSchema>;
