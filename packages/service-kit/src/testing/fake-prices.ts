import { createServer, type Server } from "node:http";
import { decimalString, type CanonicalPrice, type InternalPrices } from "@pantado/shared";

/** In-process stand-in for market-data's `/internal/prices` (tests and local runs). */
export interface FakePriceServer {
  url: string;
  set(id: string, usd: number): void;
  setCrossCheck(id: string, usd: number | null): void;
  /** Random-walk every price by up to ±maxBps. */
  step(maxBps: number, rand?: () => number): void;
  setTime(unixSec: number): void;
  get(id: string): number;
  close(): Promise<void>;
}

export async function startFakePriceServer(seeds: Record<string, number>): Promise<FakePriceServer> {
  const prices = new Map(Object.entries(seeds));
  const cross = new Map<string, number | null>();
  let now = Math.floor(Date.now() / 1000);
  const fmt = (v: number): string => decimalString(v, 12);
  const body = (): InternalPrices => ({
    asOf: now * 1000,
    prices: [...prices.entries()].map(
      ([id, usd]): CanonicalPrice => ({
        id,
        canonical: { usd: fmt(usd), ts: now, source: "fake" },
        crossCheck: (() => {
          const c = cross.get(id);
          return c === undefined ? { usd: fmt(usd), ts: now, source: "fake-cross" } : c === null ? null : { usd: fmt(c), ts: now, source: "fake-cross" };
        })(),
      }),
    ),
  });
  const server: Server = createServer((req, res) => {
    if (req.url === "/internal/prices") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body()));
    } else res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    set: (id, usd) => void prices.set(id, usd),
    setCrossCheck: (id, usd) => void cross.set(id, usd),
    step(maxBps, rand = Math.random) {
      for (const [id, v] of prices) prices.set(id, v * (1 + ((rand() * 2 - 1) * maxBps) / 10_000));
    },
    setTime: (t) => void (now = t),
    get: (id) => prices.get(id) ?? Number.NaN,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
