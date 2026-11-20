import { Registry } from "prom-client";
import { createChainContext, createLogger, onShutdown, runLoop, startHealthServer, testnetAccount } from "@pantado/service-kit";
import { httpPriceSource, loadPusherConfig } from "./config.js";
import { PricePusher } from "./pusher.js";

async function main(): Promise<void> {
  const log = createLogger("price-pusher");
  const cfg = loadPusherConfig();
  const ctx = createChainContext();
  const account = testnetAccount("KEEPER_PRICE_PUSHER_KEY", ctx.chain.id);
  const registry = new Registry();
  const pusher = new PricePusher({
    ctx,
    account,
    fetchPrices: httpPriceSource(cfg.marketDataUrl),
    cfg: cfg.push,
    log,
    registry,
    assetIds: cfg.assetIds,
  });
  await pusher.init();
  const hs = await startHealthServer({ service: "price-pusher", port: cfg.port, registry, health: () => pusher.health(cfg.tickSec) });
  const loop = runLoop("push", cfg.tickSec * 1000, async () => void (await pusher.tick()), log);
  log.info("started", { pusher: account.address, port: hs.port, assets: cfg.assetIds.length });
  onShutdown(async () => {
    await loop.stop();
    await hs.close();
  });
}

main().catch((e: unknown) => {
  createLogger("price-pusher").error("fatal", { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
