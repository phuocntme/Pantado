import { DOWN, UP, pct, withInitials } from "../lib/fmt";
import { short } from "../lib/nav";
import { logoFill } from "../lib/logos";
import type { Me } from "../lib/chrome";
import type { Scope } from "../lib/tpl";
import { annualVol, dailyCloses, maxDrawdown, type Candle } from "./chat.charts";
import type { AgentCard } from "./chat.sse";
import type { Conversation, Turn } from "./chat.store";

// ------------------------------------------------------------------ card payloads (services/agent tools)

/** `asset` card: `/assets/:id` view + its `/board` row. */
export interface AssetCardData {
  id: string;
  symbol: string;
  displaySymbol?: string;
  name: string;
  kind: "stock" | "token" | "quote";
  color?: string;
  price: { usd: number } | null;
  badge?: string | null;
  board: { change24h: number | null; change7d?: number | null; change30d: number | null } | null;
}

/** `draft` card: the validated draft (spec §10.2) + its Create link. */
export interface DraftCardData {
  name: string;
  ticker: string;
  description?: string;
  components: string[];
  weights: number[];
  preset?: string;
  mode?: string;
  rationale?: string;
  link?: string;
}

/** `index` card: `/indexes/:id` + `/indexes/:id/composition`. */
export interface IndexCardData {
  detail: { id: string; name: string; ticker: string; creator: string; level: string; badge?: string | null };
  composition: { level?: string; legs: { id: string | null; symbol: string | null; kind: string | null; targetBps: number | string; currentBps?: number | string }[] };
}

/** `compare` card: `/board` rows (or `{ id, missing }`). */
export interface CompareRow {
  id: string;
  symbol?: string;
  name?: string;
  kind?: string;
  color?: string;
  price?: { usd: number } | null;
  change24h?: number | null;
  change30d?: number | null;
  missing?: boolean;
}

export interface AssetLite {
  id: string;
  symbol: string;
  displaySymbol?: string;
  kind: "stock" | "token" | "quote";
  color?: string;
}
export interface BoardLite {
  id: string;
  kind: string;
  change30d: number | null;
}

// ------------------------------------------------------------------ helpers

const GREY = "#8E8E96";
const colOf = (s: string): string => (s === "—" ? GREY : s.charAt(0) === "-" ? DOWN : UP);
const ini = (s: string): string => s.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase();

export function usd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const d = n >= 1000 ? 0 : n >= 1 ? 2 : 4;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}

/** base64url of the UTF-8 JSON (same encoding the agent uses for `/create?draft=`). */
export function base64url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** "Create from this" target for a draft card. */
export function draftHref(d: DraftCardData): string {
  if (typeof d.link === "string" && d.link.startsWith("/create?draft=")) return d.link;
  const { link, ...draft } = d;
  void link;
  return `/create?draft=${base64url(JSON.stringify(draft))}`;
}

export type Block = { kind: "p"; text: string } | { kind: "ul"; items: string[] };

/** Answer text → paragraphs and bullet lists (light markdown: `- `, `* `, `• `, `1. `; `**` dropped). */
export function answerBlocks(text: string): Block[] {
  const out: Block[] = [];
  const clean = (s: string): string => s.replace(/\*\*/g, "").replace(/^#+\s*/, "").trim();
  for (const chunk of text.replace(/\r\n?/g, "\n").split(/\n{2,}/)) {
    const lines = chunk.split("\n").filter((l) => l.trim());
    let para: string[] = [];
    let items: string[] = [];
    const flushP = (): void => {
      if (para.length) out.push({ kind: "p", text: clean(para.join(" ")) });
      para = [];
    };
    const flushL = (): void => {
      if (items.length) out.push({ kind: "ul", items });
      items = [];
    };
    for (const l of lines) {
      const m = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(l);
      if (m) {
        flushP();
        items.push(clean(m[1] ?? ""));
      } else {
        flushL();
        para.push(l.trim());
      }
    }
    flushP();
    flushL();
  }
  return out.filter((b) => (b.kind === "p" ? b.text : b.items.length));
}

/** "3 tools · 1.8s" / "No tools needed" like the reference. */
export function metaText(t: Turn): string {
  if (t.meta) {
    if (t.meta.tools === 0) return "No tools needed";
    return `${t.meta.tools} ${t.meta.tools === 1 ? "tool" : "tools"} · ${(t.meta.ms / 1000).toFixed(1)}s`;
  }
  if (t.status === "streaming") return "Thinking…";
  return "";
}

/** Latest card of a kind in the conversation. */
export function latestCard<T>(c: Conversation | null, kind: AgentCard["kind"]): T | null {
  if (!c) return null;
  for (let i = c.turns.length - 1; i >= 0; i--) {
    const cards = c.turns[i]?.cards ?? [];
    for (let j = cards.length - 1; j >= 0; j--) if (cards[j]?.kind === kind) return cards[j]?.data as T;
  }
  return null;
}

const sym = (a: { symbol: string; displaySymbol?: string }): string => a.displaySymbol ?? a.symbol;

/**
 * Related follow-ups: the agent's suggestions for this exchange when it sent them, else neutral questions derived
 * from the turn's cards (no facts).
 */
export function relatedFor(t: Turn | null): string[] {
  if (t?.related?.length) return t.related.slice(0, 3);
  const c = t?.cards ?? [];
  const asset = c.find((x) => x.kind === "asset")?.data as AssetCardData | undefined;
  const index = c.find((x) => x.kind === "index")?.data as IndexCardData | undefined;
  const draft = c.find((x) => x.kind === "draft")?.data as DraftCardData | undefined;
  const cmp = c.find((x) => x.kind === "compare")?.data as CompareRow[] | undefined;
  if (draft) return ["Cap any single asset at 20%", "How often should this rebalance?", "Is there an index like this already?"];
  if (index) return [`What is in ${index.detail.name}, and why?`, "Find a lower-volatility alternative", "What is rebalancing?"];
  if (asset) {
    const s = sym(asset);
    return [`Why is ${s} moving this month?`, `Build me a basket around ${s}`, `Which indexes hold ${s}?`];
  }
  if (cmp && cmp.length >= 2) {
    const [a, b] = cmp;
    return [`${a?.symbol ?? a?.id} or ${b?.symbol ?? b?.id} for a long hold?`, "Build a basket with both", "What is rebalancing?"];
  }
  return ["What does drift mean?", "How is an index level calculated?", "Show me an index that rebalances monthly"];
}

// ------------------------------------------------------------------ view model

export interface ChatInputs {
  convs: Conversation[];
  /** false without a wallet: the open chat is not saved, so the chat list stays empty */
  listed?: boolean;
  currentId: string | null;
  search: string;
  pickConv: (id: string) => void;
  deleteConv: (id: string) => void;
  ask: (text: string) => void;
  assets: AssetLite[];
  board: BoardLite[];
  /** Daily candles of the asset card's asset (`/assets/:id/candles?interval=1d`). */
  candles: Candle[] | null;
  /** Level points of the index card's index (`/indexes/:id/levels`), level as a number. */
  levels: { ts: number; level: number }[] | null;
  holders: number | null;
  me: Me;
}

/** A card in an answer, ready to draw: the scope of AssetCard / DraftCard / IndexCard, or null (drawn compact). */
export interface CardView {
  kind: AgentCard["kind"];
  scope: Scope | null;
}

/** Weight colors, by rank: distinct on the dark surface (asset brand colors repeat too often to tell legs apart). */
export const WEIGHT_PALETTE = ["#9052F9", "#3DD68C", "#F5B14C", "#6FA8FF", "#FF6B6B", "#2DD4BF", "#F472B6", "#C9B3FD", "#A3E635", "#FB923C"];

/** Rows sorted by weight, each with its palette color and its share of the bar. */
export function weightRows(rows: { t: string; w: number; stock?: boolean }[]): { t: string; w: number; c: string; stock: boolean }[] {
  return [...rows]
    .sort((p, q) => q.w - p.w)
    .map((r, i) => ({ t: r.t, w: r.w, c: WEIGHT_PALETTE[i % WEIGHT_PALETTE.length] as string, stock: r.stock === true }));
}

export function assetScope(ac: AssetCardData, candles: Candle[]): Scope {
  const chg = pct(ac.board?.change24h ?? null);
  const m30 = pct(ac.board?.change30d ?? null);
  const s1 = sym(ac);
  return {
    id: ac.id,
    sym: s1,
    name: ac.name,
    ini2: logoFill(ac.id) ? "" : ini(s1),
    dot: logoFill(ac.id) ?? ac.color ?? GREY,
    kind: ac.kind === "stock" ? "Stock" : ac.kind === "token" ? "Token" : "Cash",
    price: usd(ac.price?.usd ?? null),
    chg,
    chgCol: colOf(chg),
    vol24: "—", // per-asset 24h volume is not exposed by the API yet
    liq: "—", // pool liquidity is not exposed by the API yet
    m30,
    m30Col: colOf(m30),
    badge: ac.kind === "stock" ? (ac.badge ?? "Reference market: Robinhood Chain (on-chain)") : null,
    href: `/asset/${ac.id}`,
    candles,
  };
}

export function draftScope(dc: DraftCardData, assetById: Map<string, AssetLite>): Scope {
  const rows = weightRows(
    dc.components.map((id, i) => {
      const a = assetById.get(id.toLowerCase());
      return { t: a ? sym(a) : id.toUpperCase(), w: Math.round(dc.weights[i] ?? 0), stock: a?.kind === "stock" };
    }),
  );
  const stocks = rows.filter((r) => r.stock).reduce((t, r) => t + r.w, 0);
  return {
    name: dc.name,
    ticker: dc.ticker,
    ret: "—", // no backtest service: never shown as a made-up number
    vol: "—",
    dd: "—",
    slip: "—",
    stocks,
    mix: `${stocks}% stocks · ${100 - stocks}% tokens`,
    assets: rows,
    href: draftHref(dc),
  };
}

export function indexScope(ic: IndexCardData, board: BoardLite[], live: { levels: { ts: number; level: number }[]; holders: number | null } | null): Scope {
  const id = ic.detail.id.toLowerCase();
  const b = board.find((r) => r.id.toLowerCase() === id);
  const m30 = pct(b?.change30d ?? null);
  const closes = live ? dailyCloses(live.levels.map((p) => ({ ts: p.ts, v: p.level }))) : [];
  const vol = live ? annualVol(closes) : null;
  const dd = live ? maxDrawdown(closes) : null;
  const holders = live?.holders ?? null;
  return {
    id: ic.detail.id,
    name: ic.detail.name,
    by: `by ${short(ic.detail.creator)}`,
    level: (Number(ic.detail.level) / 1e18).toFixed(2),
    m30: m30 === "—" ? "—" : `${m30} 30d`,
    m30Col: colOf(m30),
    holders: holders === null ? "—" : holders >= 200 ? "200+" : holders.toLocaleString("en-US"),
    vol: vol === null ? "—" : `${Math.round(vol * 100)}%`,
    dd: dd === null ? "—" : pct(dd),
    badge: ic.detail.badge ?? null,
    levels: closes,
    comp: weightRows(ic.composition.legs.map((l) => ({ t: l.symbol ?? "—", w: Math.round(Number(l.targetBps) / 100), stock: l.kind === "stock" }))),
    href: `/index/${ic.detail.id}`,
  };
}

/** Ask conversation view model — reference/logic/chat.js shape (convs, title, q, meta, related, is*, cur) + live cards. */
export function chatVM(x: ChatInputs): Scope {
  const cur = x.convs.find((c) => c.id === x.currentId) ?? null;
  const s = x.search.trim().toLowerCase();
  const convs = (x.listed === false ? [] : x.convs)
    .filter((c) => !s || c.title.toLowerCase().includes(s) || c.turns.some((t) => t.q.toLowerCase().includes(s)))
    .map((c) => ({
      id: c.id,
      title: c.title,
      on: c.id === cur?.id ? "true" : "false",
      bg: c.id === cur?.id ? "#1F1F23" : "transparent",
      fg: c.id === cur?.id ? "#F2F2F3" : "#B4B4BB",
      pick: () => x.pickConv(c.id),
      del: () => x.deleteConv(c.id),
    }));
  const last = cur?.turns[cur.turns.length - 1] ?? null;
  const assetById = new Map(x.assets.map((a) => [a.id, a]));

  // the newest card of each kind carries live data (candles, level history, holders); every card, old or new, is
  // drawn the same way from what its answer returned
  const ac = latestCard<AssetCardData>(cur, "asset");
  const dc = latestCard<DraftCardData>(cur, "draft");
  const ic = latestCard<IndexCardData>(cur, "index");
  const asset = ac ? assetScope(ac, x.candles ?? []) : null;
  const draft = dc ? draftScope(dc, assetById) : null;
  const index = ic ? indexScope(ic, x.board, { levels: x.levels ?? [], holders: x.holders }) : null;

  const turns = (cur?.turns ?? []).map((t) => ({
    q: t.q,
    mode: t.mode,
    meta: metaText(t),
    blocks: answerBlocks(t.text),
    cards: t.cards,
    views: t.cards.map((c): CardView => {
      if (c.kind === "asset") return { kind: "asset", scope: c.data === ac ? asset : assetScope(c.data as AssetCardData, []) };
      if (c.kind === "draft") return { kind: "draft", scope: c.data === dc ? draft : draftScope(c.data as DraftCardData, assetById) };
      if (c.kind === "index") return { kind: "index", scope: c.data === ic ? index : indexScope(c.data as IndexCardData, x.board, null) };
      return { kind: c.kind, scope: null };
    }),
    status: t.status,
    error: t.error ?? null,
  }));

  return withInitials({
    me: x.me,
    convs,
    title: cur?.title ?? "New chat",
    q: last?.q ?? "",
    meta: last ? metaText(last) : "",
    related: (last && last.status !== "streaming" ? relatedFor(last) : []).map((text) => ({ text, pick: () => x.ask(text) })),
    isAsset: asset !== null,
    isRec: draft !== null,
    isIndex: index !== null,
    isGeneral: false,
    isCompare: false,
    asset,
    draft,
    index,
    turns,
    streaming: last?.status === "streaming",
    empty: cur === null,
  });
}
