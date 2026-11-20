import { describe, expect, it, vi } from "vitest";
import { lookup, type Scope } from "../src/lib/tpl";
import type { AssetView } from "../src/screens/asset.api";
import { bpsToPercents, cleanTicker, encodeDraft, forkPrefill, parseDraft } from "../src/screens/create.draft";
import { backtest, slippage1k } from "../src/screens/create.metrics";
import { createVM, validate, type CreateInput, type CreateState } from "../src/screens/create.vm";

const L = (v: Scope, p: string): unknown => lookup(p, v);
const LA = (v: Scope, p: string): Record<string, unknown>[] => lookup(p, v) as Record<string, unknown>[];
const F = (v: Scope, p: string): (() => void) => lookup(p, v) as () => void;
const NOW = 1_763_000_000;

const asset = (id: string, sym: string, kind: AssetView["kind"]): AssetView => ({
  id,
  symbol: sym,
  displaySymbol: sym,
  name: sym,
  kind,
  tier: null,
  decimals: 18,
  color: "#76B900",
  logoURI: null,
  badge: null,
  dataSource: "",
  display: { chain: "avalanche", address: null },
  execution: { network: "fuji", address: `0x${id.padStart(40, "0")}`, symbol: sym },
  price: { usd: 1, ts: NOW, source: "x", fresh: true },
  risk: null,
});
const ASSETS = [asset("usdc", "USDC", "quote"), asset("nvda", "NVDA", "stock"), asset("msft", "MSFT", "stock"), asset("btcb", "BTC.b", "token")];

const S: CreateState = {
  picked: ["nvda", "btcb"],
  w: { nvda: 60, btcb: 40 },
  f: "All",
  search: "",
  name: "My basket",
  ticker: "MYBK",
  description: "",
  vis: "Private",
  mode: "Auto",
  drift: 50,
  first: "100",
  step: "edit",
};

function input(over: Partial<CreateInput> = {}, s: Partial<CreateState> = {}): CreateInput {
  return {
    s: { ...S, ...s },
    assets: ASSETS,
    tickerTaken: false,
    creationFee: 5_000_000n,
    presetError: null,
    backtest: null,
    slip: null,
    quote: { data: null, error: null },
    tx: { status: "idle" },
    created: null,
    wallet: { connected: true, chainOk: true },
    env: { network: "fuji", explorer: "", nowSec: NOW, deployed: true },
    actions: { set: vi.fn(), toggle: vi.fn(), setW: vi.fn(), preset: vi.fn(), review: vi.fn(), confirm: vi.fn(), connect: vi.fn(), switchChain: vi.fn() },
    me: { short: "", balanceS: "—", address: null },
    ...over,
  };
}

describe("createVM", () => {
  it("catalog, basket and totals like the reference", () => {
    const v = createVM(input());
    expect(LA(v, "catalog").map((c) => c.sym)).toEqual(["NVDA", "MSFT", "BTC.b"]);
    expect(LA(v, "catalog")[0]).toMatchObject({ btn: "Added", on: "true", kind: "Stock" });
    expect(LA(v, "basket").map((b) => [b.sym, b.w])).toEqual([["NVDA", 60], ["BTC.b", 40]]);
    expect(L(v, "total")).toBe(100);
    expect(L(v, "totalCol")).toBe("#3DD68C");
    expect(L(v, "mixText")).toBe("Stocks 60% · Tokens 40%");
    expect(L(v, "cta")).toEqual({ bg: "#F2F2F3", fg: "#0B0B0D", label: "Review: create and buy" });
    expect(L(v, "feeLine")).toBe("Creation fee 5 USDC");
    expect(L(v, "creationFeeS")).toBe("5.00 USDC");
    expect(L(v, "modeSummary")).toBe("Auto at 50% drift");
    expect(L(v, "name")).toBe("My basket");
  });

  it("filters by chip and search", () => {
    expect(LA(createVM(input({}, { f: "Tokens" })), "catalog").map((c) => c.sym)).toEqual(["BTC.b"]);
    expect(LA(createVM(input({}, { search: "ms" })), "catalog").map((c) => c.sym)).toEqual(["MSFT"]);
  });

  it("metrics come from data or show —", () => {
    const none = createVM(input());
    expect([L(none, "ret"), L(none, "vol"), L(none, "dd"), L(none, "slip")]).toEqual(["—", "—", "—", "—"]);
    expect(L(none, "retCol")).toBe("#8E8E96");
    const v = createVM(input({ backtest: { ret: 0.124, vol: 0.48, dd: -0.21 }, slip: 0.0015 }));
    expect([L(v, "ret"), L(v, "vol"), L(v, "dd"), L(v, "slip")]).toEqual(["+12.4%", "48%", "-21.0%", "0.15%"]);
  });

  it("validation labels in reference order", () => {
    expect(validate({ ...S, w: { nvda: 50, btcb: 40 } }, false)).toBe("Weights must total 100%");
    expect(validate({ ...S, picked: ["nvda"], w: { nvda: 100 } }, false)).toBe("Add at least 2 assets");
    expect(validate({ ...S, w: { nvda: 100, btcb: 0 } }, false)).toBe("Every asset needs at least 1%");
    expect(validate({ ...S, ticker: "M" }, false)).toBe("Add a ticker");
    expect(validate(S, true)).toBe("This ticker is already taken.");
    expect(validate({ ...S, first: "99" }, false)).toBe("First buy is at least 100 USDC");
    expect(validate(S, false)).toBeNull();
    const v = createVM(input({}, { first: "50" }));
    expect(L(v, "disabled")).toBe("true");
    expect(L(v, "cta")).toEqual({ bg: "#1F1F23", fg: "#8E8E96", label: "First buy is at least 100 USDC" });
  });

  it("review step shows the create quote", () => {
    const q = { blockNumber: "1", usdcIn: "100000000", creationFee: "5000000", tradeFee: "500000", totalUsdc: "105000000", units: "995000000000000000", minUnits: "990000000000000000", levelUsd: "100", note: "" };
    const v = createVM(input({ quote: { data: q, error: null } }, { step: "review", vis: "Public" }));
    expect(L(v, "reviewing")).toBe(true);
    expect(L(v, "visLabel")).toBe("Public");
    expect(L(v, "firstS")).toBe("100.00 USDC");
    expect(L(v, "tradeFee")).toBe("0.50 USDC");
    expect(L(v, "payS")).toBe("105.00 USDC");
    expect(L(v, "unitsS")).toBe("0.99 MYBK at level 100");
    const confirm = vi.fn();
    F(createVM(input({ quote: { data: q, error: null }, actions: { ...input().actions, confirm } }, { step: "review" })), "confirm")();
    expect(confirm).toHaveBeenCalled();
  });

  it("stale price in review blocks the signature", () => {
    const confirm = vi.fn();
    const v = createVM(input({ quote: { data: null, error: { code: "PriceStale", message: "stale" } }, actions: { ...input().actions, confirm } }, { step: "review" }));
    expect(L(v, "created")).toBe(true);
    expect(LA(v, "notices")[0]!.tone).toBe("amber");
    F(v, "confirm")();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("preset unavailable keeps weights and shows the message", () => {
    const v = createVM(input({ presetError: "Market cap needs circulating supply for every asset." }));
    expect(LA(v, "notices")[0]).toMatchObject({ title: "Market cap needs circulating supply for every asset.", body: "Your weights were kept." });
    expect(LA(v, "basket").map((b) => b.w)).toEqual([60, 40]);
  });

  it("done step links to the new index", () => {
    const v = createVM(input({ created: { index: "0xabc", units: "995000000000000000" } }, { step: "done", vis: "Public" }));
    expect(L(v, "created")).toBe(true);
    expect(L(v, "createdText")).toBe("Published MYBK. You hold 0.99 units.");
    expect(L(v, "_href.IndexDetail")).toBe("/index/0xabc");
  });
});

describe("prefill", () => {
  const known = new Set(["nvda", "btcb", "msft"]);
  it("parses an agent draft (base64url JSON)", () => {
    const raw = encodeDraft({ name: "AI Compute", ticker: "ai-cmp", description: "Chips.", components: ["NVDA", "btcb", "doge"], weights: [60, 40, 10], mode: "manual", preset: "marketcap" });
    const p = parseDraft(raw, known)!;
    expect(p).toMatchObject({ name: "AI Compute", ticker: "AICMP", description: "Chips.", picked: ["nvda", "btcb"], w: { nvda: 60, btcb: 40 }, mode: "Manual", preset: "marketcap" });
    expect(parseDraft("%%%", known)).toBeNull();
  });
  it("fork copies assets and weights", () => {
    const m = new Map([["0xaa", "nvda"], ["0xbb", "btcb"]]);
    expect(forkPrefill(["0xAA", "0xBB"], [3333, 6667], m)).toEqual({ picked: ["nvda", "btcb"], w: { nvda: 33, btcb: 67 } });
  });
  it("percents sum to 100, each ≥ 1", () => {
    const p = bpsToPercents([9850, 50, 50, 50]);
    expect(p.reduce((a, b) => a + b, 0)).toBe(100);
    expect(Math.min(...p)).toBeGreaterThanOrEqual(1);
    expect(cleanTicker("ab-c1234")).toBe("ABC123");
  });
});

describe("metrics", () => {
  const day = 86400;
  const series = (f: (k: number) => number, n = 95) => Array.from({ length: n }, (_, k) => ({ t: 1_750_000_000 + k * day, c: f(k) }));
  it("backtests buy-and-hold over 90 days", () => {
    const b = backtest([series(() => 100), series((k) => 100 + k)], [50, 50])!;
    expect(b.ret).toBeGreaterThan(0);
    expect(b.dd).toBe(0);
    expect(b.vol).toBeGreaterThan(0);
  });
  it("returns null with short history", () => {
    expect(backtest([series(() => 1, 30), series(() => 1, 30)], [50, 50])).toBeNull();
  });
  it("slippage from a $1k create quote", () => {
    expect(slippage1k({ usdcIn: "1000000000", tradeFee: "5000000", units: "9935075000000000000" })).toBeCloseTo(0.0015, 6);
    expect(slippage1k(null)).toBeNull();
  });
});
