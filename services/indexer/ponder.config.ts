import { createConfig, factory, loadBalance, rateLimit } from "ponder";
import { erc20Abi, getAbiItem, http } from "viem";
import { executionRpcs, loadDeployment, loadProfile } from "@pantado/shared";
import {
  feeSplitterAbi,
  indexFactoryAbi,
  indexVaultAbi,
  priceOracleAbi,
  rebalancerAbi,
  stockVenueAbi,
  swapRouterAbi,
  tokenVenueAbi,
} from "./abis/index.js";

/**
 * Execution chain (spec §9.1: full history on Fuji) from the active profile and its deployments file.
 * `EXECUTION_RPC_URL` overrides the RPC (local Anvil). Mainnet data-plane chains are added only once their
 * pools are confirmed; generated whitelists are empty until then.
 */
const profile = loadProfile();
const dep = loadDeployment();
// EXECUTION_RPC_URL (local Anvil) wins. Otherwise the indexer's RPC pool: endpoints that take one eth_getLogs
// over every listed asset (60+ addresses; publicnode and dRPC cap it at 10), load-balanced, each held to its own
// request rate so no single free endpoint answers with 429; plus env fallbacks (a dedicated node).
const pool = process.env.EXECUTION_RPC_URL ? [] : executionRpcs(profile, "indexer", process.env);
const rpc = process.env.EXECUTION_RPC_URL
  ? http(process.env.EXECUTION_RPC_URL)
  : loadBalance(pool.map((e) => rateLimit(http(e.url), { requestsPerSecond: e.rps })));
const chain = profile.execution.network === "avalanche" ? "avalanche" : "fuji";
const startBlock = dep.startBlock;
const c = dep.contracts;

export default createConfig({
  database: process.env.DATABASE_URL
    ? { kind: "postgres", connectionString: process.env.DATABASE_URL }
    : { kind: "pglite", ...(process.env.PONDER_PGLITE_DIR ? { directory: process.env.PONDER_PGLITE_DIR } : {}) },
  chains: {
    [chain]: {
      id: dep.chainId,
      rpc,
      // Avalanche has single-slot finality; poll fast so trades show ≤ 2 s after their block (spec §9.8)
      pollingInterval: Number(process.env.INDEXER_POLL_MS ?? 1000),
      // public RPCs cap eth_getLogs ranges (Fuji: 100 blocks); the local Anvil override has no cap
      ...(profile.execution.maxLogRange && !process.env.EXECUTION_RPC_URL ? { ethGetLogsBlockRange: profile.execution.maxLogRange } : {}),
      ...(!process.env.EXECUTION_RPC_URL ? { maxRequestsPerSecond: pool.reduce((s, e) => s + e.rps, 0) } : {}),
    },
  },
  contracts: {
    IndexFactory: { chain, abi: indexFactoryAbi, address: c.factory, startBlock },
    IndexVault: {
      chain,
      abi: indexVaultAbi,
      address: factory({
        address: c.factory,
        event: getAbiItem({ abi: indexFactoryAbi, name: "IndexCreated" }),
        parameter: "index",
      }),
      startBlock,
    },
    PriceOracle: { chain, abi: priceOracleAbi, address: c.oracle, startBlock },
    Rebalancer: { chain, abi: rebalancerAbi, address: c.rebalancer, startBlock },
    StockVenue: { chain, abi: stockVenueAbi, address: c.stockVenue, startBlock },
    TokenVenue: { chain, abi: tokenVenueAbi, address: c.tokenVenue, startBlock },
    FeeSplitter: { chain, abi: feeSplitterAbi, address: c.feeSplitter, startBlock },
    SwapRouter: { chain, abi: swapRouterAbi, address: c.swapRouter, startBlock },
    Asset: { chain, abi: erc20Abi, address: Object.values(dep.assets), startBlock },
  },
});
