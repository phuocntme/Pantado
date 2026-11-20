import { withInitials } from "../lib/fmt";
import type { Me } from "../lib/chrome";
import { logoAvatar, logoFill } from "../lib/logos";
import type { Scope } from "../lib/tpl";

export type AskTab = "Today" | "Indexes" | "Stocks" | "Tokens";
export type AskMode = "Auto" | "Deep";
export const TABS: AskTab[] = ["Today", "Indexes", "Stocks", "Tokens"];
export const MODES: AskMode[] = ["Auto", "Deep"];

/** `/board` row (only what the suggestions need). */
export interface AskBoardRow {
  id: string;
  kind: "stock" | "token" | "index";
  symbol: string;
  name: string;
  color?: string;
  stocksPct?: number;
  change24h: number | null;
  volume24hUsd?: number;
}

export interface SuggestionRow {
  chip: boolean;
  sym?: string;
  nm?: string;
  dot?: string;
  text: string;
  buy: boolean;
  ask: boolean;
  weight: number;
  _href: { AskChat?: string; IndexDetail?: string };
}

/** Link to the Ask conversation for a question. */
export function askHref(question: string, mode: AskMode): string {
  const q = question.trim();
  return q ? `/ask?q=${encodeURIComponent(q)}&mode=${mode.toLowerCase()}` : "/ask";
}

const q = (text: string, mode: AskMode): SuggestionRow => ({ chip: false, text, buy: false, ask: true, weight: 400, _href: { AskChat: askHref(text, mode) } });
const a = (r: AskBoardRow, text: string, mode: AskMode): SuggestionRow => ({
  chip: true,
  sym: r.symbol,
  nm: r.name,
  dot: r.color ?? "#8E8E96",
  ...logoAvatar(r.id),
  text,
  buy: false,
  ask: true,
  weight: 400,
  _href: { AskChat: askHref(`${r.symbol} ${text}`, mode) },
});
const b = (ix: AskBoardRow): SuggestionRow => ({ chip: false, text: `Buy ${ix.name} for $50`, buy: true, ask: false, weight: 600, _href: { IndexDetail: `/index/${ix.id}` } });

/** "is up 3.1% today" from a real 24h change. */
export function moveText(change: number): string {
  return `is ${change >= 0 ? "up" : "down"} ${Math.abs(change * 100).toFixed(1)}% today`;
}

/** Largest absolute 24h mover of a kind (rows with a known change only). */
function movers(rows: AskBoardRow[], kind: AskBoardRow["kind"]): AskBoardRow[] {
  return rows.filter((r) => r.kind === kind && r.change24h !== null && Number.isFinite(r.change24h)).sort((x, y) => Math.abs(y.change24h ?? 0) - Math.abs(x.change24h ?? 0));
}

/**
 * Suggestion rows per tab. Same structure as reference/logic/ask.js, but every fact comes from live `/board`
 * data (real 24h changes, real public indexes); rows whose data is missing are left out, never invented.
 */
/** The agent's questions of the day per tab (`GET /suggestions`, rewritten once a UTC day). */
export interface DailySuggestions {
  date: string;
  tabs: Partial<Record<AskTab, { asset: string | null; text: string }[]>>;
}

/**
 * Rows of a tab: its buy row, then the day's questions from the agent (an asset's chip before its question), topped up
 * from the built-in rows when the agent has fewer than four for the tab or is unavailable.
 */
export function suggestions(tab: AskTab, mode: AskMode, board: AskBoardRow[], daily: DailySuggestions | null = null): SuggestionRow[] {
  const builtIn = builtInSuggestions(tab, mode, board);
  const day = daily?.tabs[tab] ?? [];
  if (!day.length) return builtIn;
  const byId = new Map(board.map((r) => [r.id, r]));
  const fromDay = day.flatMap((s): SuggestionRow[] => {
    if (!s.asset) return [q(s.text, mode)];
    const r = byId.get(s.asset);
    return r ? [a(r, s.text, mode)] : [];
  });
  const buyRow = builtIn.filter((r) => r.buy);
  const others = builtIn.filter((r) => !r.buy);
  return [...buyRow, ...fromDay, ...others].slice(0, buyRow.length + 4);
}

function builtInSuggestions(tab: AskTab, mode: AskMode, board: AskBoardRow[]): SuggestionRow[] {
  const ix = board.filter((r) => r.kind === "index").sort((x, y) => (y.volume24hUsd ?? 0) - (x.volume24hUsd ?? 0) || x.name.localeCompare(y.name));
  const stocks = movers(board, "stock");
  const tokens = movers(board, "token");
  const allMovers = [...stocks, ...tokens].sort((x, y) => Math.abs(y.change24h ?? 0) - Math.abs(x.change24h ?? 0));
  const out: (SuggestionRow | null)[] = [];
  const buy = (r: AskBoardRow | undefined): SuggestionRow | null => (r ? b(r) : null);
  if (tab === "Today") {
    const m = allMovers[0];
    out.push(
      buy(ix[0]),
      m ? a(m, `${moveText(m.change24h ?? 0)}. What is moving it?`, mode) : null,
      q("Which public index moved most over 30 days?", mode),
      allMovers[1] ? a(allMovers[1], `${moveText(allMovers[1].change24h ?? 0)}. How volatile has it been over 90 days?`, mode) : null,
      q("Build a low-volatility basket of five assets.", mode),
    );
  } else if (tab === "Indexes") {
    const top = ix[0];
    out.push(
      buy(ix[1] ?? ix[0]),
      q("Top five indexes by 30-day return, with drawdown.", mode),
      top ? q(`Compare ${top.name} with holding AVAX.`, mode) : null,
      q("Which listed indexes rebalanced this week, and why?", mode),
      q("Turn my wallet into an index I can share.", mode),
    );
  } else if (tab === "Stocks") {
    const stockIx = [...ix].filter((r) => (r.stocksPct ?? 0) > 0).sort((x, y) => (y.stocksPct ?? 0) - (x.stocksPct ?? 0))[0];
    const [s1, s2] = stocks;
    out.push(
      buy(stockIx),
      s1 ? a(s1, `${moveText(s1.change24h ?? 0)}. How did it trade over the last month?`, mode) : null,
      s1 && s2 ? a(s2, `or ${s1.symbol} for a basket? Compare the two.`, mode) : null,
      q("Which stocks traded the most today?", mode),
      q("Equal-weight the seven largest US tech stocks.", mode),
    );
  } else {
    const tokenIx = [...ix].filter((r) => r.stocksPct === 0)[0];
    const [t1, t2] = tokens;
    out.push(
      buy(tokenIx),
      t1 ? a(t1, `${moveText(t1.change24h ?? 0)}. How has it traded over the last 30 days?`, mode) : null,
      t2 ? a(t2, `versus ${t1?.symbol ?? "AVAX"} in a basket: what changes?`, mode) : null,
      q("Which Avalanche tokens traded the most today?", mode),
      q("Weight the top ten Avalanche tokens by market cap, cap each at 20%.", mode),
    );
  }
  return out.filter((r): r is SuggestionRow => r !== null);
}

export interface AskInputs {
  tab: AskTab;
  mode: AskMode;
  pickTab: (t: AskTab) => void;
  pickMode: (m: AskMode) => void;
  board: AskBoardRow[];
  /** The agent's questions of the day (null: built-in rows only). */
  daily?: DailySuggestions | null;
  /** Text typed in the ask box (the Send link carries it). */
  draft: string;
  me: Me;
}

/** Ask home view model — same shape as reference/logic/ask.js. Also used behind the Connect dialog. */
export function askVM(x: AskInputs): Scope {
  const tabs = TABS.map((t) => ({
    label: t,
    on: t === x.tab ? "true" : "false",
    bg: t === x.tab ? "#F2F2F3" : "#1A1A1D",
    fg: t === x.tab ? "#0B0B0D" : "#B4B4BB",
    pick: () => x.pickTab(t),
  }));
  const modes = MODES.map((m) => ({
    label: m,
    on: m === x.mode ? "true" : "false",
    bg: m === x.mode ? "#F2F2F3" : "transparent",
    fg: m === x.mode ? "#0B0B0D" : "#B4B4BB",
    pick: () => x.pickMode(m),
  }));
  return withInitials({
    me: x.me,
    tabs,
    modes,
    rows: suggestions(x.tab, x.mode, x.board, x.daily ?? null),
    _href: { AskChat: askHref(x.draft, x.mode) },
  });
}
