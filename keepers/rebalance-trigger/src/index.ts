import { Registry } from "prom-client";
import { createChainContext, createLogger, envInt, onShutdown, runLoop, startHealthServer, testnetAccount } from "@pantado/service-kit";
import { loadServices } from "@pantado/shared";
import { RebalanceTrigger } from "./trigger.js";

async function main(): Promise<void> {
  const log = createLogger("rebalance-trigger");
  const pollSec = loadServices().keepers.rebalanceTriggerPollSec;
  const ctx = createChainContext();
  const account = testnetAccount("KEEPER_TRIGGER_KEY", ctx.chain.id);
  const registry = new Registry();
  const keeper = new RebalanceTrigger(ctx, account, log, registry);
  const hs = await startHealthServer({
    service: "rebalance-trigger",
    port: envInt("PORT", 9102),
    registry,
    health: () => ({ ok: Date.now() - keeper.lastOkAt < pollSec * 3000 + 30_000, lastOkAt: keeper.lastOkAt }),
  });
  const loop = runLoop("trigger", pollSec * 1000, async () => void (await keeper.tick()), log);
  log.info("started", { keeper: account.address, pollSec });
  onShutdown(async () => {
    await loop.stop();
    await hs.close();
  });
}

main().catch((e: unknown) => {
  createLogger("rebalance-trigger").error("fatal", { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
