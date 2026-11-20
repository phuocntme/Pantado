import { z } from "zod";
import { addressSchema, chainIdSchema, profileNameSchema, urlOrTodoSchema } from "./common.js";
import { venueNameSchema } from "./assets.js";

/** spec §3 — `config/networks/<profile>.json`. */

const envNameSchema = z.string().regex(/^[A-Z][A-Z0-9_]*$/);
const wsUrlSchema = z.union([z.string().regex(/^wss?:\/\/.+/), z.literal("TODO")]);

/** Pool math: constant product (v2 and its forks), concentrated liquidity (v3 and its forks), or price bins (liquidity book). */
export const dexSchema = z.enum(["uniswap-v2", "uniswap-v3", "liquidity-book"]);
export type Dex = z.infer<typeof dexSchema>;

const dataChainSchema = z.strictObject({
  chainId: chainIdSchema,
  rpc: z.array(urlOrTodoSchema).min(1),
  rpcEnv: z.array(envNameSchema),
  ws: z.array(wsUrlSchema),
  backfillDays: z.number().int().positive(),
  explorer: urlOrTodoSchema.optional(),
  role: z.string().optional(),
  /** Largest eth_getLogs block range the RPCs accept (public endpoints cap it). */
  maxLogRange: z.number().int().positive().optional(),
  /** Most addresses per eth_getLogs filter on this chain's RPCs (default 10). */
  maxLogAddresses: z.number().int().positive().optional(),
  /** Block range per eth_getLogs when scanning price history (whole swap history since `history.since`). */
  historyLogRange: z.number().int().positive().optional(),
  /** History chunks read at once (default 4; 1 for RPCs with tight rate limits). */
  historyParallel: z.number().int().positive().optional(),
  /**
   * RPC logs without `blockTimestamp`: swap times are interpolated between block timestamps read every this
   * many blocks (absent = the RPC returns block timestamps with each log).
   */
  timeAnchorBlocks: z.number().int().positive().optional(),
  /** Quote token of the stock reference pools (Robinhood Chain); pool orientation follows address order. */
  referenceQuote: z
    .strictObject({ symbol: z.string().min(1), address: addressSchema, decimals: z.number().int().min(0).max(36), confirmed: z.boolean() })
    .optional(),
  /** Chainlink feeds used as cross-checks (spec §8). Unconfirmed feeds are never read. */
  chainlink: z
    .record(
      z.string().regex(/^[A-Z0-9]+\/USD$/),
      z.strictObject({ address: addressSchema, decimals: z.number().int(), confirmed: z.boolean() }),
    )
    .optional(),
  /** Whitelisted DEX pools for the token price engine (spec §9.3). Unconfirmed pools are never read. */
  pools: z
    .array(
      z.strictObject({
        address: addressSchema,
        dex: dexSchema,
        /** v2/v3: token0/token1 by address order; liquidity book: tokenX/tokenY as the pair reports them. */
        token0: z.string().regex(/^[a-z0-9]+$/),
        token1: z.string().regex(/^[a-z0-9]+$/),
        /** Liquidity book only: bin step in basis points (price of bin id = (1 + binStep/10 000)^(id − 2^23)). */
        binStep: z.number().int().positive().optional(),
        /** This pool is the price-history pool of that asset (default: the asset's first pool vs USDC, then WAVAX, then any). */
        history: z.string().regex(/^[a-z0-9]+$/).optional(),
        /**
         * uniswap-v2 pools used by the mainnet DEX venue's routes: the pair's math. `univ2` = constant product with
         * `feeBps` (read from the factory's pairs, checked on a mainnet fork); `solidly` = the pair's own getAmountOut.
         */
        amm: z.enum(["univ2", "solidly"]).optional(),
        feeBps: z.number().int().positive().max(1000).optional(),
        confirmed: z.boolean(),
      }),
    )
    .optional(),
});
export type DataChain = z.infer<typeof dataChainSchema>;

export const executionNetworkSchema = z.enum(["fuji", "avalanche", "anvil"]);
export type ExecutionNetwork = z.infer<typeof executionNetworkSchema>;

export const profileSchema = z.strictObject({
  $comment: z.string().optional(),
  profile: profileNameSchema,
  data: z.strictObject({
    avalanche: dataChainSchema,
    robinhood: dataChainSchema,
  }),
  execution: z.strictObject({
    network: executionNetworkSchema,
    chainId: z.number().int().positive(),
    rpc: z.array(z.string().url()).min(1),
    rpcEnv: z.array(envNameSchema),
    ws: z.array(wsUrlSchema),
    deployments: z.string().regex(/^contracts\/deployments\/[a-z0-9-]+\.json$/),
    quote: z.string().regex(/^[a-z0-9]+$/),
    explorer: z.string().url(),
    /** Largest eth_getLogs block range the execution RPCs accept (the public Fuji RPC: 100); unset = the indexer's default. */
    maxLogRange: z.number().int().positive().optional(),
    /** The indexer's request rate on the execution RPCs (the public Fuji RPC answers bursts with 429); unset = its default. */
    maxRequestsPerSecond: z.number().int().positive().optional(),
    /**
     * Work split across free RPCs. `indexer`: endpoints that take an eth_getLogs over many addresses, load-balanced,
     * each at its own request rate. `reads`: endpoints for the API's and keepers' reads, tried in order before `rpc`.
     * `rpc` stays the list transactions go out through. Unset = every role uses `rpc`.
     */
    rpcPools: z
      .strictObject({
        indexer: z.array(z.strictObject({ url: z.string().url(), rps: z.number().int().positive() })).min(1),
        reads: z.array(z.string().url()).min(1),
      })
      .optional(),
    /**
     * DEX venue routes (production): asset id → pool addresses from the asset to the quote token, each a confirmed
     * `data.avalanche.pools` entry (uniswap-v2 with `amm`, or liquidity-book). Assets without a route are not listed.
     */
    dexRoutes: z.record(z.string().regex(/^[a-z0-9]+$/), z.array(addressSchema).min(1).max(3)).optional(),
  }),
  venues: z.strictObject({
    stock: venueNameSchema,
    token: venueNameSchema,
  }),
  priceSource: z.strictObject({
    pusher: z.literal("market-data"),
    stockReference: z.literal("robinhood"),
    stockCrossCheck: z.literal("stock-api"),
  }),
  flags: z.strictObject({
    showFujiBadge: z.boolean(),
    showReferenceBadge: z.boolean(),
    gasSponsorship: z.boolean(),
    usBlock: z.boolean(),
    externalAggregators: z.boolean(),
    agentManager: z.boolean(),
    autoFundOnSignIn: z.boolean(),
  }),
});
export type Profile = z.infer<typeof profileSchema>;
