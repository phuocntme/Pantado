import { Registry } from "prom-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { advanceTime, hasFoundry, startAnvilWithDeployment, TestKit, type AnvilEnv } from "@pantado/sdk/testing";
import { createChainContext, createLogger } from "@pantado/service-kit";
import { RebalanceTrigger } from "../src/trigger.js";

const run = hasFoundry() ? describe : describe.skip;

run("rebalance-trigger on Anvil", () => {
  let env: AnvilEnv;
  beforeAll(async () => {
    env = await startAnvilWithDeployment({ demo: true });
  }, 180_000);
  afterAll(() => env?.stop());

  it("triggers, starts after notice, opens auctions", async () => {
    const kit = new TestKit(env.rpcUrl, env.deployment);
    const idx = await kit.createIndex(0, {
      name: "Trigger test",
      ticker: "TRIG",
      description: "",
      assets: ["nvda", "aapl", "btcb", "wavax"],
      weightsBps: [2500, 2500, 2500, 2500],
      mode: 2,
      driftBps: 2000,
      isPublic: true,
      usdcIn: 10_000_000_000n,
      minUnits: 0n,
    });
    const ctx = createChainContext({ profile: "contest", rpcUrl: env.rpcUrl, deployment: env.deployment });
    const keeper = new RebalanceTrigger(ctx, kit.account(3), createLogger("test"), new Registry());

    expect(await keeper.tick()).toEqual([]); // not due
    await kit.shock("nvda", 14n, 10n);
    expect(await keeper.tick()).toEqual([{ index: idx, action: "trigger", ok: true }]);
    expect(await keeper.tick()).toEqual([]); // notice running
    await advanceTime(env.rpcUrl, 601);
    await kit.refreshPrices();
    expect(await keeper.tick()).toEqual([{ index: idx, action: "startPlan", ok: true }]);
    expect(await keeper.tick()).toEqual([{ index: idx, action: "openAuction", ok: true }]);
    expect(await keeper.tick()).toEqual([]); // auction live
    const ps = await kit.reader.planState(idx);
    expect(ps.auctionLive).toBe(true);

    // stale prices: openAuction is simulated, refused and not sent
    await advanceTime(env.rpcUrl, 3700);
    const res = await keeper.tick();
    expect(res[0]?.ok).toBe(false);
    expect(res[0]?.error).toBe("PriceStale");
  }, 180_000);
});
