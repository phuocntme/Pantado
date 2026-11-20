/**
 * Daily Ask-home suggestions: once per UTC day, four questions per tab (Today, Indexes, Stocks, Tokens) written
 * by the fast model from a snapshot of the live board. Each one stays on its tab's topic, carries an insight from the
 * snapshot (a real move, volume or level) and is answerable with Pantado's own tools. A suggestion whose figures are
 * not in the snapshot, or that names an unlisted asset, is dropped; the app falls back to its own rows when a tab is
 * short.
 */
import { z } from "zod";
import type { Asset } from "@pantado/shared";
import type { PantadoApi } from "./api-client.js";
import type { LlmProvider } from "./llm.js";
import { checkNumbers } from "./numbers.js";

export const TABS = ["Today", "Indexes", "Stocks", "Tokens"] as const;
export type Tab = (typeof TABS)[number];

export interface Suggestion {
  /** listed asset the question is about (the app shows its chip before `text`), else null */
  asset: string | null;
  text: string;
}

export interface DailySuggestions {
  date: string; // UTC day, YYYY-MM-DD
  tabs: Record<Tab, Suggestion[]>;
}

interface BoardRow {
  id: string;
  kind: "stock" | "token" | "index";
  symbol: string;
  name: string;
  change24h: number | null;
  change7d: number | null;
  change30d: number | null;
  volume24hUsd?: number | null;
  level?: number;
  stocksPct?: number;
}

const pct = (v: number | null): number | null => (v === null || !Number.isFinite(v) ? null : Math.round(v * 1000) / 10);
const usd = (v: number | null | undefined): number | null => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v));

/** The compact snapshot the model writes from (and the figures a suggestion may use). */
export function snapshotOf(board: BoardRow[]): Record<string, unknown> {
  const row = (r: BoardRow) => ({
    id: r.id,
    symbol: r.symbol,
    name: r.name,
    change24hPct: pct(r.change24h),
    change7dPct: pct(r.change7d),
    change30dPct: pct(r.change30d),
    volume24hUsd: usd(r.volume24hUsd),
  });
  const kind = (k: BoardRow["kind"]) => board.filter((r) => r.kind === k);
  const by = (xs: BoardRow[], f: (r: BoardRow) => number | null | undefined) =>
    [...xs].filter((r) => f(r) !== null && f(r) !== undefined).sort((a, b) => Math.abs(f(b) ?? 0) - Math.abs(f(a) ?? 0));
  const stocks = kind("stock");
  const tokens = kind("token");
  return {
    stocks: { biggestMoves24h: by(stocks, (r) => r.change24h).slice(0, 6).map(row), biggestMoves7d: by(stocks, (r) => r.change7d).slice(0, 4).map(row), mostTraded: by(stocks, (r) => r.volume24hUsd).slice(0, 4).map(row) },
    tokens: { biggestMoves24h: by(tokens, (r) => r.change24h).slice(0, 6).map(row), biggestMoves7d: by(tokens, (r) => r.change7d).slice(0, 4).map(row), mostTraded: by(tokens, (r) => r.volume24hUsd).slice(0, 4).map(row) },
    indexes: kind("index").map((r) => ({ symbol: r.symbol, name: r.name, level: r.level === undefined ? null : Math.round(r.level * 100) / 100, change30dPct: pct(r.change30d), stocksPct: r.stocksPct ?? null, volume24hUsd: usd(r.volume24hUsd) })),
  };
}

export const SUGGESTIONS_PROMPT = `You write the daily question suggestions on the home screen of Pantado's Ask (an index trading
app: tokenized stocks and Avalanche tokens, indexes held as one token). From the market snapshot you get, write exactly
four questions for each tab:
- Today: the day's most notable moves across stocks, tokens and indexes.
- Indexes: Pantado's public indexes (compositions, levels, 30-day moves, drafting or comparing baskets).
- Stocks: the listed stocks only.
- Tokens: the listed Avalanche tokens only.
Rules:
- Each question carries one insight from the snapshot: a real move, volume or level, with its number exactly as given
  (rounded to one decimal at most). Never invent a number, a reason, news or a buyer.
- Each must be answerable from Pantado's data: prices and changes, price history, volatility and drawdown, volume,
  index compositions and levels, comparisons, backtests, drafting an index. No predictions, no "should I buy".
- Under 90 characters, plain English, no emoji.
- When a question is about one listed asset, set "asset" to its id and write "text" as what follows its name
  (e.g. {"asset": "coq", "text": "fell 18.2% this week. How volatile has it been over 90 days?"}); else asset is null.
Reply with JSON only: {"Today": [{"asset": …, "text": …}, …], "Indexes": [...], "Stocks": [...], "Tokens": [...]}.`;

/** Look-back windows a question may name ("over 90 days") besides the snapshot's figures. */
const PERIOD_DAYS = [7, 14, 30, 60, 90, 180, 365];

const replySchema = z.record(z.string(), z.array(z.object({ asset: z.string().nullable().optional(), text: z.string() })));

/** Keep what the model wrote only where it holds: listed assets of the tab's kind, figures from the snapshot. */
export function validate(raw: unknown, snapshot: unknown, assets: Asset[]): Record<Tab, Suggestion[]> {
  const parsed = replySchema.safeParse(raw);
  const out = { Today: [], Indexes: [], Stocks: [], Tokens: [] } as Record<Tab, Suggestion[]>;
  if (!parsed.success) return out;
  const byId = new Map(assets.map((a) => [a.id, a]));
  for (const tab of TABS) {
    for (const s of parsed.data[tab] ?? []) {
      const text = s.text.replace(/\s+/g, " ").trim();
      if (text.length < 8 || text.length > 120) continue;
      const id = s.asset ? s.asset.toLowerCase() : null;
      const a = id ? byId.get(id) : undefined;
      if (id && !a) continue; // not a listed asset
      if (tab === "Stocks" && a && a.kind !== "stock") continue;
      if (tab === "Tokens" && a && a.kind !== "token") continue;
      if (checkNumbers(text, [snapshot, PERIOD_DAYS]).unverified.length) continue; // a figure not in the snapshot
      if (out[tab].length < 4) out[tab].push({ asset: id, text });
    }
  }
  return out;
}

/** One set per UTC day, made on first request (concurrent requests share it). */
export function dailySuggestions(d: { api: PantadoApi; llm: LlmProvider; model: string; assets: Asset[]; now?: () => Date }) {
  let cached: DailySuggestions | null = null;
  let running: Promise<DailySuggestions> | null = null;
  const make = async (date: string): Promise<DailySuggestions> => {
    const board = await d.api.get<BoardRow[]>("/board");
    const snapshot = snapshotOf(board);
    const r = await d.llm.turn({
      model: d.model,
      system: SUGGESTIONS_PROMPT,
      turns: [{ role: "user", content: [{ type: "text", text: `Date ${date}. Snapshot:\n${JSON.stringify(snapshot)}` }] }],
      tools: [],
      effort: "low",
    });
    const text = r.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    let raw: unknown = null;
    try {
      raw = JSON.parse(json);
    } catch {
      raw = null;
    }
    return { date, tabs: validate(raw, snapshot, d.assets) };
  };
  return async (): Promise<DailySuggestions> => {
    const date = (d.now?.() ?? new Date()).toISOString().slice(0, 10);
    if (cached?.date === date) return cached;
    running ??= make(date)
      .then((s) => {
        cached = s;
        return s;
      })
      .finally(() => {
        running = null;
      });
    return running;
  };
}
