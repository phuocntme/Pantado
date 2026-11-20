import { describe, expect, it } from "vitest";
import { loadAssets } from "@pantado/shared";
import { annualVol, backtest, maxDrawdown, periodStart, summarize, type Candle } from "../src/analytics.js";
import { fakeApi } from "../src/api-client.js";
import { ask, SYSTEM_PROMPT, type AskReport } from "../src/harness.js";
import { ScriptedProvider } from "../src/llm.js";
import { checkNumbers, numbersIn } from "../src/numbers.js";
import { walletOf } from "../src/server.js";
import { buildTools, runTool, type ToolCtx } from "../src/tools.js";

const DAY = 86_400;
const T0 = Date.UTC(2025, 0, 1) / 1000;
/** Daily candles from closes, one per day from `start`. */
const series = (closes: number[], start = T0): Candle[] => closes.map((c, i) => ({ t: start + i * DAY, o: i ? (closes[i - 1] as number) : c, h: c * 1.01, l: c * 0.99, c }));

describe("analytics (deterministic math behind price_history / run_backtest)", () => {
  it("drawdown and volatility", () => {
    expect(maxDrawdown([100, 120, 90, 130, 65])).toBeCloseTo(0.5, 10);
    expect(annualVol([100, 100, 100])).toBe(0);
    // alternating ±10 % daily → stdev ≈ 0.1 · √(n/(n−1)), annualised × √365
    expect(annualVol([100, 110, 99, 108.9, 98.01])).toBeGreaterThan(1.5);
  });

  it("summarize: return, high/low with dates, coverage", () => {
    const c = series([10, 12, 8, 11]);
    const s = summarize(c, T0, T0 + 10 * DAY);
    expect(s).toMatchObject({ from: "2025-01-01", to: "2025-01-04", days: 4, open: 10, close: 11, returnPct: 10, coverage: "full" });
    expect(s?.high).toEqual({ price: 12.12, date: "2025-01-02" });
    expect(s?.low).toEqual({ price: 7.92, date: "2025-01-03" });
    expect(s?.maxDrawdownPct).toBeCloseTo(33.33, 1);
    // data starts 2 days after the requested start → partial
    expect(summarize(series([1, 2], T0 + 3 * DAY), T0, T0 + 9 * DAY)?.coverage).toBe("partial");
    expect(summarize([], T0, T0 + DAY)).toBeNull();
  });

  it("backtest: buy-and-hold weights, monthly reset, common history, benchmark", () => {
    const a = series(Array.from({ length: 61 }, (_, i) => 100 * 1.01 ** i)); // +1 %/day
    const b = series(Array.from({ length: 61 }, () => 50)); // flat
    const held = backtest(new Map([["a", a], ["b", b]]), new Map([["a", 0.5], ["b", 0.5]]), T0, T0 + 70 * DAY, "none", { id: "b", candles: b });
    if ("error" in held) throw new Error(held.error);
    expect(held.returnPct).toBeCloseTo(((1.01 ** 60 - 1) / 2) * 100, 1);
    expect(held).toMatchObject({ days: 61, coverage: "full", benchmark: { id: "b", returnPct: 0 } });
    const reset = backtest(new Map([["a", a], ["b", b]]), new Map([["a", 0.5], ["b", 0.5]]), T0, T0 + 70 * DAY, "monthly", null);
    if ("error" in reset) throw new Error(reset.error);
    // resetting to 50/50 sells the winner: less than buy-and-hold here
    expect(reset.returnPct).toBeLessThan(held.returnPct);
    // b listed 20 days later → the common history starts then
    const late = backtest(new Map([["a", a], ["b", series([50, 50, 50], T0 + 20 * DAY)]]), new Map([["a", 0.5], ["b", 0.5]]), T0, T0 + 70 * DAY, "none", null);
    expect(late).toMatchObject({ from: "2025-01-21", coverage: "partial" });
    expect(backtest(new Map([["a", a]]), new Map([["a", 0.5], ["z", 0.5]]), T0, T0 + 9 * DAY, "none", null)).toEqual({ error: "not enough price history", missing: ["z"] });
  });

  it("named periods", () => {
    const now = Date.UTC(2026, 10, 15, 12) / 1000;
    expect(periodStart("ytd", now, T0)).toBe(Date.UTC(2026, 0, 1) / 1000);
    expect(periodStart("30d", now, T0)).toBe(now - 30 * DAY);
    expect(periodStart("all", now, T0)).toBe(T0);
  });
});

describe("number check (answers vs tool results)", () => {
  it("reads figures with separators, suffixes and signs; skips dates, times and addresses", () => {
    expect(numbersIn("BTC.b at $64,559.04 (−3.1%), cap $1.2B on 2026-11-15 12:30, 0xabc123")).toEqual([64559.04, -3.1, 1.2e9]);
  });
  it("passes rounded and percent-converted figures, flags invented ones", () => {
    const tool = { price: { usd: 64559.0434346 }, change24h: -0.04287704837093087, returnPct: 12.44 };
    expect(checkNumbers("BTC.b is $64,559 (-4.3% in 24h), up 12.4% over the period; 3 assets, since 2025.", [tool]).unverified).toEqual([]);
    expect(checkNumbers("Analysts expect $80,000 by March.", [tool]).unverified).toEqual([80000]);
  });
});

describe("new tools", () => {
  const assets = loadAssets();
  const limits = { minAssets: 2, maxAssets: 20, minWeightPct: 1, driftMinPct: 10, driftMaxPct: 200 };
  const now = T0 + 60 * DAY + 3600;
  const closes = Array.from({ length: 61 }, (_, i) => 10 + i / 10);
  const routes = {
    "/assets/wavax/candles*": { source: "Avalanche (on-chain)", candles: series(closes) },
    "/assets/btcb/candles*": { source: "Avalanche (on-chain)", candles: series(closes.map((c) => c * 1000)) },
    "/assets/usdc": { id: "usdc", symbol: "USDC", kind: "quote", decimals: 6, execution: { address: "0x00000000000000000000000000000000000000a1" } },
    "/assets/btcb": { id: "btcb", symbol: "BTC.b", kind: "token", decimals: 8, execution: { address: "0x00000000000000000000000000000000000000b2" } },
    "/quote/swap*": { blockNumber: "7", amountIn: "100000000", amountOut: "154321", fee: "100000", minOut: "153549" },
    "/portfolio/0x70997970c51812dc3a010c7d01b50e0d17dc79c8": { positions: [], walletTotalUsd: 0 },
  };
  const ctx = (o: Partial<ToolCtx> = {}): ToolCtx & { api: ReturnType<typeof fakeApi> } => ({
    api: fakeApi(routes),
    assets,
    limits,
    historySince: T0,
    benchmark: "wavax",
    now: () => now,
    wallet: null,
    ...o,
  }) as ToolCtx & { api: ReturnType<typeof fakeApi> };
  const tools = buildTools();

  it("price_history summarises daily candles of the period", async () => {
    const c = ctx();
    const r = await runTool(tools, "price_history", { asset: "AVAX", period: "30d" }, c);
    expect(r.isError).toBe(false);
    expect(r.result).toMatchObject({ asset: "wavax", source: "Avalanche (on-chain)", close: 16, coverage: "full", to: "2025-03-02" });
    expect(c.api.calls[0]).toMatch(/^\/assets\/wavax\/candles\?interval=1d&limit=\d+$/);
    // asking before the history start → partial
    const before = await runTool(tools, "price_history", { asset: "AVAX", from: "2024-06-01", to: "2025-01-20" }, ctx());
    expect(before.result).toMatchObject({ from: "2025-01-01", coverage: "partial" });
  });

  it("run_backtest checks weights and compares to the configured benchmark", async () => {
    expect((await runTool(tools, "run_backtest", { assets: ["AVAX", "BTC.b"], weights: [60, 30] }, ctx())).result).toEqual({ error: "weights must sum to 100" });
    const r = await runTool(tools, "run_backtest", { assets: ["AVAX", "BTC.b"], weights: [60, 40], period: "all", rebalance: "none" }, ctx());
    expect(r.isError).toBe(false);
    expect(r.result).toMatchObject({ assets: ["wavax", "btcb"], weights: [60, 40], returnPct: 60, rebalance: "none", benchmark: { id: "wavax", returnPct: 60 } });
    expect((r.result as { note: string }).note).toContain("Hypothetical");
  });

  it("get_portfolio reads only the conversation's own wallet", async () => {
    expect((await runTool(tools, "get_portfolio", {}, ctx())).result).toMatchObject({ error: expect.stringContaining("Connect a wallet") });
    const c = ctx({ wallet: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" });
    expect((await runTool(tools, "get_portfolio", {}, c)).isError).toBe(false);
    expect(c.api.calls).toEqual(["/portfolio/0x70997970c51812dc3a010c7d01b50e0d17dc79c8"]);
  });

  it("get_quote converts human amounts both ways and shows the asset card (no transaction)", async () => {
    const c = ctx();
    const r = await runTool(tools, "get_quote", { kind: "swap", from: "USDC", to: "BTC.b", amount: "100" }, c);
    expect(r.isError).toBe(false);
    expect(r.result).toMatchObject({ network: "Fuji testnet", pay: "100 USDC", receive: "0.00154321 BTC.b", minReceive: "0.00153549 BTC.b", feeUsdc: "0.1" });
    expect(r.card?.kind).toBe("asset");
    const post = c.api.calls.find((p) => p.startsWith("/quote/swap"));
    expect(post && JSON.parse(post.slice("/quote/swap ".length))).toEqual({
      tokenIn: "0x00000000000000000000000000000000000000a1",
      tokenOut: "0x00000000000000000000000000000000000000b2",
      amountIn: "100000000",
    });
  });

  it("wallet comes only from a wallet session id", () => {
    expect(walletOf("wallet:0x70997970C51812dc3A010C7d01b50e0d17dc79C8:3f1c2d4e-0000-4000-8000-000000000000")).toBe("0x70997970c51812dc3a010c7d01b50e0d17dc79c8");
    expect(walletOf("anon:abc:123")).toBeNull();
  });
});

describe("harness report", () => {
  it("collects tools, tokens and unverified figures; tells the model today's date", async () => {
    const llm = new ScriptedProvider([
      { stop: "tool_use", content: [{ type: "tool_call", id: "t1", name: "explain", input: { topic: "fees" } }], usage: { input: 100, output: 10, cacheRead: 0, cacheWrite: 50 } },
      { stop: "end", content: [{ type: "text", text: "Buying costs 0.50 %; creating costs 5 USDC; NVDA will hit $400." }], usage: { input: 200, output: 20, cacheRead: 50, cacheWrite: 0 } },
    ]);
    let rep: AskReport | null = null;
    const assets = loadAssets();
    await ask(
      llm,
      { autoModel: "a", deepModel: "d", autoMaxSteps: 4, deepMaxSteps: 12 },
      { api: fakeApi({}), assets, limits: { minAssets: 2, maxAssets: 20, minWeightPct: 1, driftMinPct: 10, driftMaxPct: 200 } },
      [],
      "what are the fees?",
      "auto",
      { meta: () => undefined, token: () => undefined, card: () => undefined, report: (r) => (rep = r) },
    );
    const r = rep as AskReport | null;
    expect(r).toMatchObject({ mode: "auto", model: "a", steps: 2, tools: ["explain"], toolErrors: 0, usage: { input: 300, output: 30, cacheRead: 50, cacheWrite: 50 } });
    expect(r?.numbers.unverified).toEqual([400]);
    expect(llm.requests[0]?.system.startsWith(SYSTEM_PROMPT)).toBe(true);
    expect(llm.requests[0]?.system).toMatch(/Today is \d{4}-\d{2}-\d{2} \(UTC\)\.$/);
  });
});

describe("eval scoring", async () => {
  const { score, costOf, median } = await import("../eval/score.js");
  const { CASES } = await import("../eval/cases.js");
  const rep = (o: Partial<AskReport>): AskReport => ({
    mode: "auto",
    model: "claude-haiku-5-5",
    steps: 2,
    tools: [],
    toolErrors: 0,
    ms: 1000,
    usage: { input: 1_000_000, output: 100_000, cacheRead: 0, cacheWrite: 0 },
    numbers: { stated: 0, unverified: [] },
    answer: "ok",
    stoppedAtLimit: false,
    ...o,
  });
  it("suite covers every intent with unique ids", () => {
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
    expect(new Set(CASES.map((c) => c.intent))).toEqual(new Set(["asset_lookup", "compare", "history", "concept_explain", "index_lookup", "index_recommend", "portfolio", "trade", "general"]));
    expect(CASES.length).toBeGreaterThanOrEqual(30);
  });
  it("passes a good answer and names every failure of a bad one", () => {
    const c = CASES.find((x) => x.id === "a2");
    if (!c) throw new Error("a2");
    expect(score(c, rep({ tools: ["get_asset"], answer: "Giá BTC.b hiện là $64,559." }), [{ kind: "asset", data: {} }])).toEqual([]);
    const bad = score(c, rep({ tools: ["draft_index"], answer: "BTC.b will hit $100000, guaranteed.", numbers: { stated: 1, unverified: [100000] }, stoppedAtLimit: true }), []);
    expect(bad).toEqual(expect.arrayContaining(["missing tool get_asset", "no asset card", "not in Vietnamese", "unverified numbers 100000", "step limit"]));
    expect(bad.some((f) => f.startsWith("forbidden"))).toBe(true);
  });
  it("cost per answer at per-million rates; median", () => {
    expect(costOf(rep({}), { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 })).toBeCloseTo(0.15, 10);
    expect(costOf(rep({}), undefined)).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});
