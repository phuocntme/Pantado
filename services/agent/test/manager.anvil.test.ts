import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createReader, rebalancerAbi } from "@pantado/sdk";
import { hasFoundry, startAnvilWithDeployment, TestKit, type AnvilEnv } from "@pantado/sdk/testing";
import { ScriptedProvider, type TurnResult } from "../src/llm.js";
import { runManagerOnce, type ManagerConfig } from "../src/manager.js";

const run = hasFoundry() ? describe : describe.skip;

const propose = (weights: number[]): TurnResult => ({
  stop: "tool_use",
  content: [{ type: "tool_call", id: "p", name: "propose_version", input: { weights, rationale: "BTC share of crypto-equity flows rose; move weight from MSTR to BTC.b." } }],
});

run("agent-manager on Anvil (P8 gate: dry-run)", () => {
  let env: AnvilEnv;
  let kit: TestKit;
  const MANAGER = 3;

  beforeAll(async () => {
    env = await startAnvilWithDeployment({ demo: true });
    kit = new TestKit(env.rpcUrl, env.deployment);
    const base = { description: "", driftBps: 0, isPublic: true, usdcIn: 1_000_000_000n, minUnits: 0n };
    // the agent-manager's own Manual index (idx-cstk)
    await kit.createIndex(MANAGER, { ...base, name: "Crypto Stocks + BTC", ticker: "CSTK", assets: ["coin", "mstr", "crcl", "btcb"], weightsBps: [2500, 2500, 2500, 2500], mode: 1 });
    // someone else's Manual index with a ticker the manager also watches
    await kit.createIndex(0, { ...base, name: "Not mine", ticker: "OTHER", assets: ["nvda", "btcb"], weightsBps: [5000, 5000], mode: 1 });
    // the manager's Auto index
    await kit.createIndex(MANAGER, { ...base, name: "Auto one", ticker: "AUTO", assets: ["nvda", "btcb"], weightsBps: [5000, 5000], mode: 2 });
  }, 240_000);
  afterAll(() => env?.stop());

  const deps = (llm: ScriptedProvider) => ({
    reader: createReader(kit.pub, env.deployment),
    client: kit.pub,
    account: kit.account(MANAGER),
    send: (req: { to: `0x${string}`; data: `0x${string}` }) => kit.send(req, MANAGER),
    llm,
    rebalancer: env.deployment.contracts.rebalancer,
    now: () => Math.floor(Date.now() / 1000),
  });
  const cfg = (dryRun: boolean): ManagerConfig => ({ tickers: ["CSTK", "OTHER", "AUTO"], model: "deep", minIntervalSec: 604800, minChangePct: 3, dryRun });

  it("dry-run: proposes on its own Manual index only, simulation passes, nothing is sent", async () => {
    const llm = new ScriptedProvider([propose([25, 15, 25, 35])]);
    const out = await runManagerOnce(deps(llm), cfg(true));
    expect(out.map((o) => [o.ticker, o.action])).toEqual([
      ["CSTK", "proposed"],
      ["OTHER", "skipped"],
      ["AUTO", "skipped"],
    ]);
    expect(out[0]).toMatchObject({ dryRun: true, simulated: "ok", proposal: { weights: [25, 15, 25, 35] } });
    expect(out[1]).toMatchObject({ reason: "not owned by the agent-manager" });
    expect(out[2]).toMatchObject({ reason: "not in Manual mode" });
    expect(llm.requests).toHaveLength(1); // the LLM is only consulted for indexes the manager may act on
    const ps = await kit.reader.planState(await kit.reader.indexByTicker("CSTK"));
    expect(ps.plan.status).toBe(0); // nothing published
  });

  it("small changes are skipped (no churn)", async () => {
    const out = await runManagerOnce(deps(new ScriptedProvider([propose([26, 24, 25, 25])])), cfg(true));
    expect(out[0]).toMatchObject({ action: "skipped", reason: "change 1% below 3%" });
  });

  it("live: publishes through the Rebalancer; the plan waits for the notice like any other", async () => {
    const out = await runManagerOnce(deps(new ScriptedProvider([propose([25, 15, 25, 35])])), { ...cfg(false), tickers: ["CSTK"] });
    expect(out[0]?.action).toBe("published");
    const idx = await kit.reader.indexByTicker("CSTK");
    const ps = await kit.reader.planState(idx);
    expect(ps.plan.status).toBe(1); // Scheduled
    expect(ps.plan.startAt).toBeGreaterThan(BigInt(await kit.now()));
    const p = await kit.pub.readContract({ address: env.deployment.contracts.rebalancer, abi: rebalancerAbi, functionName: "params" });
    expect(Number(ps.plan.startAt) - (await kit.now())).toBeLessThanOrEqual(Number(p.noticeSec));
    // a second run while the plan is scheduled does nothing
    const again = await runManagerOnce(deps(new ScriptedProvider([])), { ...cfg(false), tickers: ["CSTK"] });
    expect(again[0]).toMatchObject({ action: "skipped", reason: "a plan is already scheduled or running" });
  });
});
