import { index, onchainTable } from "ponder";

/**
 * Execution-chain tables (spec §9.2). Event-derived rows use id = `${chainId}:${block}:${txHash}:${logIndex}`
 * so re-processing is idempotent. Amounts are raw base units (bigint); prices and levels are USD 1e18.
 */

export const tokens = onchainTable("tokens", (t) => ({
  id: t.hex().primaryKey(), // address
  assetId: t.text().notNull(),
  kind: t.text().notNull(), // quote | token | stock
  decimals: t.integer().notNull(),
}));

export const prices = onchainTable("prices", (t) => ({
  id: t.hex().primaryKey(), // asset address
  price: t.bigint().notNull(),
  updatedAt: t.bigint().notNull(),
  block: t.bigint().notNull(),
}));

export const priceUpdates = onchainTable(
  "price_updates",
  (t) => ({
    id: t.text().primaryKey(),
    asset: t.hex().notNull(),
    price: t.bigint().notNull(),
    ts: t.bigint().notNull(),
    block: t.bigint().notNull(),
  }),
  (tb) => ({ assetTs: index().on(tb.asset, tb.ts) }),
);

export const indexes = onchainTable("indexes", (t) => ({
  id: t.hex().primaryKey(), // vault address
  ticker: t.text().notNull(),
  name: t.text().notNull(),
  description: t.text().notNull(),
  creator: t.hex().notNull(),
  isPublic: t.boolean().notNull(),
  mode: t.integer().notNull(),
  driftBps: t.integer().notNull(),
  pendingMode: t.integer(),
  pendingAt: t.bigint(),
  assets: t.json().$type<`0x${string}`[]>().notNull(),
  targetBps: t.json().$type<number[]>().notNull(),
  version: t.integer().notNull(),
  supply: t.bigint().notNull(),
  level: t.bigint().notNull(),
  value: t.bigint().notNull(),
  levelBlock: t.bigint().notNull(),
  volumeUsdc: t.bigint().notNull(),
  createdAt: t.bigint().notNull(),
  createdBlock: t.bigint().notNull(),
  createTx: t.hex().notNull(),
}));

/** Basket balance per (index, asset). */
export const indexAssets = onchainTable("index_assets", (t) => ({
  id: t.text().primaryKey(), // `${index}:${asset}`
  index: t.hex().notNull(),
  asset: t.hex().notNull(),
  position: t.integer().notNull(),
  decimals: t.integer().notNull(),
  balance: t.bigint().notNull(),
}));

/** Reverse map asset → indexes holding it (to refresh levels on price pushes). */
export const assetIndexes = onchainTable("asset_indexes", (t) => ({
  id: t.hex().primaryKey(), // asset
  indexes: t.json().$type<`0x${string}`[]>().notNull(),
}));

export const indexLevels = onchainTable(
  "index_levels",
  (t) => ({
    id: t.text().primaryKey(), // `${index}:${block}`
    index: t.hex().notNull(),
    block: t.bigint().notNull(),
    ts: t.bigint().notNull(),
    level: t.bigint().notNull(),
    value: t.bigint().notNull(),
    supply: t.bigint().notNull(),
  }),
  (tb) => ({ indexBlock: index().on(tb.index, tb.block) }),
);

export const indexEvents = onchainTable(
  "index_events",
  (t) => ({
    id: t.text().primaryKey(),
    index: t.hex().notNull(),
    kind: t.text().notNull(), // create | buy | sell | redeem | visibility | version | mode
    account: t.hex(),
    usdc: t.bigint(),
    units: t.bigint(),
    data: t.json(),
    ts: t.bigint().notNull(),
    block: t.bigint().notNull(),
    txHash: t.hex().notNull(),
  }),
  (tb) => ({ indexTs: index().on(tb.index, tb.ts), account: index().on(tb.account) }),
);

export const indexHolders = onchainTable(
  "index_holders",
  (t) => ({
    id: t.text().primaryKey(), // `${index}:${holder}`
    index: t.hex().notNull(),
    holder: t.hex().notNull(),
    units: t.bigint().notNull(),
  }),
  (tb) => ({ holder: index().on(tb.holder), byIndex: index().on(tb.index) }),
);

/** Buy lots for FIFO PnL (spec §9.4). Units received for USDC paid. */
export const walletLots = onchainTable(
  "wallet_lots",
  (t) => ({
    id: t.text().primaryKey(),
    wallet: t.hex().notNull(),
    index: t.hex().notNull(),
    units: t.bigint().notNull(),
    costUsdc: t.bigint().notNull(),
    ts: t.bigint().notNull(),
  }),
  (tb) => ({ walletIndex: index().on(tb.wallet, tb.index) }),
);

export const plans = onchainTable("plans", (t) => ({
  id: t.text().primaryKey(), // `${index}:${planId}`
  index: t.hex().notNull(),
  planId: t.integer().notNull(),
  status: t.text().notNull(),
  manual: t.boolean().notNull(),
  startAt: t.bigint().notNull(),
  startedAt: t.bigint(),
  endedAt: t.bigint(),
  maxDriftBps: t.bigint(),
  value: t.bigint(),
  lossBudget: t.bigint(),
  loss: t.bigint(),
  traded: t.bigint(),
}));

export const versions = onchainTable("versions", (t) => ({
  id: t.text().primaryKey(), // `${index}:${version}`
  index: t.hex().notNull(),
  version: t.integer().notNull(),
  targetBps: t.json().$type<number[]>().notNull(),
  reason: t.text().notNull(),
  startAt: t.bigint().notNull(),
  ts: t.bigint().notNull(),
}));

export const auctions = onchainTable("auctions", (t) => ({
  id: t.text().primaryKey(), // `${index}:${planId}:${auctionId}`
  index: t.hex().notNull(),
  planId: t.integer().notNull(),
  auctionId: t.integer().notNull(),
  sellAsset: t.hex().notNull(),
  buyAsset: t.hex().notNull(),
  lot: t.bigint().notNull(),
  filled: t.bigint().notNull(),
  startPrice: t.bigint().notNull(),
  floorPrice: t.bigint().notNull(),
  endAt: t.bigint().notNull(),
  ts: t.bigint().notNull(),
}));

export const fills = onchainTable("fills", (t) => ({
  id: t.text().primaryKey(),
  index: t.hex().notNull(),
  planId: t.integer().notNull(),
  auctionId: t.integer().notNull(),
  filler: t.hex().notNull(),
  amountOut: t.bigint().notNull(),
  amountIn: t.bigint().notNull(),
  price: t.bigint().notNull(),
  lossDelta: t.bigint().notNull(),
  ts: t.bigint().notNull(),
  txHash: t.hex().notNull(),
}));

/** Venue trades (stock mint/burn, token venue swaps, router swaps) for asset Transactions tabs. */
export const swaps = onchainTable(
  "swaps",
  (t) => ({
    id: t.text().primaryKey(),
    chainId: t.integer().notNull(),
    source: t.text().notNull(), // stock-venue | token-venue | router
    asset: t.hex().notNull(), // the non-USDC side (router: tokenOut unless USDC)
    side: t.text().notNull(), // buy | sell
    amount: t.bigint().notNull(), // asset base units
    usdc: t.bigint().notNull(),
    account: t.hex().notNull(),
    ts: t.bigint().notNull(),
    block: t.bigint().notNull(),
    txHash: t.hex().notNull(),
  }),
  (tb) => ({ assetTs: index().on(tb.asset, tb.ts) }),
);

export const transfers = onchainTable(
  "transfers",
  (t) => ({
    id: t.text().primaryKey(),
    token: t.hex().notNull(),
    from: t.hex().notNull(),
    to: t.hex().notNull(),
    amount: t.bigint().notNull(),
    ts: t.bigint().notNull(),
    block: t.bigint().notNull(),
  }),
  (tb) => ({ fromIdx: index().on(tb.from), toIdx: index().on(tb.to) }),
);

export const balances = onchainTable(
  "balances",
  (t) => ({
    id: t.text().primaryKey(), // `${token}:${holder}`
    token: t.hex().notNull(),
    holder: t.hex().notNull(),
    amount: t.bigint().notNull(),
  }),
  (tb) => ({ holder: index().on(tb.holder) }),
);

export const venueState = onchainTable("venue_state", (t) => ({
  id: t.hex().primaryKey(), // pToken
  outstanding: t.bigint().notNull(),
  buysPaused: t.boolean().notNull(),
  sizeCapUsd: t.bigint().notNull(),
  oiCapUsd: t.bigint().notNull(),
}));

export const creatorEarnings = onchainTable("creator_earnings", (t) => ({
  id: t.hex().primaryKey(), // creator
  accrued: t.bigint().notNull(),
  claimed: t.bigint().notNull(),
}));
