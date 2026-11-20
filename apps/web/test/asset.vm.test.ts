import { describe, expect, it, vi } from "vitest";
import type { AssetDetail, PoolView, TradeView } from "../src/screens/asset.api";
import { logoFill } from "../src/lib/logos";
import { buildChart, niceStep } from "../src/screens/asset.chart";
import { ageText, perf, txLine } from "../src/screens/asset.states";
import { lookup, type Scope } from "../src/lib/tpl";
import { assetVM, changeOver, priceS, volume24h, type AssetInput } from "../src/screens/asset.vm";

const NOW = 1_763_000_000;
const L = (v: Scope, p: string): unknown => lookup(p, v);
const LA = (v: Scope, p: string): Record<string, unknown>[] => lookup(p, v) as Record<string, unknown>[];
const F = (v: Scope, p: string): (() => void) => lookup(p, v) as () => void;
const me = { short: "0x2c71…ab90", balanceS: "$1,620", address: "0x2c71000000000000000000000000000000000ab90" };

const nvda: AssetDetail = {
  id: "nvda",
  symbol: "NVDA",
  displaySymbol: "NVDA",
  name: "NVIDIA",
  kind: "stock",
  tier: 1,
  decimals: 18,
  color: "#76B900",
  logoURI: null,
  badge: "Reference market: Robinhood Chain (on-chain)",
  dataSource: "Reference market: Robinhood Chain (on-chain)",
  display: { chain: "robinhood", address: null },
  execution: { network: "fuji", address: "0x00000000000000000000000000000000000000aa", symbol: "pNVDA" },
  price: { usd: 169.95, ts: NOW - 30, source: "reference", fresh: true },
  risk: { sizeCapUsd: 25000, oiCapUsd: 250000, spreadBps: 15 },
  venue: { kind: "stock-venue", buysPaused: false, outstanding: "0", sizeCapUsd: 25000, oiCapUsdWad: "0", fresh: true },
};

function input(over: Partial<AssetInput> = {}): AssetInput {
  return {
    asset: nvda,
    candles: { source: "canonical (pushed)", candles: [] },
    pools: [],
    trades: [],
    board: { id: "nvda", kind: "stock", symbol: "NVDA", name: "NVIDIA", change24h: 0.031, change7d: -0.002, change30d: 0.111 },
    indexes: [],
    quote: { data: null, error: null },
    ui: { side: "Buy", amt: "500", tab: "Pools" },
    tx: { status: "idle" },
    wallet: { connected: true, chainOk: true },
    env: { network: "fuji", explorer: "https://testnet.snowtrace.io", nowSec: NOW, deployed: true, swapFeeBps: 10 },
    actions: { setSide: vi.fn(), setAmt: vi.fn(), setTab: vi.fn(), submit: vi.fn(), connect: vi.fn(), switchChain: vi.fn() },
    me,
    ...over,
  };
}

describe("assetVM", () => {
  it("binds the reference fields from live data", () => {
    const v = assetVM(input());
    expect(L(v, "a")).toMatchObject({ sym: "NVDA", execSym: "pNVDA", name: "NVIDIA", kindS: "Stock", badge: "Reference market: Robinhood Chain (on-chain)", ini2: "", avBg: logoFill("nvda") });
    expect(L(v, "pxS")).toBe("$169.95");
    expect(L(v, "capS")).toBe("$25,000");
    expect(L(v, "spreadS")).toBe("0.15%");
    expect(L(v, "routeName")).toBe("Pantado stock venue");
    expect(L(v, "liqS")).toBe("—");
    expect(L(v, "cta")).toEqual({ bg: "#F2F2F3", fg: "#0B0B0D", label: "Buy NVDA" });
    expect(L(v, "pay.sym")).toBe("USDC");
    expect(L(v, "get")).toMatchObject({ sym: "NVDA", dot: "#76B900", ini2: "", avBg: logoFill("nvda") });
    // before the on-chain quote: instant estimate, 500 USDC − 0.10 % fee at $169.95 + 0.15 % spread
    expect(L(v, "recv")).toBe("2.9347");
    expect(L(v, "fee")).toBe("$0.50");
    expect(L(v, "tabPools")).toBe(true);
    expect(L(v, "over")).toBe(false);
    expect(LA(v, "perf").map((x) => x.value)).toEqual(["+3.1%", "-0.2%", "+11.1%", "—"]);
    expect(L(v, "chg24")).toEqual({ label: "24H", value: "+3.1%", col: "#3DD68C" });
  });

  it("24h volume is the asset's market (board), not the app venue's trades; unknown as —", () => {
    const board = { id: "nvda", kind: "stock" as const, symbol: "NVDA", name: "NVIDIA", change24h: 0.031, change7d: -0.002, change30d: 0.111 };
    expect(L(assetVM(input({ board: { ...board, volume24hUsd: 1_250_000 } })), "vol24S")).toBe("$1.3M");
    expect(L(assetVM(input({ board: { ...board, volume24hUsd: null } })), "vol24S")).toBe("—");
  });

  it("formats quotes: buy receives asset units, fee in USDC", () => {
    const q = { blockNumber: "1", amountIn: "500000000", amountOut: "2940000000000000000", fee: "500000", minOut: "1" };
    const v = assetVM(input({ quote: { data: q, error: null } }));
    expect(L(v, "recv")).toBe("2.9400");
    expect(L(v, "fee")).toBe("$0.50");
  });

  it("shows the per-trade limit CTA from risk.sizeCapUsd", () => {
    const v = assetVM(input({ ui: { side: "Buy", amt: "30000", tab: "Pools" } }));
    expect(L(v, "over")).toBe(true);
    expect(L(v, "cta.label")).toBe("Max $25,000 per trade");
    expect(LA(v, "notices")[0]!.title).toBe("Above the $25,000 per-trade limit.");
    const sell = assetVM(input({ ui: { side: "Sell", amt: "200", tab: "Pools" } })); // 200 × 169.95 > 25k
    expect(L(sell, "cta.label")).toBe("Max $25,000 per trade");
    const fromQuote = assetVM(input({ quote: { data: null, error: { code: "SizeCapExceeded", message: "x" } } }));
    expect(L(fromQuote, "cta.label")).toBe("Max $25,000 per trade");
  });

  it("stale price pauses buy and sell", () => {
    const stale = { ...nvda, price: { ...nvda.price!, fresh: false, ts: NOW - 360 } };
    const v = assetVM(input({ asset: stale }));
    expect(L(v, "cta.label")).toBe("Buy paused");
    expect(LA(v, "notices")[0]).toMatchObject({ tone: "amber", title: "NVDA price is 6 minutes old." });
    const submit = vi.fn();
    const v2 = assetVM(input({ asset: stale, actions: { ...input().actions, submit } }));
    F(v2, "swap")();
    expect(submit).not.toHaveBeenCalled();
  });

  it("venue paused for one stock blocks buys only", () => {
    const paused = { ...nvda, venue: { kind: "stock-venue" as const, buysPaused: true, outstanding: "0", sizeCapUsd: 25000, oiCapUsdWad: "0", fresh: true } };
    expect(LA(assetVM(input({ asset: paused })), "notices")[0]!.title).toBe("New NVDA buys are paused.");
    const sell = assetVM(input({ asset: paused, ui: { side: "Sell", amt: "3", tab: "Pools" } }));
    expect(L(sell, "cta.label")).toBe("Sell NVDA");
    expect(L(sell, "notices")).toHaveLength(0);
  });

  it("wrong network offers a switch", () => {
    const switchChain = vi.fn();
    const v = assetVM(input({ wallet: { connected: true, chainOk: false }, actions: { ...input().actions, switchChain } }));
    expect(L(v, "cta.label")).toBe("Switch to Fuji");
    F(v, "swap")();
    expect(switchChain).toHaveBeenCalled();
  });

  it("tx states map to the States markup lines", () => {
    const p = assetVM(input({ tx: { status: "pending" } }));
    expect(L(p, "done")).toBe(true);
    expect(L(p, "status.title")).toBe("Confirm in your wallet");
    const c = assetVM(input({ tx: { status: "confirmed", hash: "0x21aa00000000000000000000000000000000000000000000000000000000004f7" } }));
    expect(L(c, "status.sub")).toBe("Confirmed on Fuji · 0x21aa…04f7");
    const f = assetVM(input({ tx: { status: "failed", error: { code: "PriceStale", message: "A price is stale." } } }));
    expect(L(f, "status")).toMatchObject({ title: "Buy failed", sub: "A price is stale." });
  });

  it("trades and pools rows", () => {
    const trades: TradeView[] = [{ id: "1", source: "stock-venue", side: "sell", amount: "5000000000000000000", usdc: "848700000", account: "0xc03b0000000000000000000000000000000e4a1", ts: String(NOW - 660), txHash: "0x" }];
    const pools: PoolView[] = [
      { kind: "route", name: "Pantado stock venue", venue: "stock-venue", spreadBps: 15, sizeCapUsd: 25000, network: "fuji" },
      { kind: "reference", chain: "robinhood", address: "0x1234000000000000000000000000000000005678", dex: "uniswap-v4" },
    ];
    const v = assetVM(input({ trades, pools, ui: { side: "Buy", amt: "500", tab: "Transactions" } }));
    expect(LA(v, "txs")[0]).toEqual({ time: "11m ago", side: "Sell", px: "$169.74", amt: "5.0000", value: "$848.70", wallet: "0xc03b…e4a1", col: "#FF6B6B" });
    expect(LA(v, "poolRows")[0]).toMatchObject({ name: "Pantado stock venue", sub: "Avalanche Fuji · fills your trade", pair: "pNVDA / USDC", price: "$169.95", role: "route", vol: "$849" });
    expect(LA(v, "poolRows")[1]).toMatchObject({ name: "Reference pool", sub: "Robinhood Chain · sets the price", role: "source", price: "—" });
    expect(L(v, "tabTx")).toBe(true);
  });

  it("lists the public indexes holding the asset", () => {
    const ix = { id: "0xabc", ticker: "TBB", name: "Tech + BTC Balanced", description: "", creator: "0x1", isPublic: true, mode: 0, driftBps: 0, assets: ["0x00000000000000000000000000000000000000AA", "0xbb"], targetBps: [2500, 7500], version: 1, supply: "0", level: "0", value: "0", volumeUsdc: "0", createdAt: "0", badge: null };
    const v = assetVM(input({ indexes: [ix] }));
    expect(L(v, "inIndexes.title")).toBe("In 1 index");
    expect(LA(v, "inIndexes.rows")[0]).toMatchObject({ name: "Tech + BTC Balanced", w: "25%", href: "/index/0xabc" });
  });

  it("unknown data renders —", () => {
    const v = assetVM(input({ asset: null, board: null, candles: null }));
    expect(L(v, "pxS")).toBe("—");
    expect(L(v, "a.sym")).toBe("—");
    expect(LA(v, "perf").every((x) => x.value === "—")).toBe(true);
    expect(L(v, "chart.empty")).toBe(true);
  });
});

describe("helpers", () => {
  it("priceS / volume / change", () => {
    expect(priceS(74357.2)).toBe("$74,357");
    expect(priceS(0.2134)).toBe("$0.2134");
    expect(priceS(null)).toBe("—");
    expect(volume24h([], NOW)).toBe(0);
    const full = Array.from({ length: 100 }, (_, k) => ({ id: String(k), source: "x", side: "buy" as const, amount: "1", usdc: "1000000", account: "0x", ts: String(NOW - k), txHash: "0x" }));
    expect(volume24h(full, NOW)).toBeNull();
    const c = { source: "x", candles: [{ t: NOW - 100 * 86400, o: 1, h: 1, l: 1, c: 100 }, { t: NOW, o: 1, h: 1, l: 1, c: 110 }] };
    expect(changeOver(c, 90, NOW)).toBeCloseTo(0.1);
    expect(changeOver({ source: "x", candles: [{ t: NOW - 10 * 86400, o: 1, h: 1, l: 1, c: 100 }] }, 90, NOW)).toBeNull();
  });

  it("chart layout", () => {
    expect(niceStep(60)).toBe(10);
    const day = 86400;
    const cs = Array.from({ length: 40 }, (_, k) => ({ t: 1_754_006_400 + k * day, o: 100 + k, h: 102 + k, l: 99 + k, c: 101 + k }));
    const m = buildChart(cs);
    expect(m.empty).toBe(false);
    expect(m.bars).toHaveLength(40);
    expect(m.bars[0]!.col).toBe("#3DD68C");
    expect(m.ohlc).toMatchObject({ o: "139.00", c: "140.00", chg: "+0.7%" });
    expect(m.yTicks.length).toBeGreaterThan(2);
    expect(m.xTicks.some((t) => t.label === "Aug" || t.label === "Sep")).toBe(true);
    expect(m.hasVolume).toBe(false);
  });

  it("state helpers", () => {
    expect(ageText(NOW - 360, NOW)).toBe("6 minutes");
    expect(perf("7D", -0.002).col).toBe("#FF6B6B");
    expect(txLine({ status: "idle" }, { pendingSub: "", confirmed: "", failed: "" }, "fuji", "")).toBeNull();
  });
});
