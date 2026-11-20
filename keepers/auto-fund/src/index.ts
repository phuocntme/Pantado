import { Registry } from "prom-client";
import { createChainContext, createLogger, envInt, onShutdown, requireEnv, startHealthServer, testnetAccount } from "@pantado/service-kit";
import { loadServices } from "@pantado/shared";
import { AutoFunder, createFundServer } from "./funder.js";
import { MemoryStore, redisStore } from "./store.js";

async function main(): Promise<void> {
  const log = createLogger("auto-fund");
  const ctx = createChainContext();
  if (!ctx.profile.flags.autoFundOnSignIn) throw new Error(`auto-fund is disabled in profile ${ctx.profile.profile}`);
  const svc = loadServices();
  const account = testnetAccount("KEEPER_AUTO_FUND_KEY", ctx.chain.id);
  // the once-per-wallet ledger lives in Redis; only a local Anvil chain (the dev stack) may keep it in memory
  const store = ctx.chain.id === 31337 && !process.env.REDIS_URL ? new MemoryStore() : await redisStore(requireEnv("REDIS_URL"));
  const registry = new Registry();
  const funder = new AutoFunder(
    ctx,
    account,
    store,
    {
      usdc: svc.keepers.autoFund.usdc,
      avax: svc.keepers.autoFund.avax,
      embeddedAvax: svc.keepers.autoFund.embeddedAvax,
      secret: requireEnv("AUTO_FUND_SECRET"),
      network: ctx.profile.execution.network,
      minKeeperAvax: svc.monitoring.keeperMinAvax,
    },
    log,
    registry,
  );
  const api = createFundServer(funder);
  const port = envInt("PORT", 9104);
  await new Promise<void>((r) => api.listen(port, r));
  const hs = await startHealthServer({ service: "auto-fund", port: envInt("HEALTH_PORT", 9114), registry, health: () => funder.health() });
  log.info("started", { keeper: account.address, port });
  onShutdown(async () => {
    api.close();
    await hs.close();
    await store.close();
  });
}

main().catch((e: unknown) => {
  createLogger("auto-fund").error("fatal", { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
