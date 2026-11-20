import type { Address, PublicClient } from "viem";
import type { Profile } from "@pantado/shared";
import type { EnginePrice } from "../engine/tokens.js";
import { readFeed } from "./chainlink.js";

/** Stock price source used for the stock cross-check and the stale-reference fallback (spec §8). */
export interface StockApi {
  readonly name: string;
  lastTrade(symbol: string): Promise<EnginePrice | null>;
}

export class StockApiNotConfigured extends Error {
  override readonly name = "StockApiNotConfigured";
}

/**
 * Default stock source: the Chainlink equity feeds on Robinhood Chain (`data.robinhood.chainlink`, keyed
 * `<SYMBOL>/USD`). On-chain, keyless, and already includes the token's share multiplier. Symbols without a
 * confirmed feed return null (no cross-check, no fallback).
 */
export class RobinhoodFeedStockApi implements StockApi {
  readonly name = "chainlink-robinhood";
  private readonly cache = new Map<string, { at: number; value: EnginePrice | null }>();
  constructor(
    private readonly client: PublicClient,
    private readonly feeds: Record<string, { address: Address; decimals: number; confirmed: boolean }>,
    /** Feeds move on a deviation threshold or heartbeat; re-reading every refresh only burns RPC quota. */
    private readonly ttlMs = 30_000,
  ) {}

  async lastTrade(symbol: string): Promise<EnginePrice | null> {
    const f = this.feeds[`${symbol}/USD`];
    if (!f?.confirmed) return null;
    const hit = this.cache.get(symbol);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value;
    const r = await readFeed(this.client, f.address, f.decimals);
    const value = r ? { usd: r.usd, ts: r.ts, source: `chainlink:${f.address}` } : null;
    this.cache.set(symbol, { at: Date.now(), value });
    return value;
  }
}

/**
 * Provider from `STOCK_API_PROVIDER` (default `chainlink-robinhood`). `none` disables the stock source.
 */
export function stockApiFromEnv(profile: Profile, robinhood: PublicClient | null): StockApi | null {
  const provider = process.env.STOCK_API_PROVIDER ?? "chainlink-robinhood";
  if (provider === "none") return null;
  if (provider === "chainlink-robinhood") return robinhood ? new RobinhoodFeedStockApi(robinhood, profile.data.robinhood.chainlink ?? {}) : null;
  throw new StockApiNotConfigured(`stock API provider "${provider}" is not supported (use chainlink-robinhood or none)`);
}
