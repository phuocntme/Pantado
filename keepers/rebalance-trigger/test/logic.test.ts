import { describe, expect, it } from "vitest";
import { nextAction, Status, Mode, type IndexView } from "../src/logic.js";

const p = { maxDurationSec: 14 * 86400, dailyCapBps: 500 };
const v = (o: Partial<IndexView> = {}): IndexView => ({
  mode: Mode.Auto,
  planStatus: Status.None,
  planStartAt: 0,
  planStartedAt: 0,
  valueAtStart: 10_000n * 10n ** 18n,
  auctionLive: false,
  tradedLast24h: 0n,
  due: false,
  ...o,
});

describe("nextAction", () => {
  it("triggers Auto when due only", () => {
    expect(nextAction(v(), 0, p)).toBeNull();
    expect(nextAction(v({ due: true }), 0, p)).toBe("trigger");
    expect(nextAction(v({ due: true, mode: Mode.Manual }), 0, p)).toBeNull();
  });
  it("starts after the notice", () => {
    expect(nextAction(v({ planStatus: Status.Scheduled, planStartAt: 100 }), 99, p)).toBeNull();
    expect(nextAction(v({ planStatus: Status.Scheduled, planStartAt: 100 }), 100, p)).toBe("startPlan");
  });
  it("opens auctions while the daily cap allows", () => {
    const active = { planStatus: Status.Active, planStartedAt: 0 };
    expect(nextAction(v(active), 10, p)).toBe("openAuction");
    expect(nextAction(v({ ...active, auctionLive: true }), 10, p)).toBeNull();
    expect(nextAction(v({ ...active, tradedLast24h: 500n * 10n ** 18n }), 10, p)).toBeNull();
  });
  it("finalizes expired plans and syncs Off", () => {
    expect(nextAction(v({ planStatus: Status.Active, planStartedAt: 0 }), 14 * 86400 + 1, p)).toBe("finalize");
    expect(nextAction(v({ mode: Mode.Off, planStatus: Status.Active }), 0, p)).toBe("sync");
    expect(nextAction(v({ mode: Mode.Off }), 0, p)).toBeNull();
  });
});
