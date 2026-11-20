import { Registry } from "prom-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { priceOracleAbi } from "@pantado/sdk";
import { advanceTime, ANVIL_KEYS, hasFoundry, startAnvilWithDeployment, type AnvilEnv } from "@pantado/sdk/testing";
import { createChainContext, createLogger } from "@pantado/service-kit";
import { startFakePriceServer, type FakePriceServer } from "@pantado/service-kit/testing";
import { loadAssets, loadServices } from "@pantado/shared";
import { PricePusher } from "../src/pusher.js";
import { httpPriceSource } from "../src/config.js";

const run = hasFoundry() ? describe : describe.skip;
const account = privateKeyToAccount(ANVIL_KEYS[2]);

run("price-pusher on Anvil", () => {
  let env: AnvilEnv;
  let fake: FakePriceServer;
  const assets = loadAssets().filter((a) => a.kind !== "quote");
  const svc = loadServices();

  beforeAll(async () => {
    env = await startAnvilWithDeployment({ pusher: account.address });
    fake = await startFakePriceServer(Object.fromEntries(assets.map((a) => [a.id, Number(a.price.seedUsd)])));
  }, 180_000);
  afterAll(async () => {
    env?.stop();
    await fake?.close();
  });

  it("keeps every price fresh and within 25 bps for 30 minutes; skips on source disagreement", async () => {
    const ctx = createChainContext({ profile: "contest", rpcUrl: env.rpcUrl, deployment: env.deployment });
    const pusher = new PricePusher({
      ctx,
      account,
      fetchPrices: httpPriceSource(fake.url),
      cfg: {
        pushIntervalSec: svc.marketData.pushIntervalSec,
        moveBps: svc.marketData.moveBps,
        deviationBps: svc.marketData.deviationBps,
      },
      log: createLogger("test", {}),
      registry: new Registry(),
      assetIds: assets.map((a) => a.id),
    });
    await pusher.init();
    const oracle = env.deployment.contracts.oracle;

    let seed = 42;
    const rand = (): number => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const ticks = (30 * 60) / svc.marketData.pushIntervalSec; // 30 min of 30 s ticks
    for (let i = 0; i < ticks; i++) {
      const now = Number((await ctx.publicClient.getBlock()).timestamp);
      fake.setTime(now);
      fake.step(40, rand); // up to ±0.4 % per 30 s
      await pusher.tick();
      for (const a of assets) {
        const addr = env.deployment.assets[a.id] as `0x${string}`;
        const [fresh, latest] = await Promise.all([
          ctx.publicClient.readContract({ address: oracle, abi: priceOracleAbi, functionName: "isFresh", args: [addr] }),
          ctx.publicClient.readContract({ address: oracle, abi: priceOracleAbi, functionName: "latest", args: [addr] }),
        ]);
        expect(fresh, `${a.id} fresh at tick ${i}`).toBe(true);
        const onchain = Number(latest[0]) / 1e18;
        const gapBps = (Math.abs(onchain - fake.get(a.id)) / fake.get(a.id)) * 10_000;
        expect(gapBps, `${a.id} gap at tick ${i}`).toBeLessThanOrEqual(svc.marketData.moveBps + 0.01);
      }
      await advanceTime(env.rpcUrl, svc.marketData.pushIntervalSec);
    }

    // sources disagree on NVDA → no push → price goes stale by design; others stay fresh
    const now = Number((await ctx.publicClient.getBlock()).timestamp);
    fake.setTime(now);
    fake.setCrossCheck("nvda", fake.get("nvda") * 1.03);
    const d = await pusher.tick();
    expect(d.skips.find((s) => s.id === "nvda")?.reason).toBe("deviation");
    expect(d.pushes.find((p) => p.id === "nvda")).toBeUndefined();
  }, 600_000);

  it("re-reads on-chain bands: a retuned asset is skipped, the rest still push", async () => {
    const ctx = createChainContext({ profile: "contest", rpcUrl: env.rpcUrl, deployment: env.deployment });
    const pusher = new PricePusher({
      ctx,
      account,
      fetchPrices: httpPriceSource(fake.url),
      cfg: { pushIntervalSec: svc.marketData.pushIntervalSec, moveBps: svc.marketData.moveBps, deviationBps: svc.marketData.deviationBps },
      log: createLogger("test", {}),
      registry: new Registry(),
      assetIds: assets.map((a) => a.id),
      configRefreshMs: 0,
    });
    await pusher.init();
    const oracle = env.deployment.contracts.oracle;
    const aapl = env.deployment.assets.aapl as `0x${string}`;
    fake.setCrossCheck("nvda", fake.get("nvda")); // sources agree again
    // owner moves AAPL's band above the market: pushing the market price would revert the whole batch
    const owner = privateKeyToAccount(ANVIL_KEYS[0]);
    const px = BigInt(Math.round(fake.get("aapl") * 1e6)) * 10n ** 12n;
    await ctx.publicClient.waitForTransactionReceipt({
      hash: await ctx.wallet(owner).writeContract({ address: oracle, abi: priceOracleAbi, functionName: "configureAsset", args: [aapl, 3600n, px * 2n, px * 3n], account: owner, chain: ctx.chain }),
    });
    await advanceTime(env.rpcUrl, svc.marketData.pushIntervalSec);
    fake.setTime(Number((await ctx.publicClient.getBlock()).timestamp));
    fake.step(100, () => 0.99); // move every price ~1 % so all are due
    const d = await pusher.tick();
    expect(d.skips.find((s) => s.id === "aapl")?.reason).toBe("band");
    expect(d.pushes.length).toBeGreaterThan(10);
  }, 120_000);
});
