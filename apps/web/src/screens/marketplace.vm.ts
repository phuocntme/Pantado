import { pct, pctCol, smallDp, tinyNum, vol, withInitials } from "../lib/fmt";
import { short } from "../lib/nav";
import { logoAvatar, logoFill } from "../lib/logos";
import type { Scope } from "../lib/tpl";
import type { Me } from "../lib/chrome";

export interface BoardRow {
  id: string;
  kind: "stock" | "token" | "index";
  symbol: string;
  name: string;
  color?: string;
  creator?: string;
  stocksPct?: number;
  level?: number;
  price?: { usd: number } | null;
  change24h: number | null;
  change7d: number | null;
  change30d: number | null;
  /** stocks/tokens: reference market; indexes: Pantado's own buys and sells. null: not known yet */
  volume24hUsd?: number | null;
}

/** `/volume`: the reference markets' 24h volume (each swap once) and Pantado's index volume. */
export interface VolumeTotals {
  marketUsd: number | null;
  indexesUsd: number;
}

export type Filter = "All" | "Indexes" | "Stocks" | "Tokens";
const KIND: Record<Filter, BoardRow["kind"] | null> = { All: null, Indexes: "index", Stocks: "stock", Tokens: "token" };
const TYPE = { index: "Index", stock: "Stock", token: "Token" } as const;

export function priceText(usd: number | undefined): string {
  if (usd === undefined) return "—";
  const tiny = tinyNum(usd);
  if (tiny) return `$${tiny}`;
  const d = usd >= 1000 ? 0 : usd >= 0.01 ? 2 : smallDp(usd);
  return `$${usd.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}

/** Marketplace view model — same shape as reference/logic/marketplace.js. */
export function marketplaceVM(board: BoardRow[], f: Filter, setF: (f: Filter) => void, me: Me, totals: VolumeTotals | null = null): Scope {
  const all = board.map((r) => {
    const d = pct(r.change24h);
    const w = pct(r.change7d);
    const m = pct(r.change30d);
    const isIndex = r.kind === "index";
    const v = r.volume24hUsd ?? null;
    return {
      type: TYPE[r.kind],
      isIndex,
      isAsset: !isIndex,
      name: isIndex ? r.name : r.symbol,
      sub: isIndex ? `by ${short(r.creator)}` : r.name,
      dot: r.color ?? "#8E8E96",
      ...(isIndex ? {} : logoAvatar(r.id)),
      stocks: r.stocksPct ?? 0,
      price: isIndex ? (r.level ?? 0).toFixed(2) : priceText(r.price?.usd),
      d,
      w,
      m,
      dCol: pctCol(d),
      wCol: pctCol(w),
      mCol: pctCol(m),
      vol: v ?? -1, // unknown sorts last
      volS: v === null ? "—" : vol(v),
      href: isIndex ? `/index/${r.id}` : `/asset/${r.id}`,
      cta: isIndex ? "Buy" : "Swap",
      typeBg: isIndex ? "#221637" : "#1F1F23",
      typeFg: isIndex ? "#C9B3FD" : "#B4B4BB",
      chg24: r.change24h,
      chg30: r.change30d,
      kind: r.kind,
    };
  });
  const rows = all
    .filter((r) => !KIND[f] || r.kind === KIND[f])
    .sort((a, b) => b.vol - a.vol || a.name.localeCompare(b.name))
    .map((r, i) => ({ ...r, rank: i + 1 }));
  const chips = (["All", "Indexes", "Stocks", "Tokens"] as Filter[]).map((c) => ({
    label: c,
    n: all.filter((r) => !KIND[c] || r.kind === KIND[c]).length,
    on: c === f ? "true" : "false",
    bg: c === f ? "#F2F2F3" : "#1A1A1D",
    fg: c === f ? "#0B0B0D" : "#B4B4BB",
    pick: () => setF(c),
  }));
  const best = (kind: BoardRow["kind"], key: "chg24" | "chg30") => {
    const xs = all.filter((r) => r.kind === kind && r[key] !== null).sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0));
    const top = xs[0];
    return top ? { name: top.name, chg: pct(top[key]) } : { name: "—", chg: "" };
  };
  return withInitials({
    chips,
    rows,
    top: { token: best("token", "chg24"), stock: best("stock", "chg24"), index: best("index", "chg30") },
    // rows double-count swaps between two listed tokens; the total counts each swap once
    totalVolS: totals && totals.marketUsd !== null ? vol(totals.marketUsd + totals.indexesUsd) : "—",
    me,
  });
}
