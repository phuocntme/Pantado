import { DOWN, UP, pct, withInitials } from "../lib/fmt";
import { short } from "../lib/nav";
import type { Me } from "../lib/chrome";
import type { Scope } from "../lib/tpl";
import type { IndexView } from "./portfolio.vm";

/** `/creators/:handle` (handles are wallet addresses until profiles exist). */
export interface CreatorResp {
  handle: string;
  wallet: string;
  x: string | null;
  indexes: IndexView[];
}

/** `/board` index row (only what the creator page needs). */
export interface BoardIndexRow {
  id: string;
  kind: string;
  stocksPct?: number;
  change30d: number | null;
}

export interface CreatorInputs {
  creator: CreatorResp | null;
  /** Wallet shown when the creator response is not loaded yet (the route address or the connected wallet). */
  address: string | null;
  board: BoardIndexRow[];
  /** index id (lower-case) → holder count or null when unknown. */
  holders: Record<string, number | null>;
  copied: boolean;
  copy: () => void;
  me: Me;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Aug 2026" from a unix-seconds timestamp (UTC). */
export function monthYear(tsSec: string | number): string {
  const n = Number(tsSec);
  if (!Number.isFinite(n) || n <= 0) return "—";
  const d = new Date(n * 1000);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "x.com/handle" link text from a stored X handle or URL. */
export function xText(x: string | null): { href: string; label: string } | null {
  if (!x) return null;
  const h = x.replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//, "").replace(/^@/, "").replace(/\/+$/, "");
  return h ? { href: `https://x.com/${h}`, label: `x.com/${h}` } : null;
}

/** Creator view model — same shape as reference/logic/creator.js, plus handle/wallet/X chrome. */
export function creatorVM(x: CreatorInputs): Scope {
  const wallet = x.creator?.wallet ?? x.address;
  const handle = x.creator?.handle ?? x.address;
  const byId = new Map(x.board.filter((r) => r.kind === "index").map((r) => [r.id.toLowerCase(), r]));
  const list = (x.creator?.indexes ?? [])
    .filter((ix) => ix.isPublic)
    .map((ix) => {
      const id = ix.id.toLowerCase();
      const b = byId.get(id);
      const stocks = b?.stocksPct ?? null;
      const m = pct(b?.change30d ?? null);
      const n = x.holders[id];
      return {
        name: ix.name,
        stocks: stocks ?? 0,
        mixLabel: stocks === null ? "Mix unknown" : `${stocks} percent stocks, ${100 - stocks} percent tokens`,
        level: (Number(ix.level) / 1e18).toFixed(2),
        m,
        mCol: m === "—" ? "#8E8E96" : m.charAt(0) === "-" ? DOWN : UP,
        holders: n === null || n === undefined ? "—" : n >= 200 ? "200+" : n.toLocaleString("en-US"),
        created: monthYear(ix.createdAt),
        createdAt: Number(ix.createdAt),
        _href: { IndexDetail: `/index/${ix.id}` },
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
  const handleText = handle ? (handle.startsWith("0x") ? short(handle) : `@${handle}`) : "—";
  return withInitials({
    me: x.me,
    handle: handleText,
    avatar: handle ? (handle.startsWith("0x") ? handle.slice(2, 4) : handle.slice(0, 1)).toUpperCase() : "—",
    wallet: wallet ?? null,
    walletShort: wallet ? short(wallet) : "—",
    x: xText(x.creator?.x ?? null),
    countLabel: `Indexes · ${list.length}`,
    list,
    copyLabel: x.copied ? "Copied" : "Copy",
    copy: x.copy,
  });
}
