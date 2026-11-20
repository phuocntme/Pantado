import { Registry } from "prom-client";
import { createChainContext, createLogger, envInt, onShutdown, runLoop, startHealthServer, testnetAccount } from "@pantado/service-kit";
import { loadServices, toE18 } from "@pantado/shared";
import { AuctionFiller } from "./filler.js";

async function main(): Promise<void> {
  const log = createLogger("auction-filler");
  const cfg = loadServices().keepers.auctionFiller;
  const ctx = createChainContext();
  const account = testnetAccount("KEEPER_FILLER_KEY", ctx.chain.id);
  const registry = new Registry();
  const filler = new AuctionFiller(ctx, account, { minEdgeBps: cfg.minEdgeBps, maxFillUsdE18: toE18(cfg.maxFillUsd) }, log, registry);
  const hs = await startHealthServer({
    service: "auction-filler",
    port: envInt("PORT", 9103),
    registry,
    health: () => ({ ok: Date.now() - filler.lastOkAt < cfg.pollSec * 3000 + 30_000, lastOkAt: filler.lastOkAt }),
  });
  const loop = runLoop("fill", cfg.pollSec * 1000, async () => void (await filler.tick()), log);
  log.info("started", { filler: account.address, pollSec: cfg.pollSec, minEdgeBps: cfg.minEdgeBps });
  onShutdown(async () => {
    await loop.stop();
    await hs.close();
  });
}

main().catch((e: unknown) => {
  createLogger("auction-filler").error("fatal", { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
