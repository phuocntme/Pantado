import { createClient } from "redis";
import type { CanonicalPrice } from "@pantado/shared";
import type { PriceSink } from "./service.js";

/** Redis `price:<chain>:<id>` (TTL) and the `prices` pub/sub channel (spec §9.3). */
export async function redisSink(url: string, ttlSec: number, chainOf: (id: string) => string): Promise<PriceSink & { close(): Promise<void> }> {
  const client = createClient({ url });
  await client.connect();
  return {
    async publish(prices: CanonicalPrice[]) {
      const multi = client.multi();
      for (const p of prices) multi.set(`price:${chainOf(p.id)}:${p.id}`, JSON.stringify(p), { EX: ttlSec });
      await multi.exec();
      await client.publish("prices", JSON.stringify({ asOf: Date.now(), prices }));
    },
    async close() {
      await client.quit();
    },
  };
}
