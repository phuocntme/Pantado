import { Registry } from "prom-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { advanceTime, ANVIL_KEYS, hasFoundry, startAnvilWithDeployment, TestKit, type AnvilEnv } from "@pantado/sdk/testing";
import { tx } from "@pantado/sdk";
import { privateKeyToAccount } from "viem/accounts";
import { createChainContext, createLogger } from "@pantado/service-kit";
import { AuctionFiller } from "../src/filler.js";

const run = hasFoundry() ? describe : describe.skip;
const filler = privateKeyToAccount(ANVIL_KEYS[3]);

run("auction-filler on Anvil", () => {
  let env: AnvilEnv;
  beforeAll(async () => {
    env = await startAnvilWithDeployment({ demo: true, filler: filler.address });
  }, 180_000);
  afterAll(() => env?.stop());

  it("waits for edge, then fills via the router and stays flat", async () => {
    const kit = new TestKit(env.rpcUrl, env.deployment);
    const rb = env.deployment.contracts.rebalancer;
    const idx = await kit.createIndex(0, {
      name: "Filler test",
      ticker: "FILL",
      description: "",
      assets: ["nvda", "aapl", "btcb", "wavax"],
      weightsBps: [2500, 2500, 2500, 2500],
      mode: 2,
      driftBps: 2000,
      isPublic: true,
      usdcIn: 10_000_000_000n,
      minUnits: 0n,
    });
    await kit.shock("nvda", 14n, 10n);
    await kit.send(tx.trigger(rb, idx));
    await advanceTime(env.rpcUrl, 601);
    await kit.refreshPrices();
    await kit.send(tx.startPlan(rb, idx));
    await kit.send(tx.openAuction(rb, idx));

    const ctx = createChainContext({ profile: "contest", rpcUrl: env.rpcUrl, deployment: env.deployment });
    const keeper = new AuctionFiller(ctx, filler, { minEdgeBps: 0, maxFillUsdE18: 100_000n * 10n ** 18n }, createLogger("test"), new Registry());
    expect(await keeper.tick()).toEqual([]); // starts at a 0.5 % premium: no edge yet
    await advanceTime(env.rpcUrl, 600); // price passes the reference at ~9 min
    const filled = await keeper.tick();
    expect(filled).toHaveLength(1);
    const ps = await kit.reader.planState(idx);
    expect(ps.auction.filled).toBe(ps.auction.lot);
    expect(ps.plan.traded).toBeGreaterThan(0n);
    // filler's edge is the vault's small loss, always inside the plan's loss budget
    expect(ps.plan.loss).toBeGreaterThanOrEqual(0n);
    expect(ps.plan.loss).toBeLessThanOrEqual(ps.plan.lossBudget);
    // unwound: holds no pNVDA
    const [, , nvdaBal] = await Promise.all([0, 0, kit.pub.readContract({
      address: kit.asset("nvda"),
      abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] }] as const,
      functionName: "balanceOf",
      args: [filler.address],
    })]);
    expect(nvdaBal).toBe(0n);
  }, 180_000);
});
