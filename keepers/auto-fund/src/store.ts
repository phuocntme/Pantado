import { createClient } from "redis";

/** Once-per-wallet ledger. `claim` is atomic: true only for the first caller. */
export interface FundStore {
  claim(key: string): Promise<boolean>;
  release(key: string): Promise<void>;
  close(): Promise<void>;
}

export class MemoryStore implements FundStore {
  private readonly keys = new Set<string>();
  async claim(key: string): Promise<boolean> {
    if (this.keys.has(key)) return false;
    this.keys.add(key);
    return true;
  }
  async release(key: string): Promise<void> {
    this.keys.delete(key);
  }
  async close(): Promise<void> {}
}

export async function redisStore(url: string): Promise<FundStore> {
  const client = createClient({ url });
  await client.connect();
  return {
    async claim(key) {
      return (await client.set(key, String(Date.now()), { NX: true })) === "OK";
    },
    async release(key) {
      await client.del(key);
    },
    async close() {
      await client.quit();
    },
  };
}
