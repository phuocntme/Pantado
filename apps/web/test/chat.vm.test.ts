import { describe, expect, it } from "vitest";
import { annualVol, candleRects, dailyCloses, linePaths, maxDrawdown } from "../src/screens/chat.charts";
import { logoFill } from "../src/lib/logos";
import { askStream, parseSse, toAskEvent, type AskEvent } from "../src/screens/chat.sse";
import { anonSession, historyOf, loadConvs, ownerOf, saveConvs, SESSION_KEY, titleOf, TTL_MS, type Conversation, type KV } from "../src/screens/chat.store";
import { answerBlocks, base64url, chatVM, draftHref, metaText, relatedFor, WEIGHT_PALETTE, type CardView, type ChatInputs } from "../src/screens/chat.vm";

const me = { short: "", balanceS: "—", address: null };

const assetCard = {
  kind: "asset" as const,
  data: { id: "nvda", symbol: "NVDA", name: "NVIDIA", kind: "stock", color: "#76B900", price: { usd: 169.95 }, badge: "Reference market: Robinhood Chain (on-chain)", board: { change24h: 0.031, change30d: -0.111 } },
};
const draftCard = {
  kind: "draft" as const,
  data: { name: "Chips and Chains", ticker: "CC", components: ["nvda", "wavax"], weights: [60, 40], preset: "custom", mode: "Auto", rationale: "r", link: "/create?draft=abc" },
};
const indexCard = {
  kind: "index" as const,
  data: {
    detail: { id: "0xIDX", name: "Blue Chips", ticker: "ABC", creator: "0x2c7100000000000000000000000000000000ab90", level: "121400000000000000000", badge: "Traded on Fuji testnet" },
    composition: { legs: [{ id: "wavax", symbol: "AVAX", kind: "token", targetBps: 4000 }, { id: "nvda", symbol: "NVDA", kind: "stock", targetBps: 6000 }] },
  },
};

const conv = (o: Partial<Conversation> = {}): Conversation => ({
  id: "c1",
  title: "NVDA today",
  created: 1,
  updated: 2,
  turns: [{ q: "How is NVDA doing today?", mode: "auto", text: "NVDA is up.\n\n- One\n- Two", cards: [assetCard, draftCard, indexCard], meta: { tools: 3, ms: 1800 }, status: "done" }],
  ...o,
});

const base = (o: Partial<ChatInputs> = {}): ChatInputs => ({
  convs: [conv(), conv({ id: "c2", title: "Other", turns: [] })],
  currentId: "c1",
  search: "",
  pickConv: () => undefined,
  deleteConv: () => undefined,
  ask: () => undefined,
  assets: [
    { id: "nvda", symbol: "NVDA", kind: "stock" },
    { id: "wavax", symbol: "WAVAX", displaySymbol: "AVAX", kind: "token" },
  ],
  board: [{ id: "0xidx", kind: "index", change30d: 0.067 }],
  candles: [{ t: 0, o: 1, h: 2, l: 0.5, c: 1.5 }],
  levels: [
    { ts: 0, level: 100 },
    { ts: 86400, level: 110 },
    { ts: 2 * 86400, level: 99 },
    { ts: 3 * 86400, level: 121.4 },
  ],
  holders: 150,
  me,
  ...o,
});

describe("chatVM", () => {
  it("conversation list, title, question and meta like the reference", () => {
    const v = chatVM(base());
    const convs = v.convs as Record<string, unknown>[];
    expect(convs[0]).toMatchObject({ title: "NVDA today", on: "true", bg: "#1F1F23", fg: "#F2F2F3" });
    expect(convs[1]).toMatchObject({ on: "false", bg: "transparent" });
    expect(v).toMatchObject({ title: "NVDA today", q: "How is NVDA doing today?", meta: "3 tools · 1.8s", isAsset: true, isRec: true, isIndex: true, streaming: false });
    const turns = v.turns as { blocks: unknown[] }[];
    expect(turns[0]?.blocks).toEqual([{ kind: "p", text: "NVDA is up." }, { kind: "ul", items: ["One", "Two"] }]);
  });

  it("each history row carries its id and a delete action for that conversation", () => {
    const deleted: string[] = [];
    const convs = chatVM(base({ deleteConv: (id) => deleted.push(id) })).convs as { id: string; del: () => void }[];
    expect(convs.map((c) => c.id)).toEqual(["c1", "c2"]);
    convs[1]?.del();
    expect(deleted).toEqual(["c2"]);
  });

  it("asset card from live data, stock badge, unknown volume/liquidity as —", () => {
    const a = chatVM(base()).asset as Record<string, unknown>;
    expect(a).toMatchObject({ sym: "NVDA", name: "NVIDIA", ini2: "", dot: logoFill("nvda"), kind: "Stock", price: "$169.95", chg: "+3.1%", chgCol: "#3DD68C", m30: "-11.1%", m30Col: "#FF6B6B", vol24: "—", liq: "—", href: "/asset/nvda" });
    expect(a.badge).toBe("Reference market: Robinhood Chain (on-chain)");
  });

  it("draft card: weights, mix and the Create link; no invented backtest", () => {
    const d = chatVM(base()).draft as Record<string, unknown>;
    expect(d).toMatchObject({ name: "Chips and Chains", ret: "—", vol: "—", dd: "—", slip: "—", stocks: 60, mix: "60% stocks · 40% tokens", href: "/create?draft=abc" });
    expect(d.assets).toMatchObject([
      // by weight, each with its own palette color (the bar and the chips share them)
      { t: "NVDA", w: 60, c: WEIGHT_PALETTE[0], stock: true },
      { t: "AVAX", w: 40, c: WEIGHT_PALETTE[1], stock: false },
    ]);
  });

  it("every answer's cards are drawn the same way: older ones from their own data, the newest with live data", () => {
    const older = conv({ id: "c9", turns: [
      { q: "first", mode: "auto", text: "a", cards: [draftCard], meta: null, status: "done" },
      { q: "second", mode: "auto", text: "b", cards: [draftCard, assetCard], meta: null, status: "done" },
    ] });
    const v = chatVM(base({ convs: [older], currentId: "c9" }));
    const turns = v.turns as { views: CardView[] }[];
    const first = turns[0]?.views[0];
    expect(first?.kind).toBe("draft");
    expect(first?.scope).toMatchObject({ name: draftCard.data.name, href: expect.stringContaining("/create?draft=") });
    expect((first?.scope as { assets: { c: string }[] }).assets.map((r) => r.c)).toEqual([WEIGHT_PALETTE[0], WEIGHT_PALETTE[1]]);
    // the newest asset card carries the candles; a compare card stays compact
    expect((turns[1]?.views[1]?.scope as { candles: unknown[] }).candles.length).toBeGreaterThan(0);
  });

  it("index card: level, 30d, holders, vol/drawdown from levels, composition", () => {
    const ix = chatVM(base()).index as Record<string, unknown>;
    expect(ix).toMatchObject({ name: "Blue Chips", by: "by 0x2c71…ab90", level: "121.40", m30: "+6.7% 30d", holders: "150", dd: "-10.0%", badge: "Traded on Fuji testnet", href: "/index/0xIDX" });
    expect(ix.vol).toMatch(/^\d+%$/);
    expect(ix.comp).toMatchObject([
      { t: "NVDA", w: 60, c: WEIGHT_PALETTE[0] },
      { t: "AVAX", w: 40, c: WEIGHT_PALETTE[1] },
    ]);
  });

  it("missing data renders —; empty chat", () => {
    const v = chatVM(base({ levels: null, holders: null, board: [] }));
    expect(v.index).toMatchObject({ m30: "—", holders: "—", vol: "—", dd: "—" });
    const e = chatVM(base({ currentId: null }));
    expect(e).toMatchObject({ empty: true, title: "New chat", isAsset: false, isRec: false, isIndex: false, related: [] });
  });

  it("search filters the list; related follow-ups call ask", () => {
    let asked = "";
    const v = chatVM(base({ search: "other", ask: (t) => (asked = t) }));
    expect((v.convs as { title: string }[]).map((c) => c.title)).toEqual(["Other"]);
    const rel = v.related as { text: string; pick: () => void }[];
    expect(rel.map((r) => r.text)).toEqual(["Cap any single asset at 20%", "How often should this rebalance?", "Is there an index like this already?"]);
    rel[0]?.pick();
    expect(asked).toBe("Cap any single asset at 20%");
    expect(relatedFor(null)).toHaveLength(3);
  });

  it("helpers", () => {
    expect(metaText({ q: "", mode: "auto", text: "", cards: [], meta: { tools: 0, ms: 5 }, status: "done" })).toBe("No tools needed");
    expect(metaText({ q: "", mode: "auto", text: "", cards: [], meta: null, status: "streaming" })).toBe("Thinking…");
    expect(base64url(JSON.stringify({ a: "é" }))).toBe(Buffer.from(JSON.stringify({ a: "é" })).toString("base64url"));
    const { link, ...rest } = draftCard.data;
    void link;
    expect(draftHref(rest)).toBe(`/create?draft=${Buffer.from(JSON.stringify(rest)).toString("base64url")}`);
    expect(answerBlocks("**Bold** text\n1. a\n2) b")).toEqual([{ kind: "p", text: "Bold text" }, { kind: "ul", items: ["a", "b"] }]);
    expect(titleOf("x".repeat(60))).toHaveLength(40);
  });
});

describe("SSE", () => {
  it("parses frames across chunk boundaries", () => {
    const a = parseSse('event: meta\ndata: {"tools":2,"ms":900}\n\nevent: tok');
    expect(a.frames).toEqual([{ event: "meta", data: '{"tools":2,"ms":900}' }]);
    const b = parseSse(`${a.rest}en\r\ndata: {"text":"Hi"}\r\n\r\n: comment\n\n`);
    expect(b.frames).toEqual([{ event: "token", data: '{"text":"Hi"}' }]);
    expect(b.rest).toBe("");
  });

  it("maps frames to typed events", () => {
    expect(toAskEvent({ event: "card", data: '{"kind":"draft","data":{"x":1}}' })).toEqual({ type: "card", card: { kind: "draft", data: { x: 1 } } });
    expect(toAskEvent({ event: "card", data: '{"kind":"nope"}' })).toBeNull();
    expect(toAskEvent({ event: "done", data: "{}" })).toEqual({ type: "done" });
    expect(toAskEvent({ event: "error", data: '{"message":"Rate limited"}' })).toEqual({ type: "error", message: "Rate limited" });
    expect(toAskEvent({ event: "token", data: "not json" })).toBeNull();
  });

  it("streams a POST response", async () => {
    const body = 'event: token\ndata: {"text":"A"}\n\nevent: card\ndata: {"kind":"asset","data":{}}\n\nevent: meta\ndata: {"tools":1,"ms":10}\n\nevent: done\ndata: {}\n\n';
    const enc = new TextEncoder().encode(body);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.slice(0, 17));
        c.enqueue(enc.slice(17));
        c.close();
      },
    });
    const seen: { url: string; init: RequestInit | undefined }[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      return new Response(stream, { status: 200 });
    }) as typeof fetch;
    const evs: AskEvent[] = [];
    try {
      await askStream("http://agent", { message: "hi", mode: "auto", sessionId: "s" }, (e) => evs.push(e));
    } finally {
      globalThis.fetch = orig;
    }
    expect(seen[0]?.url).toBe("http://agent/ask");
    expect(seen[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(seen[0]?.init?.body))).toEqual({ message: "hi", mode: "auto", sessionId: "s" });
    expect(evs.map((e) => e.type)).toEqual(["token", "card", "meta", "done"]);
  });

  it("surfaces agent errors with their message", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => new Response('event: error\ndata: {"message":"Too many requests"}\n\n', { status: 200 })) as unknown as typeof fetch;
    try {
      await expect(askStream("http://agent", { message: "x", mode: "deep", sessionId: "s" }, () => undefined)).rejects.toThrow("Too many requests");
    } finally {
      globalThis.fetch = orig;
    }
  });
});

describe("chat history store", () => {
  const mem = (): KV & { m: Map<string, string> } => {
    const m = new Map<string, string>();
    return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
  };

  it("anonymous session lasts 7 days, then starts over with an empty history", () => {
    const kv = mem();
    const id = anonSession(kv, 0, () => "s1");
    expect(anonSession(kv, TTL_MS - 1, () => "s2")).toBe(id);
    saveConvs(kv, `anon:${id}`, [conv({ updated: 10 })]);
    expect(anonSession(kv, TTL_MS + 1, () => "s2")).toBe("s2");
    expect(kv.m.has("pantado-ask:anon:s1")).toBe(false);
    expect(JSON.parse(kv.m.get(SESSION_KEY) ?? "{}").id).toBe("s2");
  });

  it("history belongs to a wallet only: nothing listed or saved without one, old anonymous chats are deleted, never moved", () => {
    const kv = mem();
    const now = 1_000;
    expect(ownerOf(null)).toBeNull();
    expect(ownerOf("0xABC")).toBe("wallet:0xabc");
    // an older build kept chats for the anonymous session
    saveConvs(kv, `anon:${anonSession(kv, now)}`, [conv({ id: "a", updated: 900 })]);
    saveConvs(kv, "wallet:0xabc", [conv({ id: "w", updated: 950 })]);
    expect(historyOf(kv, null, now)).toEqual([]);
    expect(kv.m.has(`pantado-ask:anon:${anonSession(kv, now)}`)).toBe(false);
    expect(historyOf(kv, "0xABC", now).map((c) => c.id)).toEqual(["w"]); // not merged into the wallet
  });

  it("each wallet sees only its own chats, across switches and reconnects", () => {
    const kv = mem();
    const now = 1_000;
    saveConvs(kv, ownerOf("0xAAA") ?? "", [conv({ id: "a1", title: "A's question" })]);
    saveConvs(kv, ownerOf("0xBBB") ?? "", [conv({ id: "b1", title: "B's question" })]);
    expect(historyOf(kv, "0xAAA", now).map((c) => c.id)).toEqual(["a1"]);
    expect(historyOf(kv, "0xBBB", now).map((c) => c.id)).toEqual(["b1"]);
    // switching back: still only A's
    expect(historyOf(kv, "0xaaa", now).map((c) => c.id)).toEqual(["a1"]);
    // disconnected: nothing
    expect(historyOf(kv, null, now)).toEqual([]);
  });

  it("streaming turns are stored as interrupted; stale anonymous chats expire", () => {
    const kv = mem();
    saveConvs(kv, "anon:x", [conv({ updated: 0, turns: [{ q: "q", mode: "auto", text: "", cards: [], meta: null, status: "streaming" }] })]);
    expect(loadConvs(kv, "anon:x", 10)[0]?.turns[0]?.status).toBe("error");
    expect(loadConvs(kv, "anon:x", TTL_MS + 1)).toEqual([]);
  });
});

describe("chat charts", () => {
  it("line paths in the reference viewBox", () => {
    const p = linePaths([100, 110, 105]);
    expect(p?.line).toBe("0.0,137.5 200.0,12.5 400.0,75.0");
    expect(p?.area.startsWith("0,150 0.0,137.5")).toBe(true);
    expect(p?.baseY).toBe(137.5);
    expect(p?.color).toBe("#3DD68C");
    expect(linePaths([1])).toBeNull();
  });

  it("candles, daily closes, volatility and drawdown", () => {
    const r = candleRects([{ t: 0, o: 1, h: 2, l: 0, c: 0.5 }]);
    expect(r).toHaveLength(2);
    expect(r[0]?.fill).toBe("#FF6B6B");
    expect(dailyCloses([{ ts: 10, v: 1 }, { ts: 20, v: 2 }, { ts: 86400, v: 3 }])).toEqual([2, 3]);
    expect(maxDrawdown([100, 120, 90, 130])).toBeCloseTo(-0.25);
    expect(annualVol([100, 100])).toBeNull();
    expect(annualVol([100, 101, 100, 101])).toBeGreaterThan(0);
  });
});

describe("Ask home chat list", async () => {
  const { filterConvs } = await import("../src/screens/chat.store");
  it("filters by title or any question, case-insensitive", () => {
    const mk = (id: string, title: string, qs: string[]) => ({ id, title, created: 1, updated: 1, turns: qs.map((q) => ({ q, mode: "auto" as const, text: "", cards: [], meta: null, status: "done" as const })) });
    const cs = [mk("a", "NVDA today", ["How is NVDA?"]), mk("b", "Fees", ["what are the fees", "and redeem?"])];
    expect(filterConvs(cs, "").map((c) => c.id)).toEqual(["a", "b"]);
    expect(filterConvs(cs, "nvda").map((c) => c.id)).toEqual(["a"]);
    expect(filterConvs(cs, "REDEEM").map((c) => c.id)).toEqual(["b"]);
  });
});
