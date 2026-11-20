/**
 * Index page view model — same shape as reference/logic/index.js (tabs, txs, versions, holders, rows, sides,
 * amt/onAmt, unit, recv, getSym, tokStocks, tokRight, note, feeLabel, fee, legs, cta), built from the API.
 * Extra keys (`stats`, `chart`, `banner`, `plan`, `split`, `trade`, `assess`) feed the live slots.
 * Unknown data renders "—"; nothing is invented.
 */
import { ago, amountInputOk, DOWN, money, pct, pctCol, UP, vol, withInitials } from "../lib/fmt";
import { logoAvatar, logoFill } from "../lib/logos";
import { short } from "../lib/nav";
import type { Me } from "../lib/chrome";
import { chartGeometry, dailyCandles, type ChartGeom } from "./index.chart";
import {
  changeText,
  dayLabel,
  fixed,
  fromBase,
  MODE,
  MODE_LABEL,
  PLAN,
  priceS,
  START_LEVEL,
  symbolOf,
  until,
  USDC_DECIMALS,
  UNIT_DECIMALS,
  wad,
  type AssetInfo,
  type BoardAsset,
  type Composition,
  type Holder,
  type IndexDetail,
  type IndexEvent,
  type Levels,
  type Quote,
  type Rebalances,
} from "./index.data";

export type Tab = "Composition" | "Transactions" | "Rebalances" | "Holders";
export type Side = "Buy" | "Sell";
export const TABS: Tab[] = ["Composition", "Transactions", "Rebalances", "Holders"];
/** Default amounts when switching side (reference UI defaults: 1000 USDC / 10 units). */
export const DEFAULT_AMT: Record<Side, string> = { Buy: "1000", Sell: "10" };

export interface Assessment {
  text: string;
  tags: { label: string; good: boolean }[];
}

export interface IndexInput {
  detail: IndexDetail | null;
  comp: Composition | null;
  txs: IndexEvent[] | null;
  reb: Rebalances | null;
  holders: Holder[] | null;
  levels: Levels | null;
  assets: AssetInfo[] | null;
  board: BoardAsset[] | null;
  quote: Quote | null;
  quoteError: { code: string; message: string } | null;
  assess: Assessment | null;
  now: number; // unix seconds
  me: Me;
}
export interface IndexState {
  tab: Tab;
  side: Side;
  amt: string;
}
export interface IndexHandlers {
  setTab: (t: Tab) => void;
  setSide: (s: Side) => void;
  setAmt: (a: string) => void;
}

export type TradeBlock =
  | { kind: "none" }
  | { kind: "stale"; title: string; body: string }
  | { kind: "limit"; title: string; body: string }
  | { kind: "paused"; title: string; body: string }
  | { kind: "error"; title: string; body: string };

export interface PlanVM {
  title: string;
  sub: string;
  pill: string;
  pillBg: string;
  pillFg: string;
  guards: { label: string; val: string; max: string; w: string; col: string }[];
  lots: { n: string; trade: string; size: string; status: string; bg: string; fg: string }[];
}

const KIND_LABEL: Record<string, string> = { stock: "Stock", token: "Token", quote: "Cash" };
const TX_COL = (type: string): string => (type === "Sell" ? DOWN : type === "Buy" ? UP : "#F5B14C");
const VER_PILL: Record<string, [string, string]> = { Scheduled: ["#2E2311", "#F5B14C"], Live: ["#11261B", "#3DD68C"], Past: ["#1F1F23", "#B4B4BB"] };

/** Level now (USD per unit): the live lens level when composition is loaded, else the indexed one. */
export function levelOf(detail: IndexDetail | null, comp: Composition | null): number {
  const l = wad(comp?.level ?? detail?.level);
  return Number.isFinite(l) && l > 0 ? l : Number.NaN;
}

/** Level at or before `ts` from the indexed series (null if the series starts later). */
function levelAt(levels: Levels["levels"], ts: number): number | null {
  let best: number | null = null;
  for (const p of levels) if (Number(p.ts) <= ts) best = wad(p.level);
  return best;
}

/** Annualised volatility of daily closes (needs ≥ 7 daily returns). */
export function volatility(closes: number[]): number | null {
  if (closes.length < 8) return null;
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const a = closes[i - 1] as number;
    const b = closes[i] as number;
    if (a > 0 && b > 0) r.push(Math.log(b / a));
  }
  if (r.length < 7) return null;
  const m = r.reduce((s, x) => s + x, 0) / r.length;
  const v = r.reduce((s, x) => s + (x - m) ** 2, 0) / (r.length - 1);
  return Math.sqrt(v) * Math.sqrt(365);
}

/** Stock share of target weights, in percent. */
export function stocksPct(comp: Composition | null): number | null {
  if (!comp || comp.legs.length === 0) return null;
  return Math.round(comp.legs.reduce((s, l) => s + (l.kind === "stock" ? l.targetBps : 0), 0) / 100);
}

function tradeBlock(input: IndexInput, side: Side, name: string): TradeBlock {
  const stale = input.comp ? input.comp.legs.find((l) => !l.fresh) : undefined;
  const e = input.quoteError;
  if (stale || e?.code === "PriceStale")
    return {
      kind: "stale",
      title: stale ? `${stale.symbol ?? short(stale.asset)} price is out of date.` : (e?.message ?? "A price is out of date."),
      body: `Buying and selling ${name} is paused until it updates. You can still redeem from Portfolio.`,
    };
  if (!e) return { kind: "none" };
  if (e.code === "SizeCapExceeded") return { kind: "limit", title: e.message, body: "Lower the amount or split it into two trades." };
  if (e.code === "BuysPausedFor" && side === "Buy") return { kind: "paused", title: e.message, body: "Selling and redeem stay open." };
  return { kind: "error", title: e.message, body: "" };
}

function planVM(input: IndexInput, symOf: (a: string) => string, pxOf: (a: string) => number | null): PlanVM | null {
  const { detail, reb, now } = input;
  const plan = reb?.plans.find((p) => p.status === "Scheduled" || p.status === "Active");
  if (!detail || !plan) return null;
  const scheduled = plan.status === "Scheduled";
  const verName = plan.manual ? `Version ${detail.plan?.version ?? detail.version}` : "Rebalance";
  const dur = until(Number(plan.startAt), now);
  const value = wad(plan.value);
  const frac = (x: number): number | null => (Number.isFinite(x) && value > 0 ? x / value : null);
  const pctS = (f: number | null): string => (f === null ? "—" : `${(f * 100).toFixed(f * 100 < 10 && f > 0 ? 1 : 0)}%`);
  const auctions = (reb?.auctions ?? []).filter((a) => a.planId === plan.planId);
  // USD traded in the last 24h: fills of this plan valued at the sell asset's current fair price.
  const fills = (reb?.fills ?? []) as { planId: number; auctionId: number; amountOut: string; ts: string }[];
  let day = 0;
  for (const f of fills) {
    if (f.planId !== plan.planId || Number(f.ts) < now - 86400) continue;
    const a = auctions.find((x) => x.auctionId === f.auctionId);
    const px = a ? pxOf(a.sellAsset) : null;
    if (px !== null) day += px * wad(f.amountOut);
  }
  const traded = scheduled ? 0 : frac(day);
  const loss = scheduled ? 0 : frac(wad(plan.loss));
  const budget = frac(wad(plan.lossBudget));
  const days = !scheduled && plan.startedAt ? Math.floor((now - Number(plan.startedAt)) / 86400) : 0;
  const bar = (v: number | null, max: number | null): string => (v === null || !max ? "0%" : `${Math.min(100, (v / max) * 100).toFixed(0)}%`);
  const lotPill = (a: (typeof auctions)[number]): [string, string, string] =>
    BigInt(a.filled) >= BigInt(a.lot) ? ["Filled", "#11261B", "#3DD68C"] : Number(a.endAt) > now ? ["Live", "#2E2311", "#F5B14C"] : ["Ended", "#1F1F23", "#B4B4BB"];
  return {
    title: scheduled ? `${verName} · in notice period` : `${verName} · trading`,
    sub: scheduled
      ? `Holders can sell or redeem until it starts in ${dur}. Then the vault trades in small auctions.`
      : "The vault trades in small auctions until the basket reaches its targets.",
    pill: scheduled ? `Starts in ${dur}` : input.detail?.plan?.auctionLive ? "Auction live" : "Trading",
    pillBg: scheduled ? "#2E2311" : "#11261B",
    pillFg: scheduled ? "#F5B14C" : "#3DD68C",
    guards: [
      { label: "Traded per day", val: pctS(traded), max: "/ — max", w: "0%", col: "#9052F9" },
      { label: "Auction losses", val: pctS(loss), max: `/ ${pctS(budget)} budget`, w: bar(loss, budget), col: "#3DD68C" },
      { label: "Time", val: `${days} days`, max: "/ — max", w: "0%", col: "#6FA8FF" },
    ],
    lots: [...auctions]
      .sort((a, b) => a.auctionId - b.auctionId)
      .map((a) => {
        const px = pxOf(a.sellAsset);
        const [status, bg, fg] = lotPill(a);
        return { n: String(a.auctionId), trade: `${symOf(a.sellAsset)} → ${symOf(a.buyAsset)}`, size: px === null ? "—" : money(px * wad(a.lot), 0), status, bg, fg };
      }),
  };
}

export type IndexVM = ReturnType<typeof indexVM>;

export function indexVM(input: IndexInput, st: IndexState, h: IndexHandlers) {
  const { detail, comp, assets, board, quote, now, me } = input;
  const legs = comp?.legs ?? [];
  const assetList = assets ?? [];
  const name = detail?.name ?? "—";
  const ticker = detail?.ticker ?? "—";
  const level = levelOf(detail, comp);
  const levelS = Number.isFinite(level) ? level.toFixed(2) : "—";
  const side = st.side;
  const amtN = Number(st.amt) || 0;

  const infoOf = (id: string | null): AssetInfo | undefined => (id ? assetList.find((a) => a.id === id) : undefined);
  const boardOf = (id: string | null): BoardAsset | undefined => (id ? (board ?? []).find((b) => b.id === id) : undefined);
  const symOf = (a: string): string => symbolOf(a, legs, assetList);
  const pxOf = (a: string): number | null => {
    const l = legs.find((x) => x.asset.toLowerCase() === a.toLowerCase());
    const p = l ? wad(l.priceWad) : Number.NaN;
    return Number.isFinite(p) ? p : null;
  };

  // ---------------------------------------------------------------- composition
  const rows = legs.map((l) => {
    const b = boardOf(l.id);
    const d = pct(b?.change24h);
    const m = pct(b?.change30d);
    return {
      t: l.symbol ?? short(l.asset),
      kind: KIND_LABEL[l.kind ?? ""] ?? "—",
      w: Math.round(l.targetBps) / 100,
      px: priceS(wad(l.priceWad)),
      d,
      m,
      liq: "—",
      c: infoOf(l.id)?.color ?? "#8E8E96",
      ...logoAvatar(l.id),
      dCol: d === "—" ? "#8E8E96" : pctCol(d),
      mCol: m === "—" ? "#8E8E96" : pctCol(m),
    };
  });

  // ---------------------------------------------------------------- trade card
  const sp = stocksPct(comp);
  const feeUsd = quote ? fromBase(quote.fee, USDC_DECIMALS) : Number.NaN;
  const feeBase = quote ? (quote.side === "buy" ? fromBase(quote.usdcIn, USDC_DECIMALS) : fromBase(quote.gross, USDC_DECIMALS)) : Number.NaN;
  const feePct = feeBase > 0 ? `${((feeUsd / feeBase) * 100).toFixed(2)}%` : null;
  const net = quote ? (quote.side === "buy" ? fromBase(quote.usdcIn, USDC_DECIMALS) - feeUsd : fromBase(quote.usdcOut, USDC_DECIMALS)) : Number.NaN;
  const recv = quote ? (quote.side === "buy" ? fixed(fromBase(quote.units, UNIT_DECIMALS)) : fixed(fromBase(quote.usdcOut, USDC_DECIMALS))) : "—";
  const sides = (["Buy", "Sell"] as Side[]).map((s) => ({
    label: s,
    on: s === side ? "true" : "false",
    bg: s === side ? "#2A2A2F" : "transparent",
    fg: s === side ? "#F2F2F3" : "#8E8E96",
    pick: () => h.setSide(s),
  }));
  const trade = tradeBlock(input, side, name);

  // ---------------------------------------------------------------- tabs
  const tabs = TABS.map((t) => ({
    label: t,
    on: t === st.tab ? "true" : "false",
    fg: t === st.tab ? "#F2F2F3" : "#8E8E96",
    line: t === st.tab ? "#9052F9" : "transparent",
    pick: () => h.setTab(t),
  }));

  const txs = (input.txs ?? [])
    .filter((e) => e.kind === "buy" || e.kind === "sell" || e.kind === "redeem")
    .slice(0, 50)
    .map((e) => {
      const type = e.kind === "buy" ? "Buy" : e.kind === "sell" ? "Sell" : "Redeem";
      const usd =
        e.kind === "buy" ? fromBase(e.usdc, USDC_DECIMALS) : e.kind === "sell" ? fromBase(typeof e.data?.gross === "string" ? e.data.gross : e.usdc, USDC_DECIMALS) : Number.NaN;
      return {
        time: ago(Number(e.ts), now),
        type,
        value: money(usd, 2),
        units: e.units ? fixed(fromBase(e.units, UNIT_DECIMALS)) : "—",
        wallet: short(e.account) || "—",
        col: TX_COL(type),
      };
    });

  const holders = (input.holders ?? []).map((x) => {
    const u = fromBase(x.units, UNIT_DECIMALS);
    return {
      wallet: short(x.holder),
      units: fixed(u, 1),
      value: Number.isFinite(level) ? money(u * level, 0) : "—",
      share: `${(x.shareBps / 100).toFixed(1)}%`,
      creator: !!detail && x.holder.toLowerCase() === detail.creator.toLowerCase(),
    };
  });

  // versions: indexed versions, plus the launch as Version 1 when the indexer has no row for it
  const symbols = detail ? detail.assets.map(symOf) : [];
  const vrows = [...(input.reb?.versions ?? [])].sort((a, b) => b.version - a.version);
  const scheduledPlan = input.reb?.plans.find((p) => p.status === "Scheduled");
  const scheduledVer = scheduledPlan?.manual && detail?.plan?.status === PLAN.Scheduled ? (detail.plan.version ?? null) : null;
  const liveVer = vrows.find((v) => v.version !== scheduledVer)?.version ?? 1;
  const targetsOf = (n: number): number[] | null => {
    const r = vrows.find((v) => v.version === n);
    if (r) return r.targetBps;
    // index.targetBps holds the live targets; usable for the live version only
    return detail && n === liveVer ? detail.targetBps : null;
  };
  const verStatus = (n: number): string => (n === scheduledVer ? "Scheduled" : n === liveVer ? "Live" : "Past");
  const versions = vrows.map((v) => {
    const status = verStatus(v.version);
    const [pillBg, pillFg] = VER_PILL[status] ?? VER_PILL.Past!;
    return { name: `Version ${v.version}`, date: dayLabel(Number(v.ts)), change: changeText(symbols, targetsOf(v.version - 1), v.targetBps), reason: v.reason || "—", status, pillBg, pillFg };
  });
  if (detail && !vrows.some((v) => v.version === 1)) {
    const status = verStatus(1);
    const [pillBg, pillFg] = VER_PILL[status] ?? VER_PILL.Past!;
    versions.push({ name: "Version 1", date: dayLabel(Number(detail.createdAt)), change: `Created with ${detail.assets.length} assets`, reason: "Launch", status, pillBg, pillFg });
  }

  // ---------------------------------------------------------------- banner, plan, stats, chart
  const banner =
    detail && scheduledPlan
      ? {
          pill: `${scheduledPlan.manual ? `Version ${scheduledVer ?? detail.version}` : "Rebalance"} in ${until(Number(scheduledPlan.startAt), now)}`,
          change: scheduledPlan.manual && scheduledVer !== null ? changeText(symbols, targetsOf(scheduledVer - 1), targetsOf(scheduledVer) ?? []) : "Back to target weights",
        }
      : null;

  const series = input.levels?.levels ?? [];
  const change = (secs: number): number | null => {
    const old = levelAt(series, now - secs);
    return old && old > 0 && Number.isFinite(level) ? level / old - 1 : null;
  };
  const since = Number.isFinite(level) ? level / START_LEVEL - 1 : null;
  const sinceS = since === null ? "—" : pct(since, 2);
  const col = (s: string): string => (s === "—" ? "#8E8E96" : pctCol(s));
  const changes = [
    { label: "24H", s: pct(change(86400), 2) },
    { label: "7D", s: pct(change(7 * 86400), 2) },
    { label: "30D", s: pct(change(30 * 86400), 2) },
    { label: "ALL", s: sinceS },
  ].map((c) => ({ ...c, col: col(c.s) }));

  const candles = dailyCandles(series, input.txs ?? []);
  const chart: ChartGeom = chartGeometry(candles);
  const v30 = volatility(candles.map((c) => c.c));
  const holdersN = input.holders?.length ?? null;

  const vm = {
    me,
    name,
    ticker,
    creatorShort: detail ? short(detail.creator) : "—",
    badge: detail?.badge ?? input.levels?.badge ?? "",
    modeLabel: detail ? MODE_LABEL(detail.mode, detail.driftBps) : "—",
    isManual: detail?.mode === MODE.Manual,
    levelS,
    holdersS: holdersN === null ? "—" : holdersN >= 200 ? "200+" : holdersN.toLocaleString("en-US"),
    boughtS: detail ? vol(fromBase(detail.volumeUsdc, USDC_DECIMALS)) : "—",
    volS: v30 === null ? "—" : `${Math.round(v30 * 100)}%`,
    assess: input.assess ?? { text: "—", tags: [] },
    stats: { levelS, sinceS, sinceCol: col(sinceS) },
    changes,
    split: { stocks: sp, tokens: sp === null ? null : 100 - sp },
    chart,
    banner,
    plan: planVM(input, symOf, pxOf),
    trade,
    // reference shape
    tabs,
    txs,
    versions,
    holders,
    rows,
    tabComp: st.tab === "Composition",
    tabTx: st.tab === "Transactions",
    tabReb: st.tab === "Rebalances",
    tabHold: st.tab === "Holders",
    amt: st.amt,
    // Buy pays USDC (6 decimals), Sell pays index units (18)
    onAmt: (e: { target: { value: string } }) => {
      if (amountInputOk(e.target.value, side === "Buy" ? 6 : 18)) h.setAmt(e.target.value);
    },
    unit: side === "Buy" ? "USDC" : ticker,
    sides,
    recv,
    getSym: side === "Buy" ? ticker : "USDC",
    tokStocks: side === "Sell" ? 0 : (sp ?? 0),
    tokRight: side === "Sell" ? "#2775CA" : "#9052F9",
    note: `1 ${ticker} = ${Number.isFinite(level) ? `$${levelS}` : "—"}, backed by the ${legs.length || "—"} assets held in the index vault`,
    feeLabel: feePct ? `Trade fee ${feePct}` : "Trade fee",
    fee: quote ? money(feeUsd, 2) : "—",
    legs: rows.map((r) => ({ t: r.t, c: r.c, w: r.w, usd: Number.isFinite(net) && side === "Buy" ? money((net * r.w) / 100, 2) : "—" })),
    cta:
      side === "Buy"
        ? { bg: "#F2F2F3", label: "Buy index", href: "#" }
        : { bg: "#FF6B6B", label: Number.isFinite(net) ? `Sell for ${money(net, 2)}` : "Sell", href: "#" },
    amountOk: amtN > 0,
    _href: detail ? { Version: `/version/${detail.id}` } : {},
  };
  return withInitials(vm);
}

/** The question "Ask agent" opens Ask with: what the index holds and why, performance, risks. */
export function askAboutIndex(name: string, ticker: string, address: string): string {
  return `Tell me about ${name} (${ticker}): what it holds and why, how it has performed, and its main risks. Index ${address}`;
}
