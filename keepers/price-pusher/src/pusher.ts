import { Counter, Gauge, type Registry } from "prom-client";
import type { Account } from "viem";
import { priceOracleAbi, toPantadoError, tx } from "@pantado/sdk";
import type { ChainContext, Logger } from "@pantado/service-kit";
import type { InternalPrices } from "@pantado/shared";
import { decide, type Decision, type OnchainAsset, type PushConfig } from "./logic.js";

export interface PusherDeps {
  ctx: ChainContext;
  account: Account;
  fetchPrices: () => Promise<InternalPrices>;
  cfg: PushConfig;
  log: Logger;
  registry: Registry;
  /** Asset ids to push (registry assets except the fixed-price quote). */
  assetIds: string[];
  /** Re-read on-chain configs (bands, max age) this often, and after any failed push. Default 60 s. */
  configRefreshMs?: number;
}

export class PricePusher {
  private assets: OnchainAsset[] = [];
  private loadedAt = 0;
  lastOkAt = 0;
  lastError: string | null = null;
  private readonly m;

  constructor(private readonly d: PusherDeps) {
    const r = [d.registry];
    this.m = {
      pushes: new Counter({ name: "pusher_pushes_total", help: "prices pushed", labelNames: ["asset", "reason"], registers: r }),
      skips: new Counter({ name: "pusher_skips_total", help: "prices skipped", labelNames: ["asset", "reason"], registers: r }),
      deviation: new Gauge({ name: "pusher_deviation_alert", help: "1 while canonical and cross-check disagree", labelNames: ["asset"], registers: r }),
      age: new Gauge({ name: "pusher_onchain_price_age_seconds", help: "age of the on-chain price", labelNames: ["asset"], registers: r }),
      lastTick: new Gauge({ name: "pusher_last_ok_timestamp_seconds", help: "last successful tick", registers: r }),
      balance: new Gauge({ name: "keeper_balance_avax", help: "keeper native balance", labelNames: ["keeper"], registers: r }),
    };
  }

  /** Load on-chain configs and last prices for every asset. */
  async init(): Promise<void> {
    const { publicClient: pc, deployment } = this.d.ctx;
    this.assets = await Promise.all(
      this.d.assetIds.map(async (id): Promise<OnchainAsset> => {
        const address = deployment.assets[id];
        if (!address) throw new Error(`asset ${id} not in deployment`);
        const [cfg, latest] = await Promise.all([
          pc.readContract({ address: deployment.contracts.oracle, abi: priceOracleAbi, functionName: "configs", args: [address] }),
          pc.readContract({ address: deployment.contracts.oracle, abi: priceOracleAbi, functionName: "latest", args: [address] }),
        ]);
        const [maxAgeSec, , , bandMin, bandMax] = cfg;
        return {
          id,
          address,
          lastPriceE18: latest[0],
          lastPushedAt: Number(latest[1]),
          bandMinE18: bandMin,
          bandMaxE18: bandMax,
          maxAgeSec: Number(maxAgeSec),
        };
      }),
    );
    this.loadedAt = Date.now();
  }

  async tick(): Promise<Decision> {
    const { ctx, account, log } = this.d;
    // the owner may retune a band or max age at any time: an out-of-band push would revert the whole batch
    if (Date.now() - this.loadedAt >= (this.d.configRefreshMs ?? 60_000)) await this.init();
    const block = await ctx.publicClient.getBlock();
    const now = Number(block.timestamp);
    const prices = await this.d.fetchPrices();
    const decision = decide(this.assets, prices.prices, now, this.d.cfg);

    for (const s of decision.skips) {
      this.m.skips.inc({ asset: s.id, reason: s.reason });
      if (s.reason === "deviation") log.warn("price sources disagree — not pushing", { asset: s.id, detail: s.detail });
      else log.warn("price skipped", { asset: s.id, reason: s.reason, detail: s.detail });
    }
    const devIds = new Set(decision.skips.filter((s) => s.reason === "deviation").map((s) => s.id));
    for (const a of this.assets) this.m.deviation.set({ asset: a.id }, devIds.has(a.id) ? 1 : 0);

    if (decision.pushes.length > 0) {
      const req = tx.pushPrices(
        ctx.deployment.contracts.oracle,
        decision.pushes.map((p) => p.address),
        decision.pushes.map((p) => p.priceE18),
      );
      try {
        const hash = await ctx.wallet(account).sendTransaction({ ...req, account, chain: ctx.chain });
        const rc = await ctx.publicClient.waitForTransactionReceipt({ hash });
        if (rc.status !== "success") throw new Error(`push reverted: ${hash}`);
        const pushedAt = Number((await ctx.publicClient.getBlock({ blockNumber: rc.blockNumber })).timestamp);
        for (const p of decision.pushes) {
          const a = this.assets.find((x) => x.id === p.id);
          if (a) {
            a.lastPriceE18 = p.priceE18;
            a.lastPushedAt = pushedAt;
          }
          this.m.pushes.inc({ asset: p.id, reason: p.reason });
        }
        log.info("pushed", { count: decision.pushes.length, tx: hash });
      } catch (e) {
        const pe = toPantadoError(e);
        this.lastError = pe.message;
        this.loadedAt = 0; // re-read configs before the next attempt
        throw pe;
      }
    }
    for (const a of this.assets) this.m.age.set({ asset: a.id }, Math.max(0, now - a.lastPushedAt));
    const bal = await ctx.publicClient.getBalance({ address: account.address });
    this.m.balance.set({ keeper: "price-pusher" }, Number(bal) / 1e18);
    this.lastOkAt = Date.now();
    this.lastError = null;
    this.m.lastTick.set(Math.floor(this.lastOkAt / 1000));
    return decision;
  }

  health(tickSec: number): { ok: boolean; lastOkAt: number; lastError: string | null; assets: number } {
    const fresh = Date.now() - this.lastOkAt < tickSec * 3000 + 30_000;
    return { ok: this.lastOkAt > 0 && fresh, lastOkAt: this.lastOkAt, lastError: this.lastError, assets: this.assets.length };
  }
}
