import { Counter, Gauge, type Registry } from "prom-client";
import { encodeFunctionData, type Account, type Address } from "viem";
import { rebalancerAbi, tx } from "@pantado/sdk";
import { listIndexes, simulateAndSend, type ChainContext, type Logger } from "@pantado/service-kit";
import { nextAction, Status, type Action, type IndexView, type TriggerParams } from "./logic.js";

export class RebalanceTrigger {
  lastOkAt = 0;
  private params: TriggerParams | null = null;
  private readonly m;

  constructor(
    private readonly ctx: ChainContext,
    private readonly account: Account,
    private readonly log: Logger,
    registry: Registry,
  ) {
    const r = [registry];
    this.m = {
      actions: new Counter({ name: "trigger_actions_total", help: "rebalance actions sent", labelNames: ["action", "result"], registers: r }),
      active: new Gauge({ name: "trigger_active_plans", help: "plans scheduled or active", registers: r }),
      balance: new Gauge({ name: "keeper_balance_avax", help: "keeper native balance", labelNames: ["keeper"], registers: r }),
    };
  }

  async view(index: Address): Promise<IndexView> {
    const r = this.ctx.reader;
    const ps = await r.planState(index);
    let due = false;
    if (ps.mode === 2 && ps.plan.status !== Status.Scheduled && ps.plan.status !== Status.Active) {
      try {
        [due] = await r.isDue(index);
      } catch {
        due = false; // stale prices: not due until they are fresh again
      }
    }
    return {
      mode: ps.mode,
      planStatus: ps.plan.status,
      planStartAt: Number(ps.plan.startAt),
      planStartedAt: Number(ps.plan.startedAt),
      valueAtStart: ps.plan.valueAtStart,
      auctionLive: ps.auctionLive,
      tradedLast24h: ps.tradedLast24h,
      due,
    };
  }

  async tick(): Promise<{ index: Address; action: Action; ok: boolean; error?: string }[]> {
    const { ctx, account, log } = this;
    if (!this.params) {
      const p = await ctx.reader.rebalancerParams();
      this.params = { maxDurationSec: Number(p.maxDurationSec), dailyCapBps: p.dailyCapBps };
    }
    const now = Number((await ctx.publicClient.getBlock()).timestamp);
    const rb = ctx.deployment.contracts.rebalancer;
    const results: { index: Address; action: Action; ok: boolean; error?: string }[] = [];
    let active = 0;
    for (const index of await listIndexes(ctx)) {
      const v = await this.view(index);
      if (v.planStatus === Status.Scheduled || v.planStatus === Status.Active) active += 1;
      const action = nextAction(v, now, this.params);
      if (!action) continue;
      const req =
        action === "trigger" ? tx.trigger(rb, index)
        : action === "startPlan" ? tx.startPlan(rb, index)
        : action === "openAuction" ? tx.openAuction(rb, index)
        : action === "finalize" ? tx.finalize(rb, index)
        : { to: rb, data: syncData(index) };
      const res = await simulateAndSend(ctx, account, req);
      this.m.actions.inc({ action, result: res.ok ? "ok" : res.error.code });
      if (res.ok) log.info(action, { index, tx: res.hash });
      else log.warn(`${action} skipped`, { index, code: res.error.code, error: res.error.message });
      results.push(res.ok ? { index, action, ok: true } : { index, action, ok: false, error: res.error.code });
    }
    this.m.active.set(active);
    this.m.balance.set({ keeper: "rebalance-trigger" }, Number(await ctx.publicClient.getBalance({ address: account.address })) / 1e18);
    this.lastOkAt = Date.now();
    return results;
  }
}

function syncData(index: Address): `0x${string}` {
  return encodeFunctionData({ abi: rebalancerAbi, functionName: "sync", args: [index] });
}
