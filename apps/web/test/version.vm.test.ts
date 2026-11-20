import { describe, expect, it } from "vitest";
import { blocker, versionVM, type VersionInput, type VersionState } from "../src/screens/version.vm";
import { assets, AVAX, comp, detail, holders, levels, me, NOW, NVDA, stranger } from "../src/screens/index.fixtures";

const input = (over: Partial<VersionInput> = {}): VersionInput => ({ detail: detail(), comp: comp(), holders, levels, assets, me, now: NOW, ...over });
const st = (over: Partial<VersionState> = {}): VersionState => ({ w: {}, when: "48h", reason: "", done: false, pending: false, ...over });

describe("versionVM", () => {
  it("starts from the current targets and names the next version", () => {
    const v = versionVM(input(), st(), { setWeight: () => undefined, setWhen: () => undefined, schedule: () => undefined });
    expect(v.heading).toBe("Propose version 2");
    expect(v.nextName).toBe("Version 2");
    expect(v.name).toBe("Tech + BTC Balanced");
    expect(v.holdersS).toBe("2");
    expect(v.rows.map((r) => [r.t, r.old, r.w, r.delta])).toEqual([
      ["NVDA", 60, 60, "—"],
      ["AVAX", 40, 40, "—"],
    ]);
    expect(v.rows[0]?.c).toBe("#76B900");
    expect(v.total).toBe(100);
    expect(v.disabled).toBe("true");
    expect(v.cta.label).toBe("Change at least one weight");
    expect(v.summary).toBe("No changes yet");
    expect(v.cost).toBe("—");
  });

  it("schedules bps weights (each ≥ 100, sum 10 000) for the creator of a Manual index", () => {
    let sent: number[] | null = null;
    const w = { [NVDA.toLowerCase()]: 70, [AVAX.toLowerCase()]: 30 };
    const v = versionVM(input(), st({ w, reason: "AVAX pool depth fell" }), { setWeight: () => undefined, setWhen: () => undefined, schedule: (b) => (sent = b) });
    expect(v.summary).toBe("NVDA 60 → 70% · AVAX 40 → 30%");
    expect(v.turn).toBe("10%");
    expect(v.disabled).toBe("false");
    expect(v.cta).toEqual({ bg: "#F2F2F3", fg: "#0B0B0D", label: "Schedule version 2" });
    v.schedule();
    expect(sent).toEqual([7000, 3000]);
  });

  it("blocks bad weights, missing reason, strangers, non-Manual and plans in progress", () => {
    const h = { setWeight: () => undefined, setWhen: () => undefined, schedule: () => undefined };
    const n = NVDA.toLowerCase();
    const a = AVAX.toLowerCase();
    expect(versionVM(input(), st({ w: { [n]: 70 }, reason: "x" }), h).cta.label).toBe("Weights must total 100%");
    expect(versionVM(input(), st({ w: { [n]: 100, [a]: 0 }, reason: "x" }), h).cta.label).toBe("Each weight must be at least 1%");
    expect(versionVM(input(), st({ w: { [n]: 70, [a]: 30 } }), h).cta.label).toBe("Add a reason for holders");
    expect(versionVM(input({ me: stranger }), st({ w: { [n]: 70, [a]: 30 }, reason: "x" }), h).disabled).toBe("true");
    expect(blocker(detail(), stranger.address)).toBe("notCreator");
    expect(blocker(detail({ mode: 2 }), me.address)).toBe("notManual");
    expect(blocker(detail({ plan: { mode: 1, version: 2, status: 1, startAt: "0", auctionLive: false, pendingMode: null, pendingAt: null } }), me.address)).toBe("planInProgress");
    expect(blocker(detail(), me.address)).toBeNull();
    expect(blocker(null, me.address)).toBe("loading");
  });

  it("uses the contract start time once scheduled", () => {
    const d = detail({ version: 2, plan: { mode: 1, version: 2, status: 1, startAt: String(NOW + 48 * 3600), auctionLive: false, pendingMode: null, pendingAt: null } });
    const v = versionVM(input({ detail: d }), st({ done: true, when: "7 days" }), { setWeight: () => undefined, setWhen: () => undefined, schedule: () => undefined });
    expect(v.whenText).toBe("in 48h");
    expect(v.whens.find((x) => x.on === "true")?.label).toBe("7 days");
  });
});
