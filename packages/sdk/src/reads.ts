import { keccak256, toBytes, type Address, type PublicClient } from "viem";
import type { Deployment } from "@pantado/shared";
import {
  assetRegistryAbi,
  feeSplitterAbi,
  indexFactoryAbi,
  indexLensAbi,
  indexVaultAbi,
  priceOracleAbi,
  rebalancerAbi,
  stockVenueAbi,
  swapRouterAbi,
} from "./abis/index.js";

export interface IndexSummary {
  address: Address;
  name: string;
  ticker: string;
  creator: Address;
  isPublic: boolean;
  createdAt: number;
  assets: readonly Address[];
  targetBps: readonly number[];
  totalSupply: bigint;
}

/** Typed read helpers over one deployment. Reads take an optional block for level checks. */
export function createReader(client: PublicClient, deployment: Deployment) {
  const c = deployment.contracts;
  const opts = (blockNumber?: bigint) => (blockNumber === undefined ? {} : { blockNumber });

  return {
    deployment,

    indexCount: (): Promise<bigint> =>
      client.readContract({ address: c.factory, abi: indexFactoryAbi, functionName: "indexCount" }),

    indexes: (offset = 0n, limit = 100n): Promise<readonly Address[]> =>
      client.readContract({ address: c.factory, abi: indexFactoryAbi, functionName: "indexes", args: [offset, limit] }),

    indexByTicker: (ticker: string): Promise<Address> =>
      client.readContract({
        address: c.factory,
        abi: indexFactoryAbi,
        functionName: "indexByTicker",
        args: [keccak256(toBytes(ticker))],
      }),

    isTickerTaken: (ticker: string): Promise<boolean> =>
      client.readContract({ address: c.factory, abi: indexFactoryAbi, functionName: "isTickerTaken", args: [ticker] }),

    async index(address: Address, blockNumber?: bigint): Promise<IndexSummary> {
      const [name, ticker, info, assets, targetBps, totalSupply] = await Promise.all([
        client.readContract({ address, abi: indexVaultAbi, functionName: "name", ...opts(blockNumber) }),
        client.readContract({ address, abi: indexVaultAbi, functionName: "symbol", ...opts(blockNumber) }),
        client.readContract({ address: c.factory, abi: indexFactoryAbi, functionName: "info", args: [address], ...opts(blockNumber) }),
        client.readContract({ address, abi: indexVaultAbi, functionName: "assets", ...opts(blockNumber) }),
        client.readContract({ address, abi: indexVaultAbi, functionName: "targetWeights", ...opts(blockNumber) }),
        client.readContract({ address, abi: indexVaultAbi, functionName: "totalSupply", ...opts(blockNumber) }),
      ]);
      return {
        address,
        name,
        ticker,
        creator: info.creator,
        isPublic: info.isPublic,
        createdAt: Number(info.createdAt),
        assets,
        targetBps,
        totalSupply,
      };
    },

    /** Level, USD 1e18 per unit — the reference for indexer checks. */
    level: (index: Address, blockNumber?: bigint): Promise<bigint> =>
      client.readContract({ address: c.lens, abi: indexLensAbi, functionName: "level", args: [index], ...opts(blockNumber) }),

    basket: (index: Address, blockNumber?: bigint) =>
      client.readContract({ address: c.lens, abi: indexLensAbi, functionName: "basket", args: [index], ...opts(blockNumber) }),

    planState: (index: Address) =>
      client.readContract({ address: c.lens, abi: indexLensAbi, functionName: "planState", args: [index] }),

    previewBuy: (index: Address, usdcIn: bigint) =>
      client.readContract({ address: c.lens, abi: indexLensAbi, functionName: "previewBuy", args: [index, usdcIn] }),

    previewSell: (index: Address, units: bigint) =>
      client.readContract({ address: c.lens, abi: indexLensAbi, functionName: "previewSell", args: [index, units] }),

    previewRedeem: (index: Address, units: bigint) =>
      client.readContract({ address: c.lens, abi: indexLensAbi, functionName: "previewRedeem", args: [index, units] }),

    quoteSwap: (tokenIn: Address, tokenOut: Address, amountIn: bigint) =>
      client.readContract({ address: c.swapRouter, abi: swapRouterAbi, functionName: "quote", args: [tokenIn, tokenOut, amountIn] }),

    price: (asset: Address) =>
      client.readContract({ address: c.oracle, abi: priceOracleAbi, functionName: "latest", args: [asset] }),

    isFresh: (asset: Address) =>
      client.readContract({ address: c.oracle, abi: priceOracleAbi, functionName: "isFresh", args: [asset] }),

    assetInfo: (asset: Address) =>
      client.readContract({ address: c.assetRegistry, abi: assetRegistryAbi, functionName: "info", args: [asset] }),

    creatorEarnings: (creator: Address) =>
      client.readContract({ address: c.feeSplitter, abi: feeSplitterAbi, functionName: "earnings", args: [creator] }),

    rebalancerParams: () => client.readContract({ address: c.rebalancer, abi: rebalancerAbi, functionName: "params" }),

    isDue: (index: Address) =>
      client.readContract({ address: c.rebalancer, abi: rebalancerAbi, functionName: "isDue", args: [index] }),

    stockVenueState: async () => {
      const [reserve, exposure, ratio] = await Promise.all([
        client.readContract({ address: c.stockVenue, abi: stockVenueAbi, functionName: "reserve" }),
        client.readContract({ address: c.stockVenue, abi: stockVenueAbi, functionName: "totalExposureUsd" }),
        client.readContract({ address: c.stockVenue, abi: stockVenueAbi, functionName: "reserveRatioNowBps" }),
      ]);
      return { reserve, exposureUsd: exposure, reserveRatioBps: ratio };
    },
  };
}
export type PantadoReader = ReturnType<typeof createReader>;
