/** Status values of `Rebalancer.Status`. */
export const Status = { None: 0, Scheduled: 1, Active: 2, Completed: 3, Stopped: 4, Expired: 5, Cancelled: 6 } as const;
export const Mode = { Off: 0, Manual: 1, Auto: 2 } as const;

export interface IndexView {
  mode: number;
  planStatus: number;
  planStartAt: number;
  planStartedAt: number;
  valueAtStart: bigint;
  auctionLive: boolean;
  tradedLast24h: bigint;
  due: boolean;
}

export interface TriggerParams {
  maxDurationSec: number;
  dailyCapBps: number;
}

export type Action = "trigger" | "startPlan" | "openAuction" | "finalize" | "sync";

/** Next action for one index, or null. Pure; the contract enforces every guard again. */
export function nextAction(v: IndexView, now: number, p: TriggerParams): Action | null {
  const inPlan = v.planStatus === Status.Scheduled || v.planStatus === Status.Active;
  if (v.mode === Mode.Off) return inPlan ? "sync" : null;
  if (v.planStatus === Status.Scheduled) return now >= v.planStartAt ? "startPlan" : null;
  if (v.planStatus === Status.Active) {
    if (now > v.planStartedAt + p.maxDurationSec) return "finalize";
    if (v.auctionLive) return null;
    const cap = (v.valueAtStart * BigInt(p.dailyCapBps)) / 10_000n;
    const minLot = v.valueAtStart / 10_000n;
    return v.tradedLast24h + minLot <= cap ? "openAuction" : null;
  }
  return v.mode === Mode.Auto && v.due ? "trigger" : null;
}
