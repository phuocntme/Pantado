import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadAssets } from "@pantado/shared";
import { fakeApi } from "../src/api-client.js";
import { assess } from "../src/assessment.js";
import { resolveAssetId, validateDraft } from "../src/draft.js";
import { ask } from "../src/harness.js";
import { LlmError, ScriptedProvider, type LlmProvider, type TurnResult } from "../src/llm.js";
import { validateProposal } from "../src/manager.js";
import { buildAgentServer, memorySessions, withoutReasoning } from "../src/server.js";
import { buildTools, runTool, type Card } from "../src/tools.js";

const fx = (f: string): unknown => JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", f), "utf8"));
const assets = loadAssets();
const limits = { minAssets: 2, maxAssets: 20, minWeightPct: 1, driftMinPct: 10, driftMaxPct: 200 };
const api = () => fakeApi(fx("api.json") as Record<string, unknown>);
const harness = { autoModel: "auto-model", deepModel: "deep-model", autoMaxSteps: 4, deepMaxSteps: 12 };

describe("draft validation (spec §5.9, §10.2)", () => {
  it("resolves symbols to registry ids", () => {
    expect(resolveAssetId("BTC.b", assets)).toBe("btcb");
    expect(resolveAssetId("AVAX", assets)).toBe("wavax");
    expect(resolveAssetId("usdc", assets)).toBeNull();
    expect(resolveAssetId("DOGE", assets)).toBeNull();
  });
  it("accepts a valid draft and normalises the ticker", () => {
    const r = validateDraft({ name: "Chips", ticker: "chip", components: ["NVDA", "amd"], weights: [60, 40], mode: "Manual" }, assets, limits);
    expect(r).toMatchObject({ ok: true, draft: { ticker: "CHIP", components: ["nvda", "amd"], driftPct: null } });
  });
  it("rejects every §5 limit", () => {
    const bad = validateDraft(
      { name: "", ticker: "TOOLONG1", components: ["NVDA", "NVDA", "DOGE"], weights: [50, 0, 49], mode: "Auto", driftPct: 5 },
      assets,
      limits,
    );
    expect(bad.ok).toBe(false);
    const errs = bad.ok ? [] : bad.errors.join(" | ");
    for (const e of ["name", "ticker", "twice", "DOGE is not a listed", "each at least 1%", "sum to 100", "drift threshold"]) expect(errs).toContain(e);
  });
});

describe("tools (recorded API fixtures)", () => {
  const ctx = () => ({ api: api(), assets, limits });
  it("get_asset returns an asset card with the reference badge", async () => {
    const out = await runTool(buildTools(), "get_asset", { asset: "NVDA" }, ctx());
    expect(out.isError).toBe(false);
    expect(out.card?.kind).toBe("asset");
    expect((out.card?.data as { badge: string }).badge).toBe("Reference market: Robinhood Chain (on-chain)");
  });
  it("draft_index applies the preset through the API, never invented weights", async () => {
    const c = ctx();
    const out = await runTool(buildTools(), "draft_index", { name: "AI Chips", ticker: "CHIPB", components: ["NVDA", "AMD", "AVGO", "TSM", "BTC.b"], preset: "equal", rationale: "x" }, c);
    expect(out.card?.kind).toBe("draft");
    expect((out.card?.data as { weights: number[] }).weights).toEqual([20, 20, 20, 20, 20]);
    expect(c.api.calls.some((p) => p.startsWith("/presets"))).toBe(true);
  });
  it("invalid tool input is an error result, not a throw", async () => {
    const out = await runTool(buildTools(), "get_presets", { assets: ["nvda"], preset: "equal" }, ctx());
    expect(out.isError).toBe(true);
  });
  it("explain uses protocol numbers", async () => {
    const out = await runTool(buildTools(), "explain", { topic: "fees" }, ctx());
    expect(JSON.stringify(out.result)).toContain("0.50 %");
  });
});

describe("harness", () => {
  it("'make me an AI chips index with some BTC' → draft card with a Create link", async () => {
    const llm = new ScriptedProvider(fx("chips-draft.turns.json") as TurnResult[]);
    const cards: Card[] = [];
    let text = "";
    await ask(llm, harness, { api: api(), assets, limits }, [], "make me an AI chips index with some BTC", "auto", {
      meta: () => undefined,
      token: (t) => (text += t),
      card: (c) => cards.push(c),
    });
    expect(cards).toHaveLength(1);
    const d = cards[0]?.data as { ticker: string; link: string; mode: string; driftPct: number };
    expect(d).toMatchObject({ ticker: "CHIPB", mode: "Auto", driftPct: 20 });
    expect(d.link).toMatch(/^\/create\?draft=/);
    expect(text).toContain("Review it in Create");
    // the tool result went back to the model
    expect(JSON.stringify(llm.requests[1]?.turns.at(-1))).toContain("tool_result");
    expect(llm.requests[0]?.model).toBe("auto-model");
  });

  it("respects the Auto step cap (≤ 4 model turns)", async () => {
    const loop: TurnResult = { stop: "tool_use", content: [{ type: "tool_call", id: "x", name: "explain", input: { topic: "level" } }] };
    const llm = new ScriptedProvider(Array.from({ length: 10 }, () => structuredClone(loop)));
    await ask(llm, harness, { api: api(), assets, limits }, [], "loop", "auto", { meta: () => undefined, token: () => undefined, card: () => undefined });
    expect(llm.requests).toHaveLength(4);
  });

  it("never runs tool calls from a truncated turn", async () => {
    const llm = new ScriptedProvider([{ stop: "max_tokens", content: [{ type: "tool_call", id: "x", name: "get_asset", input: { asset: "NVDA" } }] }]);
    const cards: Card[] = [];
    const turns = await ask(llm, harness, { api: api(), assets, limits }, [], "q", "deep", { meta: () => undefined, token: () => undefined, card: (c) => cards.push(c) });
    expect(cards).toHaveLength(0);
    expect(turns.at(-1)?.role).toBe("user");
  });
});

describe("server", () => {
  it("POST /ask streams SSE meta/token/card/done and keeps history per session", async () => {
    const llm = new ScriptedProvider([...(fx("chips-draft.turns.json") as TurnResult[]), { stop: "end", content: [{ type: "text", text: "ok" }] }]);
    const sessions = memorySessions();
    const app = buildAgentServer({ llm, api: api(), assets, limits, harness, sessions, tradeFeeBps: 50 });
    const r = await app.inject({ method: "POST", url: "/ask", payload: { message: "make me an AI chips index with some BTC", mode: "auto", sessionId: "anon-12345678" } });
    expect(r.headers["content-type"]).toContain("text/event-stream");
    const events = r.body.split("\n\n").filter(Boolean).map((b) => b.split("\n")[0]?.replace("event: ", ""));
    expect(events).toEqual(expect.arrayContaining(["token", "card", "meta", "done"]));
    expect(events.at(-1)).toBe("done");
    expect((await sessions.get("anon-12345678")).length).toBeGreaterThan(1);
    await app.inject({ method: "POST", url: "/ask", payload: { message: "thanks", mode: "auto", sessionId: "anon-12345678" } });
    expect(llm.requests.at(-1)?.turns[0]?.content[0]).toMatchObject({ type: "text", text: "make me an AI chips index with some BTC" });
    await app.close();
  });
  it("over a real socket the answer is not aborted; a client that leaves mid-answer aborts the model call", async () => {
    let seen: AbortSignal | undefined;
    let release = (): void => undefined;
    const llm: LlmProvider = {
      name: "slow",
      async turn(req) {
        seen = req.signal;
        if (JSON.stringify(req.turns).includes("leave")) {
          await new Promise<void>((r) => {
            release = r;
            req.signal?.addEventListener("abort", () => r());
          });
          throw new LlmError("aborted", false);
        }
        await new Promise((r) => setTimeout(r, 50));
        req.onText?.("hello");
        return { stop: "end", content: [{ type: "text", text: "hello" }] };
      },
    };
    const app = buildAgentServer({ llm, api: api(), assets, limits, harness, sessions: memorySessions(), tradeFeeBps: 50 });
    const url = await app.listen({ port: 0, host: "127.0.0.1" });
    const body = (message: string) => JSON.stringify({ message, mode: "auto", sessionId: "anon-12345678" });
    const r = await fetch(`${url}/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: body("hi") });
    const text = await r.text();
    expect(text).toContain("event: token");
    expect(text).toContain("event: done");
    expect(seen?.aborted).toBe(false);

    seen = undefined;
    const cur = (): AbortSignal | undefined => seen; // read after the awaits below
    const ctrl = new AbortController();
    const leaving = fetch(`${url}/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: body("leave"), signal: ctrl.signal }).catch(() => null);
    for (let i = 0; i < 100 && !cur(); i++) await new Promise((r) => setTimeout(r, 10)); // the model call is running
    expect(cur()?.aborted).toBe(false);
    ctrl.abort();
    await leaving;
    for (let i = 0; i < 100 && !cur()?.aborted; i++) await new Promise((r) => setTimeout(r, 10));
    expect(cur()?.aborted).toBe(true);
    release();
    await app.close();
  });
  it("stored history drops completed answers' reasoning blocks (their signatures bind to a prefix that trimming changes); a tool loop keeps them", async () => {
    const thinking = { type: "opaque" as const, provider: "anthropic", raw: { type: "thinking", thinking: "", signature: "sig" } };
    const llm = new ScriptedProvider([
      { stop: "tool_use", content: [thinking, { type: "tool_call", id: "t1", name: "explain", input: { topic: "fees" } }] },
      { stop: "end", content: [thinking, { type: "text", text: "0.5 %" }] },
      { stop: "end", content: [{ type: "text", text: "What does redeem cost?\nHow are creator fees split?\nWhat does a swap cost?" }] }, // follow-ups
      { stop: "end", content: [{ type: "text", text: "ok" }] },
    ]);
    const sessions = memorySessions();
    const app = buildAgentServer({ llm, api: api(), assets, limits, harness, sessions, tradeFeeBps: 50 });
    await app.inject({ method: "POST", url: "/ask", payload: { message: "fees?", mode: "auto", sessionId: "anon-12345678" } });
    // inside the first answer's tool loop the thinking block was replayed with its tool call
    expect(JSON.stringify(llm.requests[1]?.turns)).toContain('"signature":"sig"');
    // stored without it, and the next question's history carries none
    expect(JSON.stringify(await sessions.get("anon-12345678"))).not.toContain("signature");
    await app.inject({ method: "POST", url: "/ask", payload: { message: "thanks", mode: "auto", sessionId: "anon-12345678" } });
    expect(JSON.stringify(llm.requests[3]?.turns)).not.toContain("signature");
    expect(llm.requests[3]?.turns.at(-1)?.content[0]).toMatchObject({ type: "text", text: "thanks" });
    // an old session stored before this fix is cleaned when read
    expect(withoutReasoning([{ role: "user", content: [{ type: "text", text: "q" }] }, { role: "assistant", content: [thinking, { type: "text", text: "a" }] }])).toEqual([
      { role: "user", content: [{ type: "text", text: "q" }] },
      { role: "assistant", content: [{ type: "text", text: "a" }] },
    ]);
    await app.close();
  });
  it("after the answer, three follow-ups on that exchange are sent as `related` (fast model, no tools)", async () => {
    const llm = new ScriptedProvider([
      { stop: "end", content: [{ type: "text", text: "NVDA is down 2.4% today." }] },
      { stop: "end", content: [{ type: "text", text: "1. How did NVDA do over 90 days?\n- Which chip stocks fell most today?\n• Compare NVDA with AMD\nok" }] },
    ]);
    const app = buildAgentServer({ llm, api: api(), assets, limits, harness, sessions: memorySessions(), tradeFeeBps: 50 });
    const r = await app.inject({ method: "POST", url: "/ask", payload: { message: "How is NVDA today?", mode: "deep", sessionId: "anon-12345678" } });
    const ev = r.body.split("\n\n").find((b) => b.startsWith("event: related"));
    expect(JSON.parse(ev?.split("data: ")[1] ?? "{}")).toEqual({ questions: ["How did NVDA do over 90 days?", "Which chip stocks fell most today?", "Compare NVDA with AMD"] });
    const f = llm.requests[1];
    expect(f?.model).toBe(harness.autoModel);
    expect(f?.tools).toEqual([]);
    expect(JSON.stringify(f?.turns)).toContain("NVDA is down 2.4% today.");
    await app.close();
  });
  it("rejects bad requests", async () => {
    const app = buildAgentServer({ llm: new ScriptedProvider([]), api: api(), assets, limits, harness, sessions: memorySessions(), tradeFeeBps: 50 });
    expect((await app.inject({ method: "POST", url: "/ask", payload: { message: "" } })).statusCode).toBe(400);
    await app.close();
  });
});

describe("assessment (spec §10.3)", () => {
  it("is built from data-layer numbers", () => {
    const a = assess({
      legs: [
        { id: "nvda", symbol: "NVDA", kind: "stock", currentBps: 6000, targetBps: 5000 },
        { id: "btcb", symbol: "BTC.b", kind: "token", currentBps: 4000, targetBps: 5000 },
      ],
      levels: Array.from({ length: 30 }, (_, i) => ({ ts: i * 86400, level: 100 * (1 + 0.01 * Math.sin(i)) })),
      sizeCapUsd: { nvda: 25000, btcb: null },
      plans: [{ status: "Completed", loss: 1, value: 1000 }],
      tradeFeeBps: 50,
      spreadBps: { nvda: 15, btcb: 30 },
    });
    expect(a.concentration).toMatchObject({ topAsset: "NVDA", topPct: 60, label: "concentrated" });
    expect(a.split).toEqual({ stocksPct: 50, tokensPct: 50 });
    expect(a.sizeCaps).toEqual({ maxBuyUsd: 41666, limitingAsset: "NVDA" });
    expect(a.feeDrag.roundTripPct).toBe(1.45);
    expect(a.volatility.annualizedPct).toBeGreaterThan(0);
    expect(a.rebalances).toEqual({ plans: 1, completed: 1, avgLossPct: 0.1 });
  });
});

describe("manager proposal validation", () => {
  it("same assets, whole percents ≥ 1, sum 100, rationale", () => {
    expect(validateProposal({ weights: [50, 50], rationale: "BTC dominance rose this month." }, 2)).toMatchObject({ weights: [50, 50] });
    expect(validateProposal({ weights: [50, 50], rationale: "x" }, 2)).toBe("rationale required");
    expect(validateProposal({ weights: [99, 0], rationale: "long enough reason" }, 2)).toContain("≥ 1");
    expect(validateProposal({ weights: [50, 50, 0], rationale: "long enough reason" }, 2)).toContain("need 2");
  });
});
