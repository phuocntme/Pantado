import { z } from "zod";
import { bpsSchema, decimalStringSchema, uintStringSchema } from "./common.js";

/** `config/services.json` — service parameters (STRUCTURE.md, Config). */

const pos = z.number().int().positive();
const nonNeg = z.number().int().min(0);

export const servicesSchema = z.strictObject({
  indexer: z.strictObject({
    confirmations: nonNeg,
    acceptedOnly: z.literal(true),
    batchBlocks: pos,
  }),
  marketData: z.strictObject({
    pushIntervalSec: pos,
    moveBps: bpsSchema,
    deviationBps: bpsSchema,
    minLiquidityUsd: pos,
    stockTwapSec: pos,
    outlierSigma: z.number().positive(),
    outlierWindow: pos,
    redisTtlSec: pos,
    referenceMaxAgeSec: pos,
    /** Swap history kept per Avalanche pool for the token engine (seconds). */
    tokenWindowSec: pos,
    /**
     * Price history for candles and board changes: every swap of each asset's history pool since `since`
     * (UTC date), kept as `barSec` bars and aggregated to longer candles on read.
     */
    history: z.strictObject({
      since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      barSec: pos,
      /** Swaps worth less than this (quote side, USD) are ignored: dust trades print stray prices. */
      minSwapUsd: z.number().nonnegative(),
      /** New blocks are read this often once the history has caught up (seconds). */
      followSec: pos,
      saveEverySec: pos,
    }),
    /** Reference-market volume (board / asset page): swaps of the whitelisted mainnet pools over a rolling window. */
    volume: z.strictObject({
      windowSec: pos,
      /** a swap is valued on the first of these assets its pool holds (stable or deep quotes first) */
      quotePriority: z.array(z.string().min(1)),
    }),
  }),
  api: z.strictObject({
    cacheSec: pos,
    quoteMaxAgeBlocks: pos,
    rateLimitPerMin: pos,
    /** New wallets funded per client IP per hour (POST /fund). */
    fundPerIpPerHour: pos,
    externalAggregatorTimeoutMs: pos,
  }),
  presets: z.strictObject({
    marketCapCapPct: z.number().int().min(1).max(100),
    lowVolLookbackDays: pos,
  }),
  agent: z.strictObject({
    autoModelEnv: z.string(),
    deepModelEnv: z.string(),
    autoMaxSteps: pos,
    deepMaxSteps: pos,
    managerPollSec: pos,
    managerIndexes: z.array(z.string().regex(/^idx-[a-z0-9]{2,6}$/)),
    managerMinVersionIntervalSec: pos,
    managerMinChangePct: pos,
    /** asset id run_backtest compares against */
    benchmark: z.string().min(1),
  }),
  keepers: z.strictObject({
    pricePusher: z.strictObject({ tickSec: pos }),
    rebalanceTriggerPollSec: pos,
    auctionFiller: z.strictObject({
      pollSec: pos,
      minEdgeBps: z.number().int().min(-1000).max(1000),
      maxFillUsd: decimalStringSchema,
    }),
    autoFund: z.strictObject({
      usdc: decimalStringSchema,
      avax: decimalStringSchema,
      /** gas AVAX sent once to a Privy embedded wallet (its owner signed in with Google / X / email / passkey) */
      embeddedAvax: decimalStringSchema,
      /** where Privy publishes the keys its access tokens are signed with (`{appId}` is filled in) and their issuer */
      privyJwksUrl: z.string().url(),
      privyIssuer: z.string().min(1),
      oncePerWallet: z.boolean(),
    }),
  }),
  monitoring: z.strictObject({
    indexerLagAlertBlocks: pos,
    navToleranceWei: uintStringSchema,
    reserveRatioAlertBps: pos,
    keeperMinAvax: decimalStringSchema,
  }),
});
export type Services = z.infer<typeof servicesSchema>;
