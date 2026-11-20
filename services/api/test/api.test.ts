import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPublicClient, decodeEventLog, http, type PublicClient } from "viem";
import { foundry } from "viem/chains";
import { createReader, indexVaultAbi, swapRouterAbi, tx } from "@pantado/sdk";
import { hasFoundry, startAnvilWithDeployment, TestKit, type AnvilEnv } from "@pantado/sdk/testing";
import { startIndexer, type IndexerEnv } from "@pantado/service-kit/testing";
import { loadAssets, loadProfile, loadServices } from "@pantado/shared";
import type { FastifyInstance } from "fastify";
import { indexerClient, memoryCache, type ApiDeps } from "../src/deps.js";
import { buildServer } from "../src/server.js";

const run = hasFoundry() ? describe : describe.skip;

run("api on Anvil + indexer", () => {
  let env: AnvilEnv;
  let ix: IndexerEnv;
  let app: FastifyInstance;
  let kit: TestKit;
  let client: PublicClient;
  let index: `0x${string}`;
  let priv: `0x${string}`;
  let deps0: () => ApiDeps;

  beforeAll(async () => {
    env = await startAnvilWithDeployment({ demo: true });
    ix = await startIndexer(env.rpcUrl, env.deployment);
    kit = new TestKit(env.rpcUrl, env.deployment);
    client = createPublicClient({ chain: foundry, transport: http(env.rpcUrl) }) as PublicClient;
    deps0 = (): ApiDeps => ({
      profile: loadProfile("contest"),
      services: loadServices(),
      assets: loadAssets(),
      deployment: env.deployment,
      client,
      reader: createReader(client, env.deployment),
      gql: indexerClient(ix.url),
      cache: memoryCache(),
      prices: async () => new Map(),
    });
    const deps: ApiDeps = {
      profile: loadProfile("contest"),
      services: loadServices(),
      assets: loadAssets(),
      deployment: env.deployment,
      client,
      reader: createReader(client, env.deployment),
      gql: indexerClient(ix.url),
      cache: memoryCache(),
      prices: async () => new Map(),
    };
    app = buildServer(deps);
    index = await kit.createIndex(0, {
      name: "API test",
      ticker: "APIT",
      description: "two stocks two tokens",
      assets: ["nvda", "aapl", "btcb", "wavax"],
      weightsBps: [3000, 2000, 3000, 2000],
      mode: 1,
      driftBps: 0,
      isPublic: true,
      usdcIn: 5_000_000_000n,
      minUnits: 0n,
    });
    priv = await kit.createIndex(0, {
      name: "Private one",
      ticker: "PRIV",
      description: "",
      assets: ["nvda", "btcb"],
      weightsBps: [5000, 5000],
      mode: 0,
      driftBps: 0,
      isPublic: false,
      usdcIn: 100_000_000n,
      minUnits: 0n,
    });
    await ix.caughtUp(client);
  }, 300_000);

  afterAll(async () => {
    await app?.close();
    ix?.stop();
    env?.stop();
  });

  const get = async <T>(url: string): Promise<{ status: number; body: T }> => {
    const r = await app.inject({ method: "GET", url });
    return { status: r.statusCode, body: r.json() as T };
  };
  const post = async <T>(url: string, payload: unknown): Promise<{ status: number; body: T }> => {
    const r = await app.inject({ method: "POST", url, payload: payload as Record<string, unknown> });
    return { status: r.statusCode, body: r.json() as T };
  };

  it("/quote/basket buy equals the on-chain buy (P6 gate: within 1 wei of units)", async () => {
    for (const usdcIn of [1_000_000n, 123_456_789n, 2_500_000_000n]) {
      const q = await post<{ units: string; blockNumber: string }>("/quote/basket", { index, side: "buy", amount: usdcIn.toString() });
      expect(q.status).toBe(200);
      await kit.fundUsdc(1, usdcIn, index);
      const hash = await kit.send(tx.buy(index, usdcIn, 0n, kit.account(1).address), 1);
      const rc = await client.getTransactionReceipt({ hash });
      const bought = rc.logs
        .map((l) => {
          try {
            return decodeEventLog({ abi: indexVaultAbi, ...l });
          } catch {
            return null;
          }
        })
        .find((e) => e?.eventName === "Bought");
      const units = (bought?.args as { units: bigint }).units;
      const diff = units > BigInt(q.body.units) ? units - BigInt(q.body.units) : BigInt(q.body.units) - units;
      expect(diff).toBeLessThanOrEqual(1n);
    }
  });

  it("/quote/basket sell and /quote/swap match the contracts", async () => {
    const units = 10n ** 17n;
    const q = await post<{ usdcOut: string }>("/quote/basket", { index, side: "sell", amount: units.toString() });
    const lens = await kit.reader.previewSell(index, units);
    expect(BigInt(q.body.usdcOut)).toBe(lens[0]);
    const s = await post<{ amountOut: string; fee: string }>("/quote/swap", { tokenIn: kit.asset("nvda"), tokenOut: kit.asset("btcb"), amountIn: (10n ** 18n).toString() });
    const onchain = await client.readContract({ address: env.deployment.contracts.swapRouter, abi: swapRouterAbi, functionName: "quote", args: [kit.asset("nvda"), kit.asset("btcb"), 10n ** 18n] });
    expect([BigInt(s.body.amountOut), BigInt(s.body.fee)]).toEqual([onchain[0], onchain[1]]);
  });

  it("/quote/basket surfaces typed errors (size cap)", async () => {
    const q = await post<{ error: { code: string; message: string } }>("/quote/basket", { index, side: "buy", amount: (200_000n * 10n ** 6n).toString() });
    expect(q.status).toBe(422);
    expect(q.body.error.code).toBe("SizeCapExceeded");
  });

  it("/quote/create returns the review numbers", async () => {
    const q = await post<{ units: string; creationFee: string; totalUsdc: string }>("/quote/create", {
      assets: [kit.asset("nvda"), kit.asset("btcb")],
      weightsBps: [5000, 5000],
      usdcIn: "100000000",
    });
    expect(q.status).toBe(200);
    expect(q.body.creationFee).toBe("5000000");
    expect(q.body.totalUsdc).toBe("105000000");
    expect(BigInt(q.body.units)).toBeGreaterThan(9n * 10n ** 17n);
  });

  it("/assets/search by ticker, name and contract address; registry only", async () => {
    expect((await get<{ id: string }[]>("/assets/search?q=nvda")).body[0]?.id).toBe("nvda");
    expect((await get<{ id: string }[]>("/assets/search?q=bitcoin")).body.map((a) => a.id)).toContain("btcb");
    expect((await get<{ id: string }[]>(`/assets/search?q=${kit.asset("aapl")}`)).body[0]?.id).toBe("aapl");
    const miss = await get<{ error: { message: string } }>("/assets/search?q=0x000000000000000000000000000000000000beef");
    expect(miss.status).toBe(404);
    expect(miss.body.error.message).toBe("No listed asset at this contract address");
    const avax = (await get<{ displaySymbol: string }[]>("/assets/search?q=wavax")).body[0];
    expect(avax?.displaySymbol).toBe("AVAX");
  });

  it("/indexes lists public only; private shows in the creator's portfolio", async () => {
    await ix.caughtUp(client);
    const list = (await get<{ id: string; badge: string }[]>("/indexes")).body;
    expect(list.map((i) => i.id)).toContain(index.toLowerCase());
    expect(list.map((i) => i.id)).not.toContain(priv.toLowerCase());
    expect(list[0]?.badge).toBe("Traded on Fuji testnet");
    const pf = (await get<{ yourIndexes: { id: string; visibility: string }[]; positions: unknown[] }>(`/portfolio/${kit.account(0).address}`)).body;
    expect(pf.yourIndexes.find((i) => i.id === priv.toLowerCase())?.visibility).toBe("private");
    expect(pf.positions.length).toBe(2);
  });

  it("index detail, composition, levels, holders, transactions", async () => {
    const d = (await get<{ ticker: string; plan: { mode: number } }>(`/indexes/${index}`)).body;
    expect(d.ticker).toBe("APIT");
    const comp = (await get<{ legs: { symbol: string; currentBps: string }[] }>(`/indexes/${index}/composition`)).body;
    expect(comp.legs.map((l) => l.symbol)).toEqual(["NVDA", "AAPL", "BTC.b", "AVAX"]);
    const lv = (await get<{ levels: { level: string }[] }>(`/indexes/${index}/levels`)).body;
    expect(BigInt(lv.levels[0]?.level ?? "0")).toBeGreaterThan(99n * 10n ** 18n);
    const holders = (await get<{ holder: string }[]>(`/indexes/${index}/holders`)).body;
    expect(holders.length).toBeGreaterThanOrEqual(2);
    const txs = (await get<{ kind: string }[]>(`/indexes/${index}/transactions`)).body;
    expect(txs.map((t) => t.kind)).toContain("create");
  });

  it("presets: equal works; marketcap explains missing data", async () => {
    expect((await get<{ weights: number[] }>("/presets?assets=nvda,aapl,btcb&preset=equal")).body.weights).toEqual([34, 33, 33]);
    const mc = await get<{ error: { code: string } }>("/presets?assets=nvda,btcb&preset=marketcap");
    expect(mc.status).toBe(409);
  });

  it("candles, board changes and low-vol use the reference-market history when market-data has it", async () => {
    const day = 86_400;
    const t0 = Math.floor(Date.now() / 1000 / day) * day - 10 * day;
    const series = (id: string): { t: number; o: number; h: number; l: number; c: number }[] =>
      Array.from({ length: 10 }, (_, i) => {
        const c = id === "nvda" ? 100 + (i % 2) * 10 : 50 + i; // nvda swings more than btcb
        return { t: t0 + i * day, o: c, h: c + 1, l: c - 1, c };
      });
    const base = buildServer({
      ...deps0(),
      history: {
        candles: async (id, interval, limit, before) =>
          interval === "1d" ? series(id).filter((k) => before === undefined || k.t < before).slice(-limit) : [],
        changes: async () => new Map([["nvda", { d1: 0.05, d7: -0.1, d30: null }]]),
      },
    });
    const c = (await base.inject({ method: "GET", url: "/assets/nvda/candles?interval=1d&limit=3" })).json() as { source: string; candles: { c: number }[] };
    expect(c.source).toBe("Reference market: Robinhood Chain (on-chain)");
    expect(c.candles.map((k) => k.c)).toEqual([110, 100, 110]);
    // older pages: candles before a time
    const older = (await base.inject({ method: "GET", url: `/assets/nvda/candles?interval=1d&limit=2&before=${t0 + 3 * day}` })).json() as { candles: { t: number }[] };
    expect(older.candles.map((k) => k.t)).toEqual([t0 + day, t0 + 2 * day]);
    const none = (await base.inject({ method: "GET", url: `/assets/nvda/candles?interval=1d&before=${t0}` })).json() as { candles: unknown[] };
    expect(none.candles).toEqual([]); // nothing older: an empty page, not the pushed-price fallback
    expect((await base.inject({ method: "GET", url: "/assets/nvda/candles?interval=1d&before=abc" })).statusCode).toBe(400);
    expect((await base.inject({ method: "GET", url: "/assets/nvda/candles?interval=4h" })).statusCode).toBe(200);
    expect((await base.inject({ method: "GET", url: "/assets/nvda/candles?interval=2h" })).statusCode).toBe(400);
    // 1h has no history here → pushed prices, labelled as such
    expect(((await base.inject({ method: "GET", url: "/assets/nvda/candles?interval=1h" })).json() as { source: string }).source).toBe("canonical (pushed)");
    const board = (await base.inject({ method: "GET", url: "/board?kind=stocks" })).json() as { id: string; change24h: number | null; change7d: number | null }[];
    const nv = board.find((r) => r.id === "nvda");
    expect(nv?.change24h).toBe(0.05);
    expect(nv?.change7d).toBe(-0.1);
    const lv = (await base.inject({ method: "GET", url: "/presets?assets=nvda,btcb&preset=lowvol" })).json() as { weights: number[] };
    expect(lv.weights[1]).toBeGreaterThan(lv.weights[0] ?? 100); // btcb is calmer → larger weight
  });

  it("stocks and tokens show the reference market's 24h volume; indexes keep Pantado's own", async () => {
    const withVol = buildServer({
      ...deps0(),
      history: {
        candles: async () => [],
        changes: async () => new Map(),
        volume: async () => ({ byAsset: new Map([["nvda", 1_250_000], ["wavax", 9_800_000]]), total: 30_000_000, windowSec: 86_400 }),
      },
    });
    const board = (await withVol.inject({ method: "GET", url: "/board" })).json() as { id: string; kind: string; volume24hUsd: number | null; volumeSource: string }[];
    expect(board.find((r) => r.id === "nvda")).toMatchObject({ volume24hUsd: 1_250_000, volumeSource: "Reference market: Robinhood Chain (on-chain)" });
    expect(board.find((r) => r.id === "wavax")).toMatchObject({ volume24hUsd: 9_800_000, volumeSource: "Avalanche (on-chain)" });
    expect(board.find((r) => r.id === "joe")?.volume24hUsd).toBe(0); // read, no swaps
    const ix = board.find((r) => r.kind === "index");
    expect(typeof ix?.volume24hUsd).toBe("number"); // the app's buys and sells
    expect(ix?.volumeSource).not.toMatch(/Robinhood|Avalanche \(on-chain\)/);
    const v = (await withVol.inject({ method: "GET", url: "/volume" })).json() as { marketUsd: number | null; indexesUsd: number };
    expect(v.marketUsd).toBe(30_000_000); // each swap once, not the sum of rows
    expect(typeof v.indexesUsd).toBe("number");
    // market-data without a full window yet: unknown, never 0
    const noVol = buildServer({ ...deps0(), history: { candles: async () => [], changes: async () => new Map(), volume: async () => null } });
    const b2 = (await noVol.inject({ method: "GET", url: "/board?kind=tokens" })).json() as { volume24hUsd: number | null }[];
    expect(b2.every((r) => r.volume24hUsd === null)).toBe(true);
    expect(((await noVol.inject({ method: "GET", url: "/volume" })).json() as { marketUsd: number | null }).marketUsd).toBeNull();
  });

  it("/fund proxies to auto-fund with the secret and limits new wallets per IP", async () => {
    const seen: { auth: string | undefined; body: string }[] = [];
    const fake = createServer((req, res) => {
      let body = "";
      req.on("data", (c: Buffer) => (body += c.toString()));
      req.on("end", () => {
        seen.push({ auth: req.headers.authorization, body });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "funded" }));
      });
    });
    await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
    const port = (fake.address() as AddressInfo).port;
    const base = buildServer({ ...deps0(), autoFund: { url: `http://127.0.0.1:${port}`, secret: "s3cret" } });
    const post = (address: string) => base.inject({ method: "POST", url: "/fund", payload: { address }, headers: { "cf-connecting-ip": "203.0.113.7" } });
    const limit = loadServices().api.fundPerIpPerHour;
    for (let i = 0; i < limit; i++) expect((await post(`0x${String(i + 1).padStart(40, "0")}`)).json()).toEqual({ status: "funded" });
    expect((await post("0x00000000000000000000000000000000000000ff")).statusCode).toBe(429);
    expect(seen[0]?.auth).toBe("Bearer s3cret");
    expect(JSON.parse(seen[0]?.body ?? "{}")).toEqual({ address: "0x0000000000000000000000000000000000000001" });
    expect((await post("not-an-address")).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/fund", payload: { address: "0x0000000000000000000000000000000000000001" } })).statusCode).toBe(404); // not configured
    fake.close();
  });

  it("/fund asks for embedded-wallet gas only with a Privy-signed token for this app", async () => {
    const { generateKeyPair, SignJWT } = await import("jose");
    const { privyVerifier } = await import("../src/privy.js");
    const privy = await generateKeyPair("ES256");
    const other = await generateKeyPair("ES256");
    const sign = (key: CryptoKey, aud: string, sub = "did:privy:u1") =>
      new SignJWT({}).setProtectedHeader({ alg: "ES256" }).setIssuer("privy.io").setAudience(aud).setSubject(sub).setIssuedAt().setExpirationTime("1h").sign(key);
    const bodies: unknown[] = [];
    const fake = createServer((req, res) => {
      let body = "";
      req.on("data", (c: Buffer) => (body += c.toString()));
      req.on("end", () => {
        bodies.push(JSON.parse(body));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "funded" }));
      });
    });
    await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
    const port = (fake.address() as AddressInfo).port;
    const verifyPrivy = privyVerifier({ appId: "app-1", issuer: "privy.io", keys: async () => privy.publicKey });
    const base = buildServer({ ...deps0(), autoFund: { url: `http://127.0.0.1:${port}`, secret: "s", verifyPrivy } });
    const post = (i: number, privyToken?: string) =>
      base.inject({ method: "POST", url: "/fund", payload: { address: `0x${String(i).padStart(40, "0")}`, privyToken }, headers: { "cf-connecting-ip": `198.51.100.${i}` } });
    await post(1, await sign(privy.privateKey, "app-1"));
    await post(2, await sign(other.privateKey, "app-1")); // not signed by Privy
    await post(3, await sign(privy.privateKey, "another-app")); // another app's token
    await post(4, "garbage");
    await post(5);
    expect(bodies[0]).toEqual({ address: "0x0000000000000000000000000000000000000001", embeddedUser: "did:privy:u1" });
    for (const b of bodies.slice(1)) expect(b).not.toHaveProperty("embeddedUser");
    expect(bodies).toHaveLength(5); // USDC is still asked for every wallet
    fake.close();
  });

  it("/health and /metrics", async () => {
    expect((await get<{ ok: boolean }>("/health")).body.ok).toBe(true);
    const m = await app.inject({ method: "GET", url: "/metrics" });
    expect(m.body).toContain("api_request_duration_seconds");
  });
});
