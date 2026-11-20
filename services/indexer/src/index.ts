import { ponder, type Context } from "ponder:registry";
import schema from "ponder:schema";
import { level as levelOf, loadAssets, loadDeployment, valueOf } from "@pantado/shared";
import { DEAD, eventId, lower, PLAN_STATUS, ZERO } from "./ids.js";

type Db = Context["db"];
type Hex = `0x${string}`;

const dep = loadDeployment();
const registry = loadAssets();
const addrToAsset = new Map(Object.entries(dep.assets).map(([id, a]) => [lower(a), id]));
const usdc = lower(dep.contracts.usdc);

// ---------------------------------------------------------------- level (same math as IndexLens)

/** Recompute and store the level of `index` at this block (the last write in a block wins). */
async function refreshLevel(db: Db, index: Hex, block: bigint, ts: bigint): Promise<void> {
  const ix = await db.find(schema.indexes, { id: index });
  if (!ix) return;
  const bals: bigint[] = [];
  const pxs: bigint[] = [];
  const decs: number[] = [];
  let value = 0n;
  for (const a of ix.assets) {
    const row = await db.find(schema.indexAssets, { id: `${index}:${a}` });
    const p = await db.find(schema.prices, { id: a });
    const b = row?.balance ?? 0n;
    const px = p?.price ?? 0n;
    const d = row?.decimals ?? 18;
    bals.push(b);
    pxs.push(px);
    decs.push(d);
    value += valueOf(b, px, d);
  }
  const lvl = levelOf(bals, pxs, decs, ix.supply);
  await db.update(schema.indexes, { id: index }).set({ level: lvl, value, levelBlock: block });
  await db
    .insert(schema.indexLevels)
    .values({ id: `${index}:${block}`, index, block, ts, level: lvl, value, supply: ix.supply })
    .onConflictDoUpdate({ level: lvl, value, supply: ix.supply, ts });
}

async function addBalance(db: Db, token: Hex, holder: Hex, delta: bigint): Promise<void> {
  await db
    .insert(schema.balances)
    .values({ id: `${token}:${holder}`, token, holder, amount: delta })
    .onConflictDoUpdate((r) => ({ amount: r.amount + delta }));
}

// ---------------------------------------------------------------- setup

ponder.on("IndexFactory:setup", async ({ context }) => {
  for (const a of registry) {
    const addr = dep.assets[a.id];
    if (!addr) continue;
    await context.db
      .insert(schema.tokens)
      .values({ id: lower(addr), assetId: a.id, kind: a.kind, decimals: a.kind === "stock" ? 18 : a.decimals })
      .onConflictDoNothing();
  }
  await context.db.insert(schema.prices).values({ id: usdc, price: 10n ** 18n, updatedAt: 0n, block: 0n }).onConflictDoNothing();
});

// ---------------------------------------------------------------- factory

ponder.on("IndexFactory:IndexCreated", async ({ event, context }) => {
  const { db } = context;
  const index = lower(event.args.index);
  const assets = event.args.assets.map(lower);
  await db.insert(schema.indexes).values({
    id: index,
    ticker: event.args.ticker,
    name: event.args.name,
    description: event.args.description,
    creator: lower(event.args.creator),
    isPublic: event.args.isPublic,
    mode: event.args.mode,
    driftBps: event.args.driftBps,
    assets,
    targetBps: [...event.args.weightsBps],
    version: 1,
    supply: 0n,
    level: 0n,
    value: 0n,
    levelBlock: event.block.number,
    volumeUsdc: 0n,
    createdAt: event.block.timestamp,
    createdBlock: event.block.number,
    createTx: event.transaction.hash,
  });
  for (const [i, a] of assets.entries()) {
    const tok = await db.find(schema.tokens, { id: a });
    await db.insert(schema.indexAssets).values({ id: `${index}:${a}`, index, asset: a, position: i, decimals: tok?.decimals ?? 18, balance: 0n });
    await db
      .insert(schema.assetIndexes)
      .values({ id: a, indexes: [index] })
      .onConflictDoUpdate((r) => ({ indexes: [...r.indexes, index] }));
  }
  await db.insert(schema.indexEvents).values({
    id: eventId(context.chain.id, event),
    index,
    kind: "create",
    account: lower(event.args.creator),
    usdc: event.args.creationFee,
    data: { mode: event.args.mode, driftBps: event.args.driftBps, isPublic: event.args.isPublic },
    ts: event.block.timestamp,
    block: event.block.number,
    txHash: event.transaction.hash,
  });
});

ponder.on("IndexFactory:VisibilityChanged", async ({ event, context }) => {
  const index = lower(event.args.index);
  await context.db.update(schema.indexes, { id: index }).set({ isPublic: event.args.isPublic });
  await context.db.insert(schema.indexEvents).values({
    id: eventId(context.chain.id, event),
    index,
    kind: "visibility",
    data: { isPublic: event.args.isPublic },
    ts: event.block.timestamp,
    block: event.block.number,
    txHash: event.transaction.hash,
  });
});

// ---------------------------------------------------------------- vault (index units)

ponder.on("IndexVault:Transfer", async ({ event, context }) => {
  const { db } = context;
  const index = lower(event.log.address);
  const from = lower(event.args.from);
  const to = lower(event.args.to);
  const v = event.args.value;
  if (from === ZERO || to === ZERO) {
    await db.update(schema.indexes, { id: index }).set((r) => ({ supply: from === ZERO ? r.supply + v : r.supply - v }));
  }
  for (const [holder, delta] of [
    [from, -v],
    [to, v],
  ] as const) {
    if (holder === ZERO) continue;
    await db
      .insert(schema.indexHolders)
      .values({ id: `${index}:${holder}`, index, holder, units: delta })
      .onConflictDoUpdate((r) => ({ units: r.units + delta }));
  }
  await refreshLevel(db, index, event.block.number, event.block.timestamp);
});

ponder.on("IndexVault:Bought", async ({ event, context }) => {
  const index = lower(event.log.address);
  const to = lower(event.args.to);
  await context.db.update(schema.indexes, { id: index }).set((r) => ({ volumeUsdc: r.volumeUsdc + event.args.usdcIn }));
  await context.db.insert(schema.indexEvents).values({
    id: eventId(context.chain.id, event),
    index,
    kind: "buy",
    account: to,
    usdc: event.args.usdcIn,
    units: event.args.units,
    data: { fee: event.args.fee.toString(), payer: lower(event.args.buyer) },
    ts: event.block.timestamp,
    block: event.block.number,
    txHash: event.transaction.hash,
  });
  if (to !== DEAD) {
    await context.db.insert(schema.walletLots).values({
      id: eventId(context.chain.id, event),
      wallet: to,
      index,
      units: event.args.units,
      costUsdc: event.args.usdcIn,
      ts: event.block.timestamp,
    });
  }
});

ponder.on("IndexVault:Sold", async ({ event, context }) => {
  const index = lower(event.log.address);
  await context.db.update(schema.indexes, { id: index }).set((r) => ({ volumeUsdc: r.volumeUsdc + event.args.gross }));
  await context.db.insert(schema.indexEvents).values({
    id: eventId(context.chain.id, event),
    index,
    kind: "sell",
    account: lower(event.args.seller),
    usdc: event.args.usdcOut,
    units: event.args.units,
    data: { fee: event.args.fee.toString(), gross: event.args.gross.toString(), to: lower(event.args.to) },
    ts: event.block.timestamp,
    block: event.block.number,
    txHash: event.transaction.hash,
  });
});

ponder.on("IndexVault:Redeemed", async ({ event, context }) => {
  const index = lower(event.log.address);
  await context.db.insert(schema.indexEvents).values({
    id: eventId(context.chain.id, event),
    index,
    kind: "redeem",
    account: lower(event.args.holder),
    units: event.args.units,
    data: { amounts: event.args.amounts.map(String), forfeited: event.args.forfeited.map(lower), to: lower(event.args.to) },
    ts: event.block.timestamp,
    block: event.block.number,
    txHash: event.transaction.hash,
  });
});

ponder.on("IndexVault:TargetWeightsSet", async ({ event, context }) => {
  await context.db.update(schema.indexes, { id: lower(event.log.address) }).set({ targetBps: [...event.args.weights] });
});

// ---------------------------------------------------------------- basket assets

ponder.on("Asset:Transfer", async ({ event, context }) => {
  const { db } = context;
  const token = lower(event.log.address);
  const from = lower(event.args.from);
  const to = lower(event.args.to);
  const v = event.args.value;
  await db.insert(schema.transfers).values({
    id: eventId(context.chain.id, event),
    token,
    from,
    to,
    amount: v,
    ts: event.block.timestamp,
    block: event.block.number,
  });
  if (from !== ZERO) await addBalance(db, token, from, -v);
  if (to !== ZERO) await addBalance(db, token, to, v);
  for (const [vault, delta] of [
    [from, -v],
    [to, v],
  ] as const) {
    const row = await db.find(schema.indexAssets, { id: `${vault}:${token}` });
    if (!row) continue;
    await db.update(schema.indexAssets, { id: row.id }).set({ balance: row.balance + delta });
    await refreshLevel(db, vault, event.block.number, event.block.timestamp);
  }
  if (token !== usdc && addrToAsset.has(token) && (from === ZERO || to === ZERO)) {
    // pToken mint / burn by the stock venue
    await db
      .insert(schema.venueState)
      .values({ id: token, outstanding: from === ZERO ? v : -v, buysPaused: false, sizeCapUsd: 0n, oiCapUsd: 0n })
      .onConflictDoUpdate((r) => ({ outstanding: r.outstanding + (from === ZERO ? v : -v) }));
  }
});

// ---------------------------------------------------------------- prices

ponder.on("PriceOracle:PricePushed", async ({ event, context }) => {
  const { db } = context;
  const asset = lower(event.args.asset);
  await db
    .insert(schema.prices)
    .values({ id: asset, price: event.args.price, updatedAt: event.args.timestamp, block: event.block.number })
    .onConflictDoUpdate({ price: event.args.price, updatedAt: event.args.timestamp, block: event.block.number });
  await db.insert(schema.priceUpdates).values({
    id: eventId(context.chain.id, event),
    asset,
    price: event.args.price,
    ts: event.args.timestamp,
    block: event.block.number,
  });
  const holders = await db.find(schema.assetIndexes, { id: asset });
  for (const ix of holders?.indexes ?? []) await refreshLevel(db, ix, event.block.number, event.block.timestamp);
});

// ---------------------------------------------------------------- rebalancer

ponder.on("Rebalancer:IndexRegistered", async ({ event, context }) => {
  // mode is also in IndexCreated; nothing extra to store
  void event;
  void context;
});

ponder.on("Rebalancer:ModeRequested", async ({ event, context }) => {
  const index = lower(event.args.index);
  await context.db.update(schema.indexes, { id: index }).set({ pendingMode: event.args.mode, pendingAt: event.args.effectiveAt });
  await context.db.insert(schema.indexEvents).values({
    id: eventId(context.chain.id, event),
    index,
    kind: "mode",
    data: { requested: event.args.mode, driftBps: event.args.driftBps, effectiveAt: event.args.effectiveAt.toString() },
    ts: event.block.timestamp,
    block: event.block.number,
    txHash: event.transaction.hash,
  });
});

ponder.on("Rebalancer:ModeChanged", async ({ event, context }) => {
  await context.db
    .update(schema.indexes, { id: lower(event.args.index) })
    .set({ mode: event.args.mode, driftBps: event.args.driftBps, pendingMode: null, pendingAt: null });
});

ponder.on("Rebalancer:VersionPublished", async ({ event, context }) => {
  const index = lower(event.args.index);
  await context.db.update(schema.indexes, { id: index }).set({ version: event.args.version });
  await context.db.insert(schema.versions).values({
    id: `${index}:${event.args.version}`,
    index,
    version: event.args.version,
    targetBps: [...event.args.weights],
    reason: event.args.reason,
    startAt: event.args.startAt,
    ts: event.block.timestamp,
  });
  await context.db.insert(schema.indexEvents).values({
    id: eventId(context.chain.id, event),
    index,
    kind: "version",
    data: { version: event.args.version, weights: [...event.args.weights], reason: event.args.reason },
    ts: event.block.timestamp,
    block: event.block.number,
    txHash: event.transaction.hash,
  });
});

ponder.on("Rebalancer:PlanScheduled", async ({ event, context }) => {
  const index = lower(event.args.index);
  await context.db.insert(schema.plans).values({
    id: `${index}:${event.args.planId}`,
    index,
    planId: event.args.planId,
    status: "Scheduled",
    manual: event.args.manual,
    startAt: event.args.startAt,
    maxDriftBps: event.args.maxDriftBps,
  });
});

ponder.on("Rebalancer:PlanStarted", async ({ event, context }) => {
  await context.db
    .update(schema.plans, { id: `${lower(event.args.index)}:${event.args.planId}` })
    .set({ status: "Active", startedAt: event.block.timestamp, value: event.args.value, lossBudget: event.args.lossBudget, loss: 0n, traded: 0n });
});

ponder.on("Rebalancer:PlanEnded", async ({ event, context }) => {
  await context.db
    .update(schema.plans, { id: `${lower(event.args.index)}:${event.args.planId}` })
    .set({ status: PLAN_STATUS[event.args.status] ?? "Unknown", endedAt: event.block.timestamp, loss: event.args.loss, traded: event.args.traded });
});

ponder.on("Rebalancer:AuctionOpened", async ({ event, context }) => {
  const index = lower(event.args.index);
  await context.db.insert(schema.auctions).values({
    id: `${index}:${event.args.planId}:${event.args.auctionId}`,
    index,
    planId: event.args.planId,
    auctionId: event.args.auctionId,
    sellAsset: lower(event.args.sellAsset),
    buyAsset: lower(event.args.buyAsset),
    lot: event.args.lot,
    filled: 0n,
    startPrice: event.args.startPrice,
    floorPrice: event.args.floorPrice,
    endAt: event.args.endAt,
    ts: event.block.timestamp,
  });
});

ponder.on("Rebalancer:AuctionFilled", async ({ event, context }) => {
  const index = lower(event.args.index);
  const a = event.args;
  await context.db.insert(schema.fills).values({
    id: eventId(context.chain.id, event),
    index,
    planId: a.planId,
    auctionId: a.auctionId,
    filler: lower(a.filler),
    amountOut: a.amountOut,
    amountIn: a.amountIn,
    price: a.price,
    lossDelta: a.lossDelta,
    ts: event.block.timestamp,
    txHash: event.transaction.hash,
  });
  await context.db.update(schema.auctions, { id: `${index}:${a.planId}:${a.auctionId}` }).set((r) => ({ filled: r.filled + a.amountOut }));
  await context.db
    .update(schema.plans, { id: `${index}:${a.planId}` })
    .set((r) => ({ loss: (r.loss ?? 0n) + a.lossDelta }));
});

// ---------------------------------------------------------------- venues + router

ponder.on("StockVenue:Minted", async ({ event, context }) => {
  await context.db.insert(schema.swaps).values({
    id: eventId(context.chain.id, event),
    chainId: context.chain.id,
    source: "stock-venue",
    asset: lower(event.args.pToken),
    side: "buy",
    amount: event.args.amount,
    usdc: event.args.usdcIn,
    account: lower(event.args.to),
    ts: event.block.timestamp,
    block: event.block.number,
    txHash: event.transaction.hash,
  });
});

ponder.on("StockVenue:Burned", async ({ event, context }) => {
  await context.db.insert(schema.swaps).values({
    id: eventId(context.chain.id, event),
    chainId: context.chain.id,
    source: "stock-venue",
    asset: lower(event.args.pToken),
    side: "sell",
    amount: event.args.amount,
    usdc: event.args.usdcOut,
    account: lower(event.args.to),
    ts: event.block.timestamp,
    block: event.block.number,
    txHash: event.transaction.hash,
  });
});

ponder.on("StockVenue:CapsSet", async ({ event, context }) => {
  const id = lower(event.args.pToken);
  await context.db
    .insert(schema.venueState)
    .values({ id, outstanding: 0n, buysPaused: false, sizeCapUsd: event.args.sizeCapUsd, oiCapUsd: event.args.oiCapUsd })
    .onConflictDoUpdate({ sizeCapUsd: event.args.sizeCapUsd, oiCapUsd: event.args.oiCapUsd });
});

ponder.on("StockVenue:BuysPaused", async ({ event, context }) => {
  const id = lower(event.args.pToken);
  await context.db
    .insert(schema.venueState)
    .values({ id, outstanding: 0n, buysPaused: event.args.paused, sizeCapUsd: 0n, oiCapUsd: 0n })
    .onConflictDoUpdate({ buysPaused: event.args.paused });
});

ponder.on("TokenVenue:Swapped", async ({ event, context }) => {
  const a = event.args;
  const buy = lower(a.tokenIn) === usdc;
  await context.db.insert(schema.swaps).values({
    id: eventId(context.chain.id, event),
    chainId: context.chain.id,
    source: "token-venue",
    asset: lower(buy ? a.tokenOut : a.tokenIn),
    side: buy ? "buy" : "sell",
    amount: buy ? a.amountOut : a.amountIn,
    usdc: buy ? a.amountIn : a.amountOut,
    account: lower(a.to),
    ts: event.block.timestamp,
    block: event.block.number,
    txHash: event.transaction.hash,
  });
});

ponder.on("FeeSplitter:FeeAccrued", async ({ event, context }) => {
  if (event.args.creatorAmount === 0n) return;
  const id = lower(event.args.creator);
  await context.db
    .insert(schema.creatorEarnings)
    .values({ id, accrued: event.args.creatorAmount, claimed: 0n })
    .onConflictDoUpdate((r) => ({ accrued: r.accrued + event.args.creatorAmount }));
});

ponder.on("FeeSplitter:Claimed", async ({ event, context }) => {
  const id = lower(event.args.creator);
  await context.db
    .insert(schema.creatorEarnings)
    .values({ id, accrued: 0n, claimed: event.args.amount })
    .onConflictDoUpdate((r) => ({ claimed: r.claimed + event.args.amount }));
});
