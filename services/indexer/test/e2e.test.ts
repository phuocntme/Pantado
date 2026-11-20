import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPublicClient, http, type PublicClient } from "viem";
import { foundry } from "viem/chains";
import { checkLevels, tx } from "@pantado/sdk";
import { advanceTime, hasFoundry, startAnvilWithDeployment, TestKit, type AnvilEnv } from "@pantado/sdk/testing";
import { findRepoRoot } from "@pantado/shared";

const run = hasFoundry() ? describe : describe.skip;
const PORT = 42_100 + Math.floor(Math.random() * 500);
const URL = `http://127.0.0.1:${PORT}`;

async function waitFor(fn: () => Promise<boolean>, ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("timeout");
}

/** Wait until the indexer has indexed the chain head. */
async function caughtUp(client: PublicClient): Promise<void> {
  const head = Number(await client.getBlockNumber());
  await waitFor(async () => {
    const r = await fetch(`${URL}/status`);
    const s = (await r.json()) as Record<string, { block?: { number: number } }>;
    return Object.values(s).some((c) => (c.block?.number ?? 0) >= head);
  }, 60_000);
}

run("indexer on Anvil", () => {
  let env: AnvilEnv;
  let ponder: ChildProcess;
  let kit: TestKit;
  let client: PublicClient;

  beforeAll(async () => {
    env = await startAnvilWithDeployment({ demo: true });
    kit = new TestKit(env.rpcUrl, env.deployment);
    client = createPublicClient({ chain: foundry, transport: http(env.rpcUrl) }) as PublicClient;
    const dir = mkdtempSync(join(tmpdir(), "pantado-indexer-"));
    const depFile = join(dir, "deployment.json");
    writeFileSync(depFile, JSON.stringify(env.deployment));
    ponder = spawn("npx", ["ponder", "start", "--port", String(PORT)], {
      cwd: join(findRepoRoot(), "services/indexer"),
      env: {
        ...process.env,
        PANTADO_ROOT: findRepoRoot(),
        PANTADO_PROFILE: "contest",
        PANTADO_DEPLOYMENTS: depFile,
        EXECUTION_RPC_URL: env.rpcUrl,
        PONDER_PGLITE_DIR: join(dir, "pglite"),
        DATABASE_SCHEMA: "pantado",
        INDEXER_POLL_MS: "200",
      },
      stdio: "ignore",
    });
    await waitFor(async () => (await fetch(`${URL}/ready`)).ok, 120_000);
  }, 240_000);

  afterAll(() => {
    ponder?.kill("SIGKILL");
    env?.stop();
  });

  const check = async (): Promise<void> => {
    await caughtUp(client);
    const res = await checkLevels({ indexerUrl: URL, client, lens: env.deployment.contracts.lens, toleranceWei: 1n });
    expect(res.length).toBeGreaterThan(0);
    for (const r of res) expect(r, `${r.ticker} at block ${r.block}`).toMatchObject({ ok: true });
  };

  it("level(indexer) == level(IndexLens) after every step", async () => {
    const c = env.deployment.contracts;
    const idx = await kit.createIndex(0, {
      name: "Indexer test",
      ticker: "IDXT",
      description: "level check",
      assets: ["nvda", "aapl", "btcb", "wavax"],
      weightsBps: [2500, 2500, 2500, 2500],
      mode: 2,
      driftBps: 2000,
      isPublic: true,
      usdcIn: 10_000_000_000n,
      minUnits: 0n,
    });
    await check();

    // second wallet: buy, sell part, redeem part (spec §14.5)
    await kit.fundUsdc(1, 2_000_000_000n, idx);
    await kit.send(tx.buy(idx, 1_000_000_000n, 0n, kit.account(1).address), 1);
    await check();
    const units = (await kit.reader.index(idx)).totalSupply / 20n;
    await kit.send(tx.sell(idx, units, 0n, kit.account(1).address), 1);
    await check();
    await kit.send(tx.redeem(idx, units / 2n, kit.account(1).address), 1);
    await check();

    // price moves and a rebalance fill
    await kit.shock("nvda", 14n, 10n);
    await check();
    await kit.send(tx.trigger(c.rebalancer, idx));
    await advanceTime(env.rpcUrl, 601);
    await kit.refreshPrices();
    await kit.send(tx.startPlan(c.rebalancer, idx));
    await kit.send(tx.openAuction(c.rebalancer, idx));
    const ps = await kit.reader.planState(idx);
    const aj = (await kit.reader.index(idx)).assets[ps.auction.buyIdx];
    if (!aj) throw new Error("no buy asset");
    // pay with freshly bought j (stock or token) through the router
    await kit.fundUsdc(0, 5_000_000_000n, c.swapRouter);
    await kit.send(tx.swap(c.swapRouter, c.usdc, aj, 4_000_000_000n, 0n, kit.account(0).address));
    await kit.send(tx.approve(aj, c.rebalancer));
    await kit.send(tx.fill(c.rebalancer, idx, ps.auction.lot / 2n, 2n ** 255n));
    await check();
  }, 300_000);
});
