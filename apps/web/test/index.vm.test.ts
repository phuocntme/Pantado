import { describe, expect, it } from "vitest";
import { indexVM, volatility, type IndexInput, type IndexState } from "../src/screens/index.vm";
import { chartGeometry, dailyCandles } from "../src/screens/index.chart";
import { assets, AVAX, board, comp, detail, holders, levels, me, NOW, reb, stranger, txs } from "../src/screens/index.fixtures";

const noop = { setTab: () => undefined, setSide: () => undefined, setAmt: () => undefined };
const st = (over: Partial<IndexState> = {}): IndexState => ({ tab: "Composition", side: "Buy", amt: "1000", ...over });
const input = (over: Partial<IndexInput> = {}): IndexInput => ({
  detail: detail(),
  comp: comp(),
  txs,
  reb: reb(),
  holders,
  levels,
  assets,
  board,
  quote: null,
  quoteError: null,
  assess: null,
  now: NOW,
  me: stranger,
  ...over,
});

describe("indexVM", () => {
  it("renders header, stats and composition from the API", () => {
    const v = indexVM(input(), st(), noop);
    expect(v.name).toBe("Tech + BTC Balanced");
    expect(v.ticker).toBe("TBB");
    expect(v.badge).toBe("Traded on Fuji testnet");
    expect(v.modeLabel).toBe("Manual · creator publishes versions");
    expect(v.levelS).toBe("107.00");
    expect(v.stats.sinceS).toBe("+7.00%");
    expect(v.boughtS).toBe("$2.4M");
    expect(v.holdersS).toBe("2");
    expect(v.split).toEqual({ stocks: 60, tokens: 40 });
    expect(v.rows.map((r) => [r.t, r.kind, r.w, r.px, r.d, r.m, r.liq])).toEqual([
      ["NVDA", "Stock", 60, "$160.00", "+3.1%", "+11.1%", "—"],
      ["AVAX", "Token", 40, "$10.00", "-0.4%", "—", "—"],
    ]);
    expect(v.rows[0]?.c).toBe("#76B900");
    expect(v.tabComp).toBe(true);
  });

  it("maps transactions and holders like the reference rows", () => {
    const v = indexVM(input(), st({ tab: "Transactions" }), noop);
    expect(v.txs).toHaveLength(2);
    expect(v.txs[0]).toMatchObject({ time: "2m ago", type: "Buy", value: "$1,250.00", units: "11.68", col: "#3DD68C" });
    expect(v.txs[1]).toMatchObject({ type: "Sell", value: "$3,402.18", col: "#FF6B6B" });
    expect(v.holders[0]).toMatchObject({ units: "6.0", value: "$642", share: "60.0%", creator: true });
    expect(v.holders[1]?.creator).toBe(false);
  });

  it("uses '—' for unknown data instead of numbers", () => {
    const v = indexVM(input({ detail: null, comp: null, txs: null, holders: null, levels: null, board: null }), st(), noop);
    expect(v.name).toBe("—");
    expect(v.levelS).toBe("—");
    expect(v.holdersS).toBe("—");
    expect(v.volS).toBe("—");
    expect(v.recv).toBe("—");
    expect(v.fee).toBe("—");
    expect(v.assess.text).toBe("—");
    expect(v.chart.ohlc).toBeNull();
  });

  it("builds the trade preview from the API quote", () => {
    const quote = { side: "buy" as const, usdcIn: "1000000000", fee: "5000000", units: "9299065420560747663", minUnits: "9252570093457943925" };
    const v = indexVM(input({ quote }), st(), noop);
    expect(v.recv).toBe("9.30");
    expect(v.fee).toBe("$5.00");
    expect(v.feeLabel).toBe("Trade fee 0.50%");
    expect(v.getSym).toBe("TBB");
    expect(v.unit).toBe("USDC");
    expect(v.tokStocks).toBe(60);
    expect(v.cta.label).toBe("Buy index");
    expect(v.note).toBe("1 TBB = $107.00, backed by the 2 assets held in the index vault");
    const s = indexVM(input({ quote: { side: "sell", units: "10", fee: "5350000", gross: "1070000000", usdcOut: "1064650000", minOut: "1" } }), st({ side: "Sell", amt: "10" }), noop);
    expect(s.cta.label).toBe("Sell for $1,064.65");
    expect(s.unit).toBe("TBB");
    expect(s.getSym).toBe("USDC");
    expect(s.tokRight).toBe("#2775CA");
  });

  it("pauses buy/sell on a stale price and points to redeem", () => {
    const stale = comp();
    stale.allFresh = false;
    stale.legs[1]!.fresh = false;
    const v = indexVM(input({ comp: stale }), st(), noop);
    expect(v.trade.kind).toBe("stale");
    if (v.trade.kind === "stale") {
      expect(v.trade.title).toBe("AVAX price is out of date.");
      expect(v.trade.body).toContain("You can still redeem from Portfolio.");
    }
    expect(indexVM(input({ quoteError: { code: "PriceStale", message: "A price is stale." } }), st(), noop).trade.kind).toBe("stale");
  });

  it("surfaces per-trade limit and venue paused errors", () => {
    expect(indexVM(input({ quoteError: { code: "SizeCapExceeded", message: "This trade is above the max per trade for this stock." } }), st(), noop).trade).toMatchObject({ kind: "limit" });
    expect(indexVM(input({ quoteError: { code: "BuysPausedFor", message: "New buys are paused." } }), st(), noop).trade).toMatchObject({ kind: "paused" });
  });

  it("shows period changes from the level series", () => {
    const v = indexVM(input(), st(), noop);
    expect(v.changes.map((c) => c.label)).toEqual(["24H", "7D", "30D", "ALL"]);
    expect(v.changes[3]?.s).toBe("+7.00%");
    expect(v.changes[0]?.col).toBe("#3DD68C");
  });

  it("lists versions with the launch and a scheduled plan", () => {
    const r = reb({
      plans: [{ planId: 1, status: "Scheduled", manual: true, startAt: String(NOW + 18 * 3600), startedAt: null, endedAt: null, value: null, lossBudget: null, loss: null, traded: null }],
      versions: [{ version: 2, targetBps: [7000, 3000], reason: "AVAX pool depth fell", startAt: String(NOW + 18 * 3600), ts: String(NOW - 30 * 3600) }],
    });
    const d = detail({ version: 2, plan: { mode: 1, version: 2, status: 1, startAt: String(NOW + 18 * 3600), auctionLive: false, pendingMode: null, pendingAt: null } });
    const v = indexVM(input({ detail: d, reb: r }), st({ tab: "Rebalances" }), noop);
    expect(v.versions.map((x) => [x.name, x.status])).toEqual([
      ["Version 2", "Scheduled"],
      ["Version 1", "Live"],
    ]);
    expect(v.versions[0]?.change).toBe("NVDA 60 → 70% · AVAX 40 → 30%");
    expect(v.versions[1]?.change).toBe("Created with 2 assets");
    expect(v.banner).toEqual({ pill: "Version 2 in 18h", change: "NVDA 60 → 70% · AVAX 40 → 30%" });
    expect(v.plan?.title).toBe("Version 2 · in notice period");
    expect(v.plan?.pill).toBe("Starts in 18h");
  });

  it("reports an active plan with its auction lots and loss budget", () => {
    const E18 = 10n ** 18n;
    const r = reb({
      plans: [{ planId: 3, status: "Active", manual: true, startAt: String(NOW - 2 * 86400), startedAt: String(NOW - 2 * 86400), endedAt: null, value: (1000n * E18).toString(), lossBudget: (10n * E18).toString(), loss: (2n * E18).toString(), traded: "0" }],
      auctions: [{ planId: 3, auctionId: 1, sellAsset: AVAX, buyAsset: comp().legs[0]!.asset, lot: (5n * E18).toString(), filled: "0", endAt: String(NOW + 600), ts: String(NOW - 2100) }],
    });
    const v = indexVM(input({ reb: r }), st({ tab: "Rebalances" }), noop);
    expect(v.plan?.title).toBe("Version 1 · trading");
    expect(v.plan?.guards[1]).toMatchObject({ val: "0.2%", max: "/ 1.0% budget", w: "20%" });
    expect(v.plan?.guards[2]?.val).toBe("2 days");
    expect(v.plan?.lots).toEqual([{ n: "1", trade: "AVAX → NVDA", size: "$50", status: "Live", bg: "#2E2311", fg: "#F5B14C" }]);
  });

  it("is the same view model for the private page owner (me) as for strangers", () => {
    expect(indexVM(input({ me }), st(), noop).name).toBe(indexVM(input(), st(), noop).name);
  });
});

describe("chart", () => {
  it("builds daily candles and geometry in the reference viewBox", () => {
    const c = dailyCandles(levels.levels, txs);
    expect(c.length).toBe(41);
    expect(c[c.length - 1]?.c).toBeCloseTo(107, 6);
    const g = chartGeometry(c);
    expect(g.candles).toHaveLength(41);
    for (const x of g.candles) {
      expect(x.body.x).toBeGreaterThanOrEqual(0);
      expect(x.body.x).toBeLessThanOrEqual(1000);
      expect(x.body.y).toBeGreaterThanOrEqual(0);
      expect(x.vol.y + x.vol.h).toBeCloseTo(520, 0);
    }
    expect(g.last?.text).toBe("107.00");
    expect(g.yLabels.length).toBeGreaterThan(1);
    expect(chartGeometry([]).ohlc).toBeNull();
  });

  it("annualises daily volatility only with enough history", () => {
    expect(volatility([100, 101])).toBeNull();
    expect(volatility(Array.from({ length: 30 }, () => 100))).toBe(0);
  });
});

describe("Ask agent from an index page", () => {
  it("asks about this index by name, ticker and address, in Auto mode", async () => {
    const { askAboutIndex } = await import("../src/screens/index.vm");
    const { askHref } = await import("../src/screens/ask.vm");
    const q = askAboutIndex("Avalanche DEX Index", "AVDEX", "0x0000000000000000000000000000000000000abc");
    expect(q).toContain("Avalanche DEX Index (AVDEX)");
    expect(q).toContain("how it has performed");
    expect(q).toMatch(/0x0{37}abc$/);
    expect(askHref(q, "Auto")).toBe(`/ask?q=${encodeURIComponent(q)}&mode=auto`);
  });
});
