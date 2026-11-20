import Fastify from "fastify";
import { createPublicClient, http } from "viem";
import { Registry } from "prom-client";
import { createLogger, envInt, onShutdown, runLoop, startHealthServer } from "@pantado/service-kit";
import { loadAssets, loadProfile, loadServices } from "@pantado/shared";
import { redisSink } from "./redis-sink.js";
import { MarketData } from "./service.js";
import { dateTs, PriceHistory } from "./history.js";
import { scanHistory, type HistoryJob } from "./history-scan.js";
import { readVolume, Volume24h } from "./volume.js";
import { RpcSwapReader } from "./sources/rpc-swaps.js";
import { stockApiFromEnv } from "./sources/stock-api.js";

async function main(): Promise<void> {
  const log = createLogger("market-data");
  const profile = loadProfile();
  const services = loadServices();
  const assets = loadAssets();
  const mode = process.env.MARKET_DATA_MODE === "seed" ? "seed" : "live";
  if (mode === "seed") log.warn("SEED MODE: serving config seed prices (local development only)");
  const rpcs = (c: { rpc: string[]; rpcEnv: string[] }): string[] =>
    [...c.rpc, ...c.rpcEnv.map((e) => process.env[e] ?? "")].filter((u) => u.startsWith("http"));
  const avaxRpc = rpcs(profile.data.avalanche);
  const rhRpc = rpcs(profile.data.robinhood);
  const sink = process.env.REDIS_URL
    ? await redisSink(process.env.REDIS_URL, services.marketData.redisTtlSec, (id) =>
        assets.find((a) => a.id === id)?.kind === "stock" ? "robinhood" : "avalanche",
      )
    : null;
  const registry = new Registry();
  // seed mode on a local chain: stamp prices with the chain's clock, so tests that warp time keep them fresh
  let chainNow: number | null = null;
  const execRpc = process.env.EXECUTION_RPC_URL;
  const execClient = mode === "seed" && execRpc ? createPublicClient({ transport: http(execRpc) }) : null;
  const reader = (c: typeof profile.data.avalanche, urls: string[]): RpcSwapReader | null =>
    urls.length ? new RpcSwapReader(urls, { maxLogRange: BigInt(c.maxLogRange ?? 100), timeAnchorBlocks: c.timeAnchorBlocks }) : null;
  const avalanche = reader(profile.data.avalanche, avaxRpc);
  const robinhood = reader(profile.data.robinhood, rhRpc);
  const stockApi = mode === "live" ? stockApiFromEnv(profile, robinhood?.client ?? null) : null;
  if (stockApi) log.info("stock source", { provider: stockApi.name });
  const hcfg = services.marketData.history;
  const history = mode === "live" ? new PriceHistory(dateTs(hcfg.since), hcfg.barSec) : null;
  const historyFile = process.env.HISTORY_FILE;
  if (history && historyFile && history.loadFile(historyFile)) log.info("history loaded", { file: historyFile, assets: history.ids().length });
  const md = new MarketData({
    assets,
    profile,
    services,
    mode,
    avalanche,
    robinhood,
    stockApi,
    sink,
    log,
    registry,
    now: execClient ? () => chainNow ?? Math.floor(Date.now() / 1000) : undefined,
  });

  const app = Fastify();
  app.get("/internal/prices", async () => md.snapshot());
  // candles of every length from the reference markets' swaps since `history.since` (spec §9.2, §9.4)
  const INTERVAL: Record<string, number> = { "15m": 900, "1h": 3600, "4h": 14_400, "1d": 86_400, "1w": 604_800 };
  app.get<{ Params: { id: string }; Querystring: { interval?: string; limit?: string; before?: string } }>("/internal/history/:id", async (req, reply) => {
    const sec = INTERVAL[req.query.interval ?? "1d"];
    if (!sec || sec % hcfg.barSec !== 0) return reply.code(400).send({ error: "interval must be 15m, 1h, 4h, 1d or 1w" });
    const limit = Math.min(Math.max(Number(req.query.limit ?? 500) || 500, 1), 5000);
    const before = req.query.before !== undefined ? Number(req.query.before) : undefined;
    if (before !== undefined && !Number.isFinite(before)) return reply.code(400).send({ error: "before must be unix seconds" });
    if (!history) return { candles: [], coveredFrom: null };
    const now = Math.floor(Date.now() / 1000);
    const from = history.coveredFrom(req.params.id);
    // candles only where every swap has been read (a bucket half-read would show a wrong open / high / low)
    const all = history.candles(req.params.id, sec, limit, { before, until: now });
    const candles = from === null ? [] : all.filter((c) => c.t >= from);
    return { candles, coveredFrom: from };
  });
  app.get("/internal/changes", async () => {
    const now = Math.floor(Date.now() / 1000);
    const out: Record<string, { d1: number | null; d7: number | null; d30: number | null }> = {};
    if (history) for (const p of md.snapshot().prices) out[p.id] = history.changes(p.id, now, Number(p.canonical.usd));
    return { asOf: now, changes: out };
  });
  // reference-market 24h volume: per asset and the market total; null until a full window has been read
  const vcfg = services.marketData.volume;
  const volume = mode === "live" ? new Volume24h(vcfg.windowSec) : null;
  const volumeChains: ("avalanche" | "robinhood")[] = [];
  app.get("/internal/volume", async () => {
    const now = Math.floor(Date.now() / 1000);
    if (!volume || !volume.ready(volumeChains)) return { asOf: now, windowSec: vcfg.windowSec, ready: false, total: null, volume: {} };
    const t = volume.totals(now);
    return { asOf: now, windowSec: vcfg.windowSec, ready: true, total: t.total, volume: Object.fromEntries(t.byAsset) };
  });
  const port = envInt("PORT", 8080);
  await app.listen({ port, host: "0.0.0.0" });
  const hs = await startHealthServer({
    service: "market-data",
    port: envInt("HEALTH_PORT", 9105),
    registry,
    health: () => ({ ok: Date.now() - md.lastOkAt < 60_000, mode, priced: md.snapshot().prices.length }),
  });
  const loop = runLoop(
    "refresh",
    5_000,
    async () => {
      if (execClient) chainNow = Number((await execClient.getBlock()).timestamp);
      await md.refresh();
    },
    log,
  );
  // history: read every swap since `history.since` (newest first), then follow new blocks; save periodically
  let stopping = false;
  let dirty = false;
  const save = (): void => {
    if (!history || !historyFile || !dirty) return;
    try {
      history.saveFile(historyFile);
      dirty = false;
    } catch (e) {
      log.warn("history save failed", { error: e instanceof Error ? e.message : String(e) });
    }
  };
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  const follow = async (name: "avalanche" | "robinhood", rd: RpcSwapReader | null): Promise<void> => {
    if (!history || !rd) return;
    const cfg = profile.data[name];
    const jobs: HistoryJob[] = md.historyJobs()[name];
    if (!jobs.length) return;
    let sinceBlock: bigint | null = null;
    let lastLog = 0;
    const t0 = Date.now();
    while (!stopping) {
      try {
        sinceBlock ??= await rd.blockAt(history.since);
        const r = await scanHistory(history, name, rd, jobs, {
          sinceBlock,
          logRange: BigInt(cfg.historyLogRange ?? cfg.maxLogRange ?? 100),
          maxAddresses: cfg.maxLogAddresses ?? 10,
          minSwapUsd: hcfg.minSwapUsd,
          backwardRounds: 5,
          parallel: cfg.historyParallel ?? 4,
          stopped: () => stopping,
          onProgress: (p) => {
            if (Date.now() - lastLog < 30_000) return;
            lastLog = Date.now();
            const pct = Number(((p.head - p.firstBlock) * 1000n) / (p.head - p.sinceBlock + 1n)) / 10;
            log.info("history scan", { chain: name, pct, sec: Math.round((Date.now() - t0) / 1000) });
          },
        });
        if (r.swaps) dirty = true;
        if (r.complete) await sleep(hcfg.followSec * 1000);
      } catch (e) {
        const status = e instanceof Error ? (/Status: (\d+)/.exec(e.message)?.[1] ?? null) : null;
        log.warn("history scan failed", { chain: name, status, error: e instanceof Error ? e.message.split("\n")[0] : String(e) });
        await sleep(15_000);
      }
    }
  };
  // volume: read the last window of every whitelisted pool, then follow new blocks
  const followVolume = async (name: "avalanche" | "robinhood", rd: RpcSwapReader | null): Promise<void> => {
    if (!volume || !rd) return;
    const pools = md.volumePools()[name];
    if (!pools.length) return;
    volume.register(pools);
    const cfg = profile.data[name];
    const price = (id: string): number | null => {
      const p = md.snapshot().prices.find((x) => x.id === id);
      return p ? Number(p.canonical.usd) : null;
    };
    const opts = { logRange: BigInt(cfg.historyLogRange ?? cfg.maxLogRange ?? 100), maxAddresses: cfg.maxLogAddresses ?? 10, price, priority: vcfg.quotePriority, stopped: () => stopping };
    let last: bigint | null = null;
    while (!stopping) {
      try {
        const head = await rd.client.getBlockNumber();
        if (last === null) {
          const now = await rd.headTs(head);
          const from = await rd.blockAt(now - vcfg.windowSec, head, 60);
          const t0 = Date.now();
          const n = await readVolume(volume, rd, pools, from, head, opts);
          volume.setCovered(name, now - vcfg.windowSec);
          log.info("volume window read", { chain: name, swaps: n, sec: Math.round((Date.now() - t0) / 1000) });
          last = head;
        } else if (head > last) {
          await readVolume(volume, rd, pools, last + 1n, head, opts);
          last = head;
        }
        volume.prune(Math.floor(Date.now() / 1000));
        await sleep(hcfg.followSec * 1000);
      } catch (e) {
        log.warn("volume read failed", { chain: name, error: e instanceof Error ? e.message.split("\n")[0] : String(e) });
        await sleep(15_000);
      }
    }
  };
  if (volume) for (const c of ["avalanche", "robinhood"] as const) if ((c === "avalanche" ? avalanche : robinhood) && md.volumePools()[c].length) volumeChains.push(c);
  // wait for the first refresh (prices and pools known), then scan both chains in parallel
  const scanning = (async () => {
    for (let i = 0; i < 60 && !md.snapshot().prices.length && !stopping; i++) await sleep(5_000);
    await Promise.all([follow("avalanche", avalanche), follow("robinhood", robinhood), followVolume("avalanche", avalanche), followVolume("robinhood", robinhood)]);
  })();
  const saver = history && historyFile ? setInterval(save, hcfg.saveEverySec * 1000) : null;
  log.info("started", { port, mode });
  onShutdown(async () => {
    stopping = true;
    if (saver) clearInterval(saver);
    await Promise.race([scanning, sleep(10_000)]);
    save();
    await loop.stop();
    await app.close();
    await hs.close();
    if (sink) await sink.close();
  });
}

main().catch((e: unknown) => {
  createLogger("market-data").error("fatal", { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
