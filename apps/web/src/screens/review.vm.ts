import { ago, amountInputOk, bigAmount, DOWN, money, UP, vol, withInitials } from "../lib/fmt";
import { short } from "../lib/nav";
import { logoAvatar, logoFill } from "../lib/logos";
import type { Scope } from "../lib/tpl";
import type { Me } from "../lib/chrome";
import type { AssetView, BoardRowView, IndexView } from "./asset.api";
import { buildChart, type Candle } from "./asset.chart";
import { bucketOf } from "./index.chart";
import { errorNotice, perf, staleNotice, txLine, wrongNetworkNotice, type Notice, type Perf, type TxLine, type TxStateLike } from "./asset.states";
import type { QuoteState, Side } from "./asset.vm";

export type Tab = "Composition" | "Transactions" | "Rebalances" | "Holders";
export type Step = "review" | "signing" | "done";

export interface CompositionView {
  level: string;
  allFresh: boolean;
  legs: { asset: string; id: string | null; symbol: string | null; kind: string | null; priceWad: string; fresh: boolean; currentBps: number | string; targetBps: number | string }[];
}
export interface IndexEventView {
  kind: string;
  account: string | null;
  usdc: string | null;
  units: string | null;
  data: { gross?: string } | null;
  ts: string;
  txHash: string;
}
export interface HolderView {
  holder: string;
  units: string;
  shareBps: number;
}
export interface VersionView {
  version: number;
  targetBps: number[];
  reason: string;
  startAt: string | null;
  ts: string;
}
export interface LevelPoint {
  ts: string;
  level: string;
}
export interface AssessmentView {
  concentration: { label: string };
  volatility: { annualizedPct: number | null };
  notes: string[];
}
export interface BasketQuote {
  side: "buy" | "sell";
  fee: string;
  units?: string;
  minUnits?: string;
  usdcOut?: string;
  legs?: { asset: string; venue: string; spendUsdc: string; expectedOut: string }[];
}

export interface ReviewInput {
  ix: IndexView | null;
  comp: CompositionView | null;
  board: BoardRowView[];
  assets: AssetView[];
  levels: LevelPoint[];
  events: IndexEventView[];
  holders: HolderView[];
  versions: VersionView[];
  assessment: AssessmentView | null;
  quote: QuoteState<BasketQuote>;
  ui: { side: Side; amt: string; tab: Tab; step: Step };
  tx: TxStateLike;
  wallet: { connected: boolean; chainOk: boolean };
  env: { network: string; explorer: string; nowSec: number };
  actions: { setSide: (s: Side) => void; setAmt: (v: string) => void; setTab: (t: Tab) => void; sign: () => void; back: () => void; connect: () => void; switchChain: () => void };
  me: Me;
}

const GREY = "#8E8E96";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const wad = (s: string | null | undefined): number => (s ? Number(BigInt(s)) / 1e18 : 0);
const usdc = (s: string | null | undefined): number => (s ? Number(BigInt(s)) / 1e6 : 0);
const dateS = (ts: number): string => {
  const d = new Date(ts * 1000);
  return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
};

/** Level candles (daily by default) from indexed level points (oldest first). */
export function levelCandles(points: LevelPoint[], sec = 86400): Candle[] {
  const out = new Map<number, Candle>();
  for (const p of points) {
    const t = bucketOf(Number(p.ts), sec);
    const v = wad(p.level);
    const k = out.get(t);
    if (!k) out.set(t, { t, o: v, h: v, l: v, c: v });
    else {
      k.h = Math.max(k.h, v);
      k.l = Math.min(k.l, v);
      k.c = v;
    }
  }
  return [...out.values()].sort((a, b) => a.t - b.t);
}

/** "NVDA 25 → 30% · AVAX 15 → 10%" between two weight vectors. */
export function changeText(prev: number[] | null, next: number[], syms: string[]): string {
  if (!prev) return `Created with ${next.length} assets`;
  const parts = next.flatMap((b, i) => (prev[i] !== b ? [`${syms[i] ?? "?"} ${Math.round((prev[i] ?? 0) / 100)} → ${Math.round(b / 100)}%`] : []));
  return parts.length ? parts.join(" · ") : "No weight change";
}

/** Review purchase view model — same shape as reference/logic/review.js (index page + modal). */
export function reviewVM(i: ReviewInput): Scope {
  const ix = i.ix;
  const { side, tab, step } = i.ui;
  const ticker = ix?.ticker ?? "—";
  const level = ix ? wad(i.comp?.level ?? ix.level) : null;
  const amt = Number(i.ui.amt) || 0;
  const assetsById = new Map(i.assets.map((a) => [a.id, a]));
  const boardById = new Map(i.board.map((r) => [r.id, r]));
  const legs = i.comp?.legs ?? [];
  const syms = legs.map((l) => l.symbol ?? short(l.asset));

  const rows = legs.map((l) => {
    const b = l.id ? boardById.get(l.id) : undefined;
    const d = perf("24h", b?.change24h);
    const m = perf("30d", b?.change30d);
    const a = l.id ? assetsById.get(l.id) : undefined;
    const p = wad(l.priceWad);
    return {
      t: l.symbol ?? short(l.asset),
      kind: l.kind === "stock" ? "Stock" : "Token",
      w: Math.round(Number(l.currentBps) / 100),
      px: p >= 1000 ? `$${Math.round(p).toLocaleString("en-US")}` : `$${p.toFixed(2)}`,
      d: d.value,
      m: m.value,
      dCol: d.col,
      mCol: m.col,
      liq: "—",
      c: a?.color ?? GREY,
      ...logoAvatar(a?.id),
    };
  });
  const stocksPct = Math.round(legs.filter((l) => l.kind === "stock").reduce((s, l) => s + Number(l.currentBps), 0) / 100);
  const row = ix ? boardById.get(ix.id) : undefined;
  const since = level === null ? null : level / 100 - 1;
  const perfs: Perf[] = [perf("24H", row?.change24h, 2), perf("7D", row?.change7d, 2), perf("30D", row?.change30d, 2), perf("ALL", since, 2)];

  const q = i.quote.data;
  const units = q?.units ? wad(q.units) : null;
  const unitsS = units === null ? "—" : units >= 1e6 ? bigAmount(units, 2) : units.toFixed(2);
  const fee = q ? usdc(q.fee) : null;
  const sellOut = q?.usdcOut ? usdc(q.usdcOut) : null;
  const legsR = (q?.legs ?? []).map((g) => {
    const l = legs.find((x) => x.asset.toLowerCase() === g.asset.toLowerCase());
    const a = l?.id ? assetsById.get(l.id) : undefined;
    const dec = a ? (a.kind === "quote" ? 6 : a.decimals) : 18;
    const out = Number(BigInt(g.expectedOut)) / 10 ** dec;
    const sym = l?.symbol ?? short(g.asset);
    return { t: sym, w: l ? Math.round(Number(l.targetBps) / 100) : 0, route: g.venue === "stock-venue" ? "Stock venue · reference price" : "Token venue", got: `${out.toFixed(out >= 1 ? 4 : 6)} ${sym}` };
  });

  const wrongNet = i.wallet.connected && !i.wallet.chainOk;
  const notices: Notice[] = [];
  if (wrongNet) notices.push(wrongNetworkNotice(i.env.network));
  const staleLeg = legs.find((l) => !l.fresh);
  if (staleLeg || i.comp?.allFresh === false || i.quote.error?.code === "PriceStale")
    notices.push(staleNotice(staleLeg?.symbol ?? "A", ix?.name ?? "this index", null, i.env.nowSec, true));
  else if (i.quote.error) notices.push(errorNotice(i.quote.error.message));
  const status: TxLine | null = txLine(
    i.tx,
    { pendingSub: `One signature buys ${unitsS} ${ticker}`, confirmed: `You own ${unitsS} ${ticker}`, failed: "Buy failed" },
    i.env.network,
    i.env.explorer,
  );

  const now = i.env.nowSec;
  const sortedV = [...i.versions].sort((a, b) => a.version - b.version);
  const liveV = [...sortedV].reverse().find((v) => !v.startAt || Number(v.startAt) <= now);
  const versions = [...sortedV].reverse().map((v) => {
    const prev = sortedV.find((x) => x.version === v.version - 1) ?? null;
    const status = v.startAt && Number(v.startAt) > now ? "Scheduled" : v === liveV ? "Live" : "Past";
    return {
      name: `Version ${v.version}`,
      date: dateS(Number(v.startAt ?? v.ts)),
      change: changeText(prev?.targetBps ?? null, v.targetBps, syms),
      reason: v.reason || "—",
      status,
      pillBg: status === "Scheduled" ? "#2E2311" : status === "Live" ? "#11261B" : "#1F1F23",
      pillFg: status === "Scheduled" ? "#F5B14C" : status === "Live" ? UP : "#B4B4BB",
    };
  });
  const sched = sortedV.find((v) => v.startAt && Number(v.startAt) > now) ?? null;
  const banner = sched
    ? {
        title: `Version ${sched.version} in ${Math.max(1, Math.round((Number(sched.startAt) - now) / 3600))}h`,
        change: changeText(sortedV.find((x) => x.version === sched.version - 1)?.targetBps ?? ix?.targetBps ?? null, sched.targetBps, syms),
      }
    : null;

  const txs = i.events.map((e) => {
    const type = e.kind.charAt(0).toUpperCase() + e.kind.slice(1);
    const v = e.kind === "sell" ? usdc(e.data?.gross ?? e.usdc) : usdc(e.usdc);
    return {
      time: ago(Number(e.ts), now),
      type,
      value: e.usdc || e.data?.gross ? money(v, 2) : "—",
      units: e.units ? wad(e.units).toFixed(2) : "—",
      wallet: e.account ? short(e.account) : "Router",
      col: type === "Sell" ? DOWN : type === "Buy" ? UP : "#F5B14C",
    };
  });
  const holders = i.holders.map((h) => {
    const u = wad(h.units);
    return {
      wallet: short(h.holder),
      units: u.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
      value: level === null ? "—" : money(u * level, 0),
      share: `${(h.shareBps / 100).toFixed(1)}%`,
      creator: !!ix && h.holder.toLowerCase() === ix.creator.toLowerCase(),
    };
  });
  const tag = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
  const volPct = i.assessment?.volatility.annualizedPct ?? null;

  const sides = (["Buy", "Sell"] as Side[]).map((s) => ({
    label: s,
    on: s === side ? "true" : "false",
    bg: s === side ? "#2A2A2F" : "transparent",
    fg: s === side ? "#F2F2F3" : GREY,
    pick: () => i.actions.setSide(s),
  }));
  const toSign = (): void => {
    if (wrongNet) return i.actions.switchChain();
    if (!i.wallet.connected) return i.actions.connect();
    i.actions.sign();
  };

  return withInitials({
    ix: {
      name: ix?.name ?? "—",
      ticker,
      byS: ix ? `by ${short(ix.creator)}` : "",
      levelS: level === null ? "—" : level.toFixed(2),
      holdersS: i.holders.length >= 200 ? "200+" : String(i.holders.length),
      boughtS: ix ? vol(usdc(ix.volumeUsdc)) : "—",
      volS: volPct === null ? "—" : `${volPct.toFixed(0)}%`,
    },
    _href: ix ? { IndexDetail: `/index/${ix.id}`, Create: `/create?fork=${ix.id}`, Review: "#rv-title" } : {},
    banner,
    chart: buildChart(levelCandles(i.levels), 2),
    chartTitle: `${ix?.name ?? "—"} · 1D`,
    chartAria: "Daily candlestick chart of the index level",
    chartSource: ix?.badge ?? null,
    chg24: perfs[3],
    perf: perfs,
    mix: { stocksS: `Stocks ${stocksPct}%`, tokensS: `Tokens ${100 - stocksPct}%`, stocks: stocksPct },
    assess: i.assessment
      ? { text: i.assessment.notes.join(" ") || "—", tag1: tag(i.assessment.concentration.label), tag2: volPct === null ? "" : `Volatility ${volPct.toFixed(0)}%` }
      : { text: "—", tag1: "", tag2: "" },
    note: `1 ${ticker} = ${level === null ? "—" : `$${level.toFixed(2)}`}, backed by the ${legs.length} assets held in the index vault`,
    tabs: (["Composition", "Transactions", "Rebalances", "Holders"] as Tab[]).map((t) => ({
      label: t,
      on: t === tab ? "true" : "false",
      fg: t === tab ? "#F2F2F3" : GREY,
      line: t === tab ? "#9052F9" : "transparent",
      pick: () => i.actions.setTab(t),
    })),
    txs,
    versions,
    holders,
    tabComp: tab === "Composition",
    tabTx: tab === "Transactions",
    tabReb: tab === "Rebalances",
    tabHold: tab === "Holders",
    rows,
    amt: i.ui.amt,
    onAmt: (e: { target: { value: string } }) => {
      if (amountInputOk(e.target.value, side === "Buy" ? 6 : 18)) i.actions.setAmt(e.target.value);
    },
    unit: side === "Buy" ? "USDC" : ticker,
    sides,
    recv: side === "Buy" ? unitsS : sellOut === null ? "—" : sellOut.toFixed(2),
    getSym: side === "Buy" ? ticker : "USDC",
    tokStocks: side === "Buy" ? stocksPct : 0,
    tokRight: side === "Buy" ? "#9052F9" : "#2775CA",
    fee: fee === null ? "—" : money(fee, 2),
    cta: side === "Buy" ? { bg: "#F2F2F3", label: "Buy index" } : { bg: DOWN, label: `Sell for ${sellOut === null ? "—" : money(sellOut, 2)}` },
    // modal
    payS: money(amt, 2),
    unitsArrow: `→ ${unitsS} ${ticker}`,
    legsR,
    feeS: fee === null ? "—" : money(fee, 2),
    creatorFeeS: fee === null ? "—" : ix?.isPublic ? `0.20% · ${money((fee * 20) / 50, 2)}` : "0.00% · $0.00",
    minS: `${q?.minUnits ? wad(q.minUnits).toFixed(2) : "—"} ${ticker}`,
    signText: `One signature mints ${unitsS} ${ticker}.`,
    ownText: `You own ${unitsS} ${ticker}`,
    doneSub: `${ix?.name ?? "—"} · tx ${i.tx.status === "confirmed" ? short(i.tx.hash) : "—"}`,
    heldS: `${unitsS} · ${units === null || level === null ? "—" : money(units * level, 2)}`,
    isReview: step === "review",
    isSigning: step === "signing",
    isDone: step === "done",
    toSign,
    toDone: () => undefined,
    notices,
    status,
    back: () => i.actions.back(),
    me: i.me,
  });
}
