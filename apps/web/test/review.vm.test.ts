import { describe, expect, it, vi } from "vitest";
import { lookup, type Scope } from "../src/lib/tpl";
import type { IndexView } from "../src/screens/asset.api";
import { changeText, levelCandles, reviewVM, type ReviewInput } from "../src/screens/review.vm";

const L = (v: Scope, p: string): unknown => lookup(p, v);
const LA = (v: Scope, p: string): Record<string, unknown>[] => lookup(p, v) as Record<string, unknown>[];
const F = (v: Scope, p: string): (() => void) => lookup(p, v) as () => void;
const NOW = 1_763_000_000;
const E18 = 10n ** 18n;

const ix: IndexView = {
  id: "0x00000000000000000000000000000000000000ab",
  ticker: "TBB",
  name: "Tech + BTC Balanced",
  description: "",
  creator: "0x2c71000000000000000000000000000000000ab90",
  isPublic: true,
  mode: 1,
  driftBps: 0,
  assets: ["0xaa", "0xbb"],
  targetBps: [5000, 5000],
  version: 2,
  supply: String(100n * E18),
  level: String(10702n * 10n ** 16n),
  value: "0",
  volumeUsdc: "2400000000000",
  createdAt: "0",
  badge: "Traded on Fuji testnet",
};

function input(over: Partial<ReviewInput> = {}): ReviewInput {
  return {
    ix,
    comp: {
      level: String(10702n * 10n ** 16n),
      allFresh: true,
      legs: [
        { asset: "0xaa", id: "nvda", symbol: "NVDA", kind: "stock", priceWad: String(16995n * 10n ** 16n), fresh: true, currentBps: "5000", targetBps: 5000 },
        { asset: "0xbb", id: "btcb", symbol: "BTC.b", kind: "token", priceWad: String(74357n * E18), fresh: true, currentBps: "5000", targetBps: 5000 },
      ],
    },
    board: [
      { id: ix.id, kind: "index", symbol: "TBB", name: ix.name, change24h: 0.0134, change7d: 0.0926, change30d: -0.0559 },
      { id: "nvda", kind: "stock", symbol: "NVDA", name: "NVIDIA", change24h: 0.031, change7d: null, change30d: 0.111 },
    ],
    assets: [],
    levels: [],
    events: [{ kind: "buy", account: "0x4f2a0000000000000000000000000000000091c0", usdc: "1250000000", units: String(1168n * 10n ** 16n), data: null, ts: String(NOW - 120), txHash: "0x" }],
    holders: [{ holder: ix.creator, units: String(1840n * E18), shareBps: 820 }],
    versions: [
      { version: 1, targetBps: [5000, 5000], reason: "Launch", startAt: null, ts: String(NOW - 90 * 86400) },
      { version: 2, targetBps: [6000, 4000], reason: "AVAX pool depth fell", startAt: String(NOW + 18 * 3600), ts: String(NOW - 3600) },
    ],
    assessment: { concentration: { label: "moderate" }, volatility: { annualizedPct: 27.2 }, notes: ["Stocks and crypto offset each other."] },
    quote: {
      data: { side: "buy", fee: "5000000", units: String(930n * 10n ** 16n), minUnits: String(925n * 10n ** 16n), legs: [{ asset: "0xaa", venue: "stock-venue", spendUsdc: "497500000", expectedOut: String(29273n * 10n ** 14n) }] },
      error: null,
    },
    ui: { side: "Buy", amt: "1000", tab: "Composition", step: "review" },
    tx: { status: "idle" },
    wallet: { connected: true, chainOk: true },
    env: { network: "fuji", explorer: "", nowSec: NOW },
    actions: { setSide: vi.fn(), setAmt: vi.fn(), setTab: vi.fn(), sign: vi.fn(), back: vi.fn(), connect: vi.fn(), switchChain: vi.fn() },
    me: { short: "", balanceS: "—", address: null },
    ...over,
  };
}

describe("reviewVM", () => {
  it("index page fields from live data", () => {
    const v = reviewVM(input());
    expect(L(v, "ix")).toMatchObject({ name: "Tech + BTC Balanced", ticker: "TBB", byS: "by 0x2c71…ab90", levelS: "107.02", holdersS: "1", boughtS: "$2.4M", volS: "27%" });
    expect(L(v, "chg24")).toMatchObject({ value: "+7.02%" });
    expect(LA(v, "perf").map((p) => p.value)).toEqual(["+1.34%", "+9.26%", "-5.59%", "+7.02%"]);
    expect(L(v, "mix")).toMatchObject({ stocksS: "Stocks 50%", tokensS: "Tokens 50%" });
    expect(L(v, "note")).toBe("1 TBB = $107.02, backed by the 2 assets held in the index vault");
    expect(LA(v, "rows")[0]).toMatchObject({ t: "NVDA", kind: "Stock", w: 50, px: "$169.95", d: "+3.1%", m: "+11.1%", liq: "—" });
    expect(LA(v, "rows")[1]).toMatchObject({ px: "$74,357", d: "—" });
    expect(LA(v, "txs")[0]).toMatchObject({ time: "2m ago", type: "Buy", value: "$1,250.00", units: "11.68", wallet: "0x4f2a…91c0" });
    expect(LA(v, "holders")[0]).toMatchObject({ units: "1,840.0", share: "8.2%", creator: true });
    expect(L(v, "assess")).toMatchObject({ text: "Stocks and crypto offset each other.", tag1: "Moderate" });
  });

  it("versions and the scheduled-version banner", () => {
    const v = reviewVM(input());
    expect(LA(v, "versions").map((x) => x.status)).toEqual(["Scheduled", "Live"]);
    expect(LA(v, "versions")[0]!.change).toBe("NVDA 50 → 60% · BTC.b 50 → 40%");
    expect(L(v, "banner")).toEqual({ title: "Version 2 in 18h", change: "NVDA 50 → 60% · BTC.b 50 → 40%" });
    expect(changeText(null, [1, 2], ["a", "b"])).toBe("Created with 2 assets");
  });

  it("review modal from the basket quote", () => {
    const v = reviewVM(input());
    expect(L(v, "isReview")).toBe(true);
    expect(L(v, "payS")).toBe("$1,000.00");
    expect(L(v, "unitsArrow")).toBe("→ 9.30 TBB");
    expect(L(v, "feeS")).toBe("$5.00");
    expect(L(v, "creatorFeeS")).toBe("0.20% · $2.00");
    expect(L(v, "minS")).toBe("9.25 TBB");
    expect(L(v, "signText")).toBe("One signature mints 9.30 TBB.");
    expect(LA(v, "legsR")[0]).toMatchObject({ t: "NVDA", w: 50, route: "Stock venue · reference price", got: "2.9273 NVDA" });
    expect(L(v, "heldS")).toBe("9.30 · $995.29");
    const sign = vi.fn();
    F(reviewVM(input({ actions: { ...input().actions, sign } })), "toSign")();
    expect(sign).toHaveBeenCalled();
  });

  it("stale price shows the stale state with redeem hint", () => {
    const c = input().comp!;
    const v = reviewVM(input({ comp: { ...c, allFresh: false, legs: [{ ...c.legs[0]!, fresh: false }, c.legs[1]!] } }));
    expect(LA(v, "notices")[0]).toMatchObject({ tone: "amber", body: "Buying and selling Tech + BTC Balanced is paused until it updates. You can still redeem from Portfolio." });
  });

  it("level candles bucket per day", () => {
    const k = levelCandles([
      { ts: "86400", level: String(100n * E18) },
      { ts: "90000", level: String(102n * E18) },
      { ts: "172800", level: String(101n * E18) },
    ]);
    expect(k).toEqual([
      { t: 86400, o: 100, h: 102, l: 100, c: 102 },
      { t: 172800, o: 101, h: 101, l: 101, c: 101 },
    ]);
  });
});
