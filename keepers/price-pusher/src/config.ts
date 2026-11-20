import { internalPricesSchema, loadAssets, loadServices, type InternalPrices } from "@pantado/shared";
import { envInt, requireEnv } from "@pantado/service-kit";
import type { PushConfig } from "./logic.js";

export interface PusherConfig {
  push: PushConfig;
  tickSec: number;
  port: number;
  marketDataUrl: string;
  assetIds: string[];
}

export function loadPusherConfig(): PusherConfig {
  const s = loadServices();
  return {
    push: {
      pushIntervalSec: s.marketData.pushIntervalSec,
      moveBps: s.marketData.moveBps,
      deviationBps: s.marketData.deviationBps,
    },
    tickSec: s.keepers.pricePusher.tickSec,
    port: envInt("PORT", 9101),
    marketDataUrl: requireEnv("MARKET_DATA_URL"),
    // every pushed asset; the quote (USDC) has a fixed on-chain price
    assetIds: loadAssets().filter((a) => a.kind !== "quote").map((a) => a.id),
  };
}

export function httpPriceSource(baseUrl: string, timeoutMs = 5000): () => Promise<InternalPrices> {
  return async () => {
    const res = await fetch(new URL("/internal/prices", baseUrl), { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`market-data ${res.status}`);
    return internalPricesSchema.parse(await res.json());
  };
}
