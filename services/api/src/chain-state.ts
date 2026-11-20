import { erc20Abi, type Address, type PublicClient } from "viem";
import { assetRegistryAbi, dexVenueAbi, indexVaultAbi, priceOracleAbi, stockVenueAbi, tokenVenueAbi } from "@pantado/sdk";
import type { BasketState, Deployment, Market } from "@pantado/shared";

export interface LegState {
  asset: Address;
  kind: "token" | "stock";
  venue: Address;
  decimals: number;
  priceWad: bigint;
  updatedAt: bigint;
  fresh: boolean;
  registryBuysPaused: boolean;
  market: Market;
}

/** Everything a quote needs about one asset, read at `blockNumber`. */
export async function loadLeg(client: PublicClient, dep: Deployment, asset: Address, blockNumber: bigint): Promise<LegState> {
  const c = dep.contracts;
  const at = { blockNumber };
  const [info, latest, fresh] = await Promise.all([
    client.readContract({ address: c.assetRegistry, abi: assetRegistryAbi, functionName: "info", args: [asset], ...at }),
    client.readContract({ address: c.oracle, abi: priceOracleAbi, functionName: "latest", args: [asset], ...at }),
    client.readContract({ address: c.oracle, abi: priceOracleAbi, functionName: "isFresh", args: [asset], ...at }),
  ]);
  const [priceWad, updatedAt] = latest;
  const base = { asset, venue: info.venue, decimals: info.decimals, priceWad, updatedAt, fresh, registryBuysPaused: info.buysPaused };
  if (info.kind === 2) {
    const [m, outstanding, exposure, reserve, ratio] = await Promise.all([
      client.readContract({ address: c.stockVenue, abi: stockVenueAbi, functionName: "markets", args: [asset], ...at }),
      client.readContract({ address: asset, abi: erc20Abi, functionName: "totalSupply", ...at }),
      client.readContract({ address: c.stockVenue, abi: stockVenueAbi, functionName: "totalExposureUsd", ...at }),
      client.readContract({ address: c.stockVenue, abi: stockVenueAbi, functionName: "reserve", ...at }),
      client.readContract({ address: c.stockVenue, abi: stockVenueAbi, functionName: "reserveRatioBps", ...at }),
    ]);
    const [, buysPaused, spreadBps, sizeCapUsd, oiCapUsd] = m;
    return {
      ...base,
      kind: "stock",
      market: {
        kind: "stock",
        spreadBps,
        priceWad,
        buysPaused,
        sizeCapUsdWad: sizeCapUsd,
        oiCapUsdWad: oiCapUsd,
        outstanding,
        totalExposureUsdWad: exposure,
        reserve,
        reserveRatioBps: ratio,
      },
    };
  }
  // mainnet: tokens trade through real pools; amounts are quoted on-chain per plan (quoteDexLegs)
  if (c.dexVenue && info.venue.toLowerCase() === c.dexVenue.toLowerCase())
    return { ...base, kind: "token", market: { kind: "dex", decimals: info.decimals, priceWad, buyOut: {}, sellOut: {} } };
  const tv = c.tokenVenue;
  if (!tv) throw new Error(`no token venue for ${asset}`);
  const [m, inventory] = await Promise.all([
    client.readContract({ address: tv, abi: tokenVenueAbi, functionName: "markets", args: [asset], ...at }),
    client.readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [tv], ...at }),
  ]);
  const [, decimals, spreadBps] = m;
  return { ...base, kind: "token", market: { kind: "token", decimals, spreadBps, priceWad, inventoryOut: inventory } };
}

export interface IndexState {
  blockNumber: bigint;
  state: BasketState;
  legs: LegState[];
}

/** On-chain state of an index (or of a basket to be created when `create` is given). */
export async function loadBasket(
  client: PublicClient,
  dep: Deployment,
  target: { index: Address } | { create: { assets: Address[]; weightsBps: number[] } },
): Promise<IndexState> {
  const c = dep.contracts;
  const blockNumber = await client.getBlockNumber();
  const at = { blockNumber };
  const impl = c.vaultImplementation;
  let assets: readonly Address[];
  let weights: readonly number[];
  let balances: readonly bigint[];
  let supply = 0n;
  const src = "index" in target ? target.index : impl;
  if ("index" in target) {
    [assets, weights, balances, supply] = await Promise.all([
      client.readContract({ address: target.index, abi: indexVaultAbi, functionName: "assets", ...at }),
      client.readContract({ address: target.index, abi: indexVaultAbi, functionName: "targetWeights", ...at }),
      client.readContract({ address: target.index, abi: indexVaultAbi, functionName: "balances", ...at }),
      client.readContract({ address: target.index, abi: indexVaultAbi, functionName: "totalSupply", ...at }),
    ]);
  } else {
    assets = target.create.assets;
    weights = target.create.weightsBps;
    balances = assets.map(() => 0n);
  }
  const [tradeFeeBps, deadUnits, startLevelUsd, usdcVenue, legs] = await Promise.all([
    client.readContract({ address: src, abi: indexVaultAbi, functionName: "tradeFeeBps", ...at }),
    client.readContract({ address: src, abi: indexVaultAbi, functionName: "deadUnits", ...at }),
    client.readContract({ address: src, abi: indexVaultAbi, functionName: "startLevelUsd", ...at }),
    c.tokenVenue ? client.readContract({ address: c.usdc, abi: erc20Abi, functionName: "balanceOf", args: [c.tokenVenue], ...at }) : Promise.resolve(0n),
    Promise.all(assets.map((a) => loadLeg(client, dep, a, blockNumber))),
  ]);
  return {
    blockNumber,
    legs,
    state: {
      supply,
      tradeFeeBps,
      deadUnits,
      startLevelUsd,
      usdcDecimals: 6,
      usdcVenueInventory: c.tokenVenue ? { [c.tokenVenue]: usdcVenue } : {},
      legs: legs.map((l, i) => ({
        asset: l.asset,
        decimals: l.decimals,
        balance: balances[i] ?? 0n,
        targetBps: weights[i] ?? 0,
        fresh: l.fresh,
        registryBuysPaused: l.registryBuysPaused,
        venue: l.venue,
        market: l.market,
      })),
    },
  };
}

/**
 * Fill the DEX legs of a basket plan with `DexVenue.quote` for exactly the amounts the plan sends to each venue
 * (`buySpends` on a buy, `sellAmounts` on a sell), at the state's block — one batched round of eth_calls. The pure
 * previews then read them (shared/math DexMarket). Non-DEX legs are left alone.
 */
export async function quoteDexLegs(
  client: PublicClient,
  dep: Deployment,
  st: IndexState,
  amounts: bigint[],
  side: "buy" | "sell",
): Promise<void> {
  const dv = dep.contracts.dexVenue;
  if (!dv) return;
  const usdc = dep.contracts.usdc;
  await Promise.all(
    st.state.legs.map(async (l, i) => {
      const m = l.market;
      const amount = amounts[i] ?? 0n;
      if (m.kind !== "dex" || amount === 0n) return;
      const args = side === "buy" ? ([usdc, l.asset as Address, amount] as const) : ([l.asset as Address, usdc, amount] as const);
      const out = await client.readContract({ address: dv, abi: dexVenueAbi, functionName: "quote", args, blockNumber: st.blockNumber });
      (side === "buy" ? m.buyOut : m.sellOut)[amount.toString()] = out;
    }),
  );
}
