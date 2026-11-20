import { DOWN, UP, money, pct, withInitials } from "../lib/fmt";
import type { Me } from "../lib/chrome";
import { logoAvatar, logoFill } from "../lib/logos";
import type { Scope } from "../lib/tpl";

/** `/indexes/:id`-style index row as returned inside `/portfolio/:address` (services/api indexView). */
export interface IndexView {
  id: string;
  ticker: string;
  name: string;
  creator: string;
  isPublic: boolean;
  mode: number; // 0 Off · 1 Manual · 2 Auto
  driftBps: number; // Auto θ (relative drift, bps)
  supply: string;
  level: string;
  createdAt: string;
}

export interface PortfolioPosition {
  index: IndexView;
  units: string; // 1e18
  valueUsdWad: string;
  costUsdc: string;
  pnlUsdWad: string | null; // null = unknown cost basis
  unknownCostBasis: boolean;
  maxDriftBps: string | number;
}

export interface WalletAsset {
  id: string;
  symbol: string;
  color: string;
  amount: string;
  decimals: number;
  valueUsd: number;
  shareBps: number;
}

export interface PortfolioResp {
  address: string;
  positions: PortfolioPosition[];
  yourIndexes: IndexView[];
  wallet: WalletAsset[];
  walletTotalUsd: number;
  creatorEarnings: { claimableUsdc: string };
}

/** `/assets` row (only what Portfolio needs). */
export interface AssetMeta {
  id: string;
  kind: "stock" | "token" | "quote";
  name: string;
  price: { usd: number } | null;
}

/** `/board` asset row (only what Portfolio needs). */
export interface BoardChange {
  id: string;
  change24h: number | null;
}

/** `/indexes/:id/composition` (only what the allocation look-through needs). */
export interface Composition {
  supply: string;
  legs: { kind: "stock" | "token" | "quote" | null; valueUsdWad: string }[];
}

export interface PortfolioInputs {
  connected: boolean;
  loading: boolean;
  pf: PortfolioResp | null;
  assets: AssetMeta[];
  board: BoardChange[];
  /** index id (lower-case) → plan status (Rebalancer.Status) or null when unknown. */
  planStatus: Record<string, number | null>;
  /** index id (lower-case) → holder count or null when unknown. */
  holders: Record<string, number | null>;
  /** index id (lower-case) → composition or null when unknown. */
  composition: Record<string, Composition | null>;
  claiming: boolean;
  claim: () => void;
  me: Me;
}

const GREY = "#8E8E96";
const KIND_LABEL = { stock: "Stock", token: "Token", quote: "Cash" } as const;
/** index tokens in the wallet ring and split (brand accent) */
const INDEX_COLOR = "#9052F9";
const SCHEDULED = 1;
const ACTIVE = 2;

const wad = (s: string | number | null | undefined): number => (s === null || s === undefined ? NaN : Number(s) / 1e18);
const lc = (s: string): string => s.toLowerCase();

/** "+$281.90" / "-$22.31" with two decimals. */
export function signedMoney(usd: number | null): string {
  if (usd === null || !Number.isFinite(usd)) return "—";
  const body = Math.abs(usd).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${usd < 0 ? "-" : "+"}$${body}`;
}

/** Token amount like the reference ("182.5", "4.2", "0.0071", "1,620.40" for cash). */
export function amountText(n: number, cash = false): string {
  if (!Number.isFinite(n)) return "—";
  if (cash) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n === 0) return "0";
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return String(Number(n.toPrecision(2)));
}

const money2 = (usd: number | null): string => (usd === null ? "—" : money(usd, 2));

/** Drift pill like the reference: "On target" / "1.8% drift" / "6.4% drift · rebalance scheduled". */
export function driftCell(maxDriftBps: number, plan: number | null) {
  const d = maxDriftBps / 100;
  const needs = plan === SCHEDULED || plan === ACTIVE;
  const text = !Number.isFinite(d) ? "—" : needs ? `${d.toFixed(1)}% drift · rebalance scheduled` : d < 1 ? "On target" : `${d.toFixed(1)}% drift`;
  return { drift: text, needs, ok: !needs, pillBg: needs ? "#2E2311" : "#11261B", pillFg: needs ? "#F5B14C" : "#3DD68C" };
}

/** Rebalance column of "Your indexes": "Auto · 50% drift", "Manual", "Off". */
export function modeText(ix: IndexView): string {
  if (ix.mode === 1) return "Manual";
  if (ix.mode === 2) return ix.driftBps > 0 ? `Auto · ${Math.round(ix.driftBps / 100)}% drift` : "Auto";
  return "Off";
}

/** Look-through allocation of the whole account (wallet + index legs pro rata to units held). */
export function allocation(
  wallet: WalletAsset[],
  kinds: Map<string, AssetMeta["kind"]>,
  positions: PortfolioPosition[],
  composition: Record<string, Composition | null>,
): { stocks: number; tokens: number; usdc: number } | null {
  let stocks = 0;
  let tokens = 0;
  let usdc = 0;
  for (const w of wallet) {
    const k = kinds.get(w.id);
    if (k === "stock") stocks += w.valueUsd;
    else if (k === "token") tokens += w.valueUsd;
    else if (k === "quote") usdc += w.valueUsd;
    else return null;
  }
  for (const p of positions) {
    const c = composition[lc(p.index.id)];
    if (!c) return null;
    const supply = wad(c.supply);
    if (!(supply > 0)) return null;
    const share = wad(p.units) / supply;
    for (const leg of c.legs) {
      const v = wad(leg.valueUsdWad) * share;
      if (leg.kind === "stock") stocks += v;
      else if (leg.kind === "token") tokens += v;
      else if (leg.kind === "quote") usdc += v;
      else return null;
    }
  }
  const total = stocks + tokens + usdc;
  if (!(total > 0)) return null;
  return { stocks: (stocks / total) * 100, tokens: (tokens / total) * 100, usdc: (usdc / total) * 100 };
}

/** Portfolio view model — same shape as reference/logic/portfolio.js, plus the live chrome fields. */
export function portfolioVM(x: PortfolioInputs): Scope {
  const pf = x.pf;
  const meta = new Map(x.assets.map((a) => [a.id, a]));
  const kinds = new Map(x.assets.map((a) => [a.id, a.kind]));
  const chg = new Map(x.board.map((b) => [b.id, b.change24h]));

  const positions = pf?.positions ?? [];
  const held = new Map(positions.map((p) => [lc(p.index.id), wad(p.units)]));

  const pos = positions.map((p) => {
    const id = lc(p.index.id);
    const pnl = p.pnlUsdWad === null ? null : wad(p.pnlUsdWad);
    const unknown = p.unknownCostBasis || pnl === null;
    return {
      id,
      name: p.index.name,
      units: `${amountText(wad(p.units))} ${p.index.ticker}`,
      value: money2(wad(p.valueUsdWad)),
      pnl: unknown ? "Cost basis unknown" : signedMoney(pnl),
      pnlUnknown: unknown,
      pnlCol: unknown ? GREY : (pnl ?? 0) < 0 ? DOWN : UP,
      ...driftCell(Number(p.maxDriftBps), x.planStatus[id] ?? null),
      _href: { IndexDetail: `/index/${p.index.id}`, Redeem: `/redeem/${p.index.id}` },
    };
  });

  const mine = (pf?.yourIndexes ?? []).map((ix) => {
    const id = lc(ix.id);
    const pub = ix.isPublic;
    const n = x.holders[id];
    return {
      id,
      name: ix.name,
      units: `You hold ${amountText(held.get(id) ?? 0)} ${ix.ticker}`,
      mode: modeText(ix),
      holders: pub ? (n === null || n === undefined ? "—" : n >= 200 ? "200+" : n.toLocaleString("en-US")) : "Only you",
      earned: "—", // per-index creator earnings are not exposed by the API (only the claimable total)
      status: pub ? "Public" : "Private",
      pillBg: pub ? "#1F1F23" : "#221637",
      pillFg: pub ? "#F2F2F3" : "#C9B3FD",
      href: pub ? "IndexDetail.dc.html" : "IndexPrivate.dc.html",
      manual: ix.mode === 1,
      _href: { IndexDetail: `/index/${ix.id}`, IndexPrivate: `/index/${ix.id}`, Version: `/version/${ix.id}` },
    };
  });

  // Wallet: everything this address holds: assets held directly plus its index tokens, each index
  // valued at its level. Value is "—" when an asset has no canonical price.
  const wallet = pf?.wallet ?? [];
  const positionsUsdAll = positions.reduce((s, p) => s + wad(p.valueUsdWad), 0);
  const walletAll = pf ? pf.walletTotalUsd + positionsUsdAll : 0;
  const shareOf = (usd: number): number => (walletAll > 0 ? (usd / walletAll) * 100 : 0);
  let acc = 0;
  let day = 0;
  let dayKnown = wallet.length + positions.length > 0;
  const ring = (p: number) => {
    const before = acc;
    acc += p;
    return { pct: `${p.toFixed(1)}%`, pctW: `${p.toFixed(1)}%`, dash: `${p.toFixed(2)} ${(100 - p).toFixed(2)}`, off: String(((100 - before) % 100).toFixed(2)) };
  };
  const indexRows = positions.map((p) => {
    const id = lc(p.index.id);
    const usd = wad(p.valueUsdWad);
    const c = chg.get(id) ?? chg.get(p.index.id) ?? null;
    if (c === null) dayKnown = false;
    else day += (usd * c) / (1 + c);
    const d = c === 0 ? "0.0%" : pct(c); // flat reads grey, not "+0.0%"
    return {
      usd,
      row: {
        id,
        sym: p.index.ticker,
        kind: "Index",
        amt: amountText(wad(p.units)),
        value: money(usd, 2),
        d,
        dot: INDEX_COLOR,
        dCol: d === "0.0%" || d === "—" ? GREY : d.charAt(0) === "-" ? DOWN : UP,
      },
    };
  });
  const assetRows = wallet.map((w) => {
    const m = meta.get(w.id);
    const kind = m?.kind ?? null;
    const cash = kind === "quote";
    const priced = cash || (m?.price !== null && m?.price !== undefined);
    const c = cash ? 0 : (chg.get(w.id) ?? null);
    if (!cash && priced) {
      if (c === null) dayKnown = false;
      else day += (w.valueUsd * c) / (1 + c);
    }
    if (!priced) dayKnown = false;
    const d = cash || c === 0 ? "0.0%" : pct(c);
    return {
      usd: w.valueUsd,
      row: {
        id: w.id,
        sym: w.symbol,
        kind: kind ? KIND_LABEL[kind] : "—",
        amt: amountText(Number(w.amount) / 10 ** w.decimals, cash),
        value: priced ? money(w.valueUsd, 2) : "—",
        d,
        dot: w.color,
        ...logoAvatar(w.id),
        dCol: d === "0.0%" || d === "—" ? GREY : d.charAt(0) === "-" ? DOWN : UP,
      },
    };
  });
  const assets = [...indexRows, ...assetRows].map(({ usd, row }) => ({ ...row, ...ring(shareOf(usd)) }));
  const byKind = (k: AssetMeta["kind"]): number => wallet.filter((w) => kinds.get(w.id) === k).reduce((s, w) => s + shareOf(w.valueUsd), 0);
  const some = wallet.length + positions.length > 0;
  const split = [
    { label: "Indexes", col: INDEX_COLOR, pct: some ? `${shareOf(positionsUsdAll).toFixed(1)}%` : "—" },
    ...(
      [
        ["Stocks", "#76B900", "stock"],
        ["Tokens", "#E84142", "token"],
        ["Cash", "#2775CA", "quote"],
      ] as const
    ).map(([label, col, k]) => ({ label, col, pct: some ? `${byKind(k).toFixed(1)}%` : "—" })),
  ];

  const positionsUsd = positions.reduce((s, p) => s + wad(p.valueUsdWad), 0);
  const total = pf ? pf.walletTotalUsd + positionsUsd : null;
  const claimable = pf ? Number(pf.creatorEarnings.claimableUsdc) / 1e6 : null;
  const claimS = claimable === null ? "—" : claimable.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const al = pf ? allocation(wallet, kinds, positions, x.composition) : null;
  const ap = (n: number | undefined): string => (n === undefined ? "—" : `${Math.round(n)}%`);

  const empty = !x.loading && (!x.connected || (pf !== null && positions.length === 0 && (pf.yourIndexes.length === 0) && wallet.length === 0));

  return withInitials({
    me: x.me,
    connected: x.connected,
    loading: x.loading && pf === null,
    empty,
    noPositions: !x.loading && positions.length === 0,
    totalS: total === null ? "—" : money(total, 2),
    pnl30S: "—", // 30-day PnL needs a dated cost/value history the API does not expose yet
    earnS: claimable === null ? "—" : money(claimable, 2),
    claimLabel: `Claim ${claimS} USDC`,
    canClaim: claimable !== null && claimable > 0 && !x.claiming,
    claiming: x.claiming,
    claim: x.claim,
    alloc: {
      known: al !== null,
      stocksW: `${(al?.stocks ?? 0).toFixed(1)}%`,
      tokensW: `${(al?.tokens ?? 0).toFixed(1)}%`,
      usdcW: `${(al?.usdc ?? 0).toFixed(1)}%`,
      stocksL: `Stocks ${ap(al?.stocks)}`,
      tokensL: `Tokens ${ap(al?.tokens)}`,
      usdcL: `USDC ${ap(al?.usdc)}`,
    },
    pos,
    mine,
    assets,
    split,
    walletTotal: pf ? money(walletAll, 2) : "—",
    walletDay: dayKnown ? signedMoney(day) : "—",
    walletDayCol: !dayKnown || Math.abs(day) < 0.005 ? GREY : day < 0 ? DOWN : UP,
    walletSub: "Everything this wallet holds, index tokens included",
  });
}
