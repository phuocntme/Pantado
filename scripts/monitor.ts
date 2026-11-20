/**
 * Monitor (spec §11.3): exports cross-service checks as Prometheus metrics for alerting —
 * level(indexer) vs level(IndexLens), indexer lag, stock-venue reserve ratio and OI, auction loss vs budget.
 * Per-service metrics (price age, deviation, keeper balances, API latency) come from the services themselves.
 * Env: INDEXER_URL, EXECUTION_RPC_URL (optional), PORT (default 9110).
 */
import { Gauge, Registry } from "prom-client";
import { checkLevels, stockVenueAbi } from "@pantado/sdk";
import { createChainContext, createLogger, envInt, onShutdown, requireEnv, runLoop, startHealthServer } from "@pantado/service-kit";
import { loadServices } from "@pantado/shared";

async function main(): Promise<void> {
  const log = createLogger("monitor");
  const ctx = createChainContext();
  const indexerUrl = requireEnv("INDEXER_URL");
  const tolerance = BigInt(loadServices().monitoring.navToleranceWei);
  const registry = new Registry();
  const r = [registry];
  const g = {
    levelDiff: new Gauge({ name: "pantado_level_diff_wei", help: "|level(indexer) − level(lens)| at the indexer's block", labelNames: ["index", "ticker"], registers: r }),
    levelMismatch: new Gauge({ name: "pantado_level_mismatch", help: "1 if level(indexer) ≠ level(lens) beyond tolerance", labelNames: ["index", "ticker"], registers: r }),
    indexerLag: new Gauge({ name: "pantado_indexer_lag_blocks", help: "chain head − indexer block", registers: r }),
    reserveRatio: new Gauge({ name: "stock_venue_reserve_ratio_bps", help: "stock venue reserve / exposure in bps", registers: r }),
    exposure: new Gauge({ name: "stock_venue_exposure_usd", help: "outstanding pToken notional at mid", registers: r }),
    oi: new Gauge({ name: "stock_venue_outstanding_usd", help: "outstanding notional per pToken", labelNames: ["ptoken"], registers: r }),
    lossUsed: new Gauge({ name: "rebalance_loss_budget_used_ratio", help: "plan loss / loss budget for active plans", labelNames: ["index"], registers: r }),
  };
  let lastOk = 0;

  const tick = async (): Promise<void> => {
    const res = await checkLevels({ indexerUrl, client: ctx.publicClient, lens: ctx.deployment.contracts.lens, toleranceWei: tolerance });
    let maxBlock = 0n;
    for (const x of res) {
      g.levelDiff.set({ index: x.index, ticker: x.ticker }, Number(x.diff));
      g.levelMismatch.set({ index: x.index, ticker: x.ticker }, x.ok ? 0 : 1);
      if (x.block > maxBlock) maxBlock = x.block;
      const ps = await ctx.reader.planState(x.index);
      if (ps.plan.status === 2 && ps.plan.lossBudget > 0n) g.lossUsed.set({ index: x.index }, Number(ps.plan.loss) / Number(ps.plan.lossBudget));
      else g.lossUsed.set({ index: x.index }, 0);
    }
    const status = (await (await fetch(new URL("/status", indexerUrl))).json()) as Record<string, { block?: { number: number } }>;
    const ixBlock = Math.max(0, ...Object.values(status).map((c) => c.block?.number ?? 0));
    g.indexerLag.set(Math.max(0, Number(await ctx.publicClient.getBlockNumber()) - ixBlock));

    const v = await ctx.reader.stockVenueState();
    g.reserveRatio.set(v.reserveRatioBps > 10n ** 12n ? 1e9 : Number(v.reserveRatioBps));
    g.exposure.set(Number(v.exposureUsd) / 1e18);
    const sv = ctx.deployment.contracts.stockVenue;
    const pTokens = await ctx.publicClient.readContract({ address: sv, abi: stockVenueAbi, functionName: "pTokens" });
    for (const p of pTokens) {
      const e = await ctx.publicClient.readContract({ address: sv, abi: stockVenueAbi, functionName: "exposureUsd", args: [p] });
      g.oi.set({ ptoken: p }, Number(e) / 1e18);
    }
    lastOk = Date.now();
  };

  const hs = await startHealthServer({ service: "monitor", port: envInt("PORT", 9110), registry, health: () => ({ ok: Date.now() - lastOk < 180_000, lastOk }) });
  const loop = runLoop("monitor", 60_000, tick, log);
  log.info("started", { port: hs.port });
  onShutdown(async () => {
    await loop.stop();
    await hs.close();
  });
}

main().catch((e: unknown) => {
  createLogger("monitor").error("fatal", { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
