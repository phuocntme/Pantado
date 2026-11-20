import { ago, amountInputOk, bigAmount, DOWN, money, smallDp, tinyNum, UP, vol, withInitials } from "../lib/fmt";
import { short } from "../lib/nav";
import { estimateSwap, type Side as EstSide } from "../lib/estimate";
import { logoAvatar, logoFill } from "../lib/logos";
import type { Scope } from "../lib/tpl";
import type { Me } from "../lib/chrome";
import type { AssetDetail, BoardRowView, CandlesView, IndexView, PoolView, SwapQuote, TradeView } from "./asset.api";
import { buildChart, type ChartModel } from "./asset.chart";
import { buysPausedNotice, errorNotice, networkLabel, perf, staleNotice, txLine, wrongNetworkNotice, type Notice, type Perf, type TxLine, type TxStateLike } from "./asset.states";

export type Side = "Buy" | "Sell";
export type Tab = "Pools" | "Transactions";

export const USDC_DOT = "#2775CA";
const GREY = "#8E8E96";

export interface QuoteState<Q> {
  data: Q | null;
  error: { code: string; message: string } | null;
}

export interface AssetInput {
  asset: AssetDetail | null;
  candles: CandlesView | null;
  pools: PoolView[];
  trades: TradeView[];
  board: BoardRowView | null;
  indexes: IndexView[];
  quote: QuoteState<SwapQuote>;
  ui: { side: Side; amt: string; tab: Tab };
  tx: TxStateLike;
  wallet: { connected: boolean; chainOk: boolean };
  env: { network: string; explorer: string; nowSec: number; deployed: boolean; /** router fee for the instant estimate */ swapFeeBps?: number };
  actions: { setSide: (s: Side) => void; setAmt: (v: string) => void; setTab: (t: Tab) => void; submit: () => void; connect: () => void; switchChain: () => void };
  me: Me;
}

export interface PoolRow {
  name: string;
  sub: string;
  pair: string;
  price: string;
  liq: string;
  vol: string;
  role: "route" | "source" | "check";
}

/** "$169.95" / "$74,357" / "$0.2134" like the reference price cells. */
export function priceS(usd: number | null | undefined): string {
  if (usd === null || usd === undefined || !Number.isFinite(usd)) return "—";
  if (usd >= 1000) return `$${Math.round(usd).toLocaleString("en-US")}`;
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  return `$${tinyNum(usd) ?? usd.toFixed(usd >= 0.01 ? 4 : smallDp(usd))}`;
}

/** Whole tokens from base units (number, for display only). */
export const fromBase = (raw: string | bigint, decimals: number): number => Number(BigInt(raw)) / 10 ** decimals;

/** "2.9400" asset amounts / "1,234.56" USDC amounts. */
export function amountS(n: number, dp: number): string {
  return bigAmount(n, dp);
}

/** Venue volume over the last 24h from the trade list; null when the list may be truncated. */
export function volume24h(trades: TradeView[], nowSec: number, pageSize = 100): number | null {
  const since = nowSec - 86400;
  const recent = trades.filter((t) => Number(t.ts) >= since);
  if (trades.length >= pageSize && recent.length === trades.length) return null;
  return recent.reduce((s, t) => s + fromBase(t.usdc, 6), 0);
}

/** Change over `days` from daily candles; null when the history is shorter. */
export function changeOver(c: CandlesView | null, days: number, nowSec: number): number | null {
  const cs = c?.candles ?? [];
  const last = cs[cs.length - 1];
  if (!last) return null;
  const at = nowSec - days * 86400;
  const old = [...cs].reverse().find((k) => k.t <= at);
  return old && old.c > 0 ? last.c / old.c - 1 : null;
}

export function poolRows(a: AssetDetail, pools: PoolView[], pxs: string, vol24: number | null): PoolRow[] {
  let refSeen = 0;
  return pools.map((p) => {
    if (p.kind === "route")
      return {
        name: p.name ?? "Pantado venue",
        sub: `${p.network === "fuji" ? "Avalanche Fuji" : networkLabel(p.network ?? "")} · fills your trade`,
        pair: `${a.execution.symbol} / USDC`,
        price: pxs,
        liq: "—",
        vol: vol24 === null ? "—" : vol(vol24),
        role: "route" as const,
      };
    const chain = p.chain === "robinhood" ? "Robinhood Chain" : "Avalanche";
    const first = refSeen++ === 0;
    return {
      name: "Reference pool",
      sub: first ? `${chain} · sets the price` : chain,
      pair: `${p.dex ?? "Pool"} · ${short(p.address)}`,
      price: "—",
      liq: "—",
      vol: "—",
      role: first ? ("source" as const) : ("check" as const),
    };
  });
}

/** Asset page view model — same shape as reference/logic/asset.js plus the live slot data. */
export function assetVM(i: AssetInput): Scope {
  const a = i.asset;
  const { side, tab } = i.ui;
  const sym = a?.displaySymbol ?? "—";
  const isStock = a?.kind === "stock";
  const px = a?.price?.usd ?? null;
  const pxs = priceS(px);
  const amt = Number(i.ui.amt) || 0;
  const usd = px === null ? null : side === "Buy" ? amt : amt * px;
  const cap = isStock ? (a?.risk?.sizeCapUsd ?? null) : null;
  const capS = cap === null ? "—" : money(cap, 0);
  const qErr = i.quote.error;
  const stale = !!a && (a.price?.fresh === false || a.venue?.fresh === false || qErr?.code === "PriceStale");
  const buysPaused = side === "Buy" && ((a?.venue?.kind === "stock-venue" && a.venue.buysPaused) || qErr?.code === "BuysPausedFor");
  const capped = (cap !== null && usd !== null && usd > cap) || qErr?.code === "SizeCapExceeded";
  const wrongNet = i.wallet.connected && !i.wallet.chainOk;
  const pending = i.tx.status === "pending";

  const notices: Notice[] = [];
  if (wrongNet) notices.push(wrongNetworkNotice(i.env.network));
  if (!i.env.deployed && a) notices.push(errorNotice("Trading is not available: Pantado is not deployed on this network yet."));
  if (stale) notices.push(staleNotice(sym, sym, a?.price?.ts ?? null, i.env.nowSec, false));
  if (buysPaused) notices.push(buysPausedNotice(sym));
  if (capped) notices.push({ tone: "red", title: `Above the ${capS} per-trade limit.`, body: "Lower the amount or split it into two trades." });
  if (qErr && !["PriceStale", "BuysPausedFor", "SizeCapExceeded"].includes(qErr.code)) notices.push(errorNotice(qErr.message));

  const decimals = a?.decimals ?? 18;
  const q = i.quote.data;
  // the exact on-chain quote when it is in; until then an instant estimate from the price on screen
  const usdcSide: EstSide = { usd: 1, spreadBps: 0, isUsdc: true };
  const assetSide: EstSide = { usd: px, spreadBps: a?.risk?.spreadBps ?? 0, isUsdc: false };
  const est = !q && a ? estimateSwap(amt, side === "Buy" ? usdcSide : assetSide, side === "Buy" ? assetSide : usdcSide, i.env.swapFeeBps ?? 0) : null;
  const recvN = q ? (side === "Buy" ? fromBase(q.amountOut, decimals) : fromBase(q.amountOut, 6)) : (est?.out ?? null);
  const recv = amt === 0 ? "0" : recvN === null ? "—" : amountS(recvN, side === "Buy" ? 4 : 2);
  const fee = q ? `$${fromBase(q.fee, 6).toFixed(2)}` : est ? `$${est.feeUsd.toFixed(2)}` : "—";
  const usdcTok = { sym: "USDC", dot: USDC_DOT, ...logoAvatar("usdc") };
  const assetTok = { sym, dot: a?.color ?? GREY, ...logoAvatar(a?.id) };
  const getSym = side === "Buy" ? sym : "USDC";

  const blocked = stale || buysPaused || capped || pending || !i.env.deployed || !a;
  const cta = wrongNet
    ? { bg: "#F2F2F3", fg: "#0B0B0D", label: `Switch to ${networkLabel(i.env.network)}` }
    : capped
      ? { bg: "#1F1F23", fg: GREY, label: `Max ${capS} per trade` }
      : stale || buysPaused
        ? { bg: "#1F1F23", fg: GREY, label: `${side} paused` }
        : pending
          ? { bg: "#1F1F23", fg: GREY, label: "Confirm in your wallet" }
          : side === "Buy"
            ? { bg: "#F2F2F3", fg: "#0B0B0D", label: `Buy ${sym}` }
            : { bg: DOWN, fg: "#0B0B0D", label: `Sell ${sym}` };
  const swap = (): void => {
    if (wrongNet) return i.actions.switchChain();
    if (!i.wallet.connected) return i.actions.connect();
    if (!blocked && amt > 0) i.actions.submit();
  };

  const sides = (["Buy", "Sell"] as Side[]).map((s) => ({
    label: s,
    on: s === side ? "true" : "false",
    bg: s === side ? "#2A2A2F" : "transparent",
    fg: s === side ? "#F2F2F3" : GREY,
    pick: () => i.actions.setSide(s),
  }));
  const tabs = (["Pools", "Transactions"] as Tab[]).map((t) => ({
    label: t,
    on: t === tab ? "true" : "false",
    fg: t === tab ? "#F2F2F3" : GREY,
    line: t === tab ? "#9052F9" : "transparent",
    pick: () => i.actions.setTab(t),
  }));
  const txs = i.trades.map((t) => {
    const n = fromBase(t.amount, decimals);
    const u = fromBase(t.usdc, 6);
    const s = t.side === "sell" ? "Sell" : "Buy";
    return { time: ago(Number(t.ts), i.env.nowSec), side: s, px: n > 0 ? priceS(u / n) : "—", amt: amountS(n, 4), value: money(u, 2), wallet: short(t.account), col: s === "Sell" ? DOWN : UP };
  });

  const vol24 = volume24h(i.trades, i.env.nowSec);
  const chart: ChartModel = buildChart(i.candles?.candles ?? []);
  const b = i.board;
  const perfs: Perf[] = [perf("24H", b?.change24h), perf("7D", b?.change7d), perf("30D", b?.change30d), perf("90D", changeOver(i.candles, 90, i.env.nowSec))];
  const exec = a?.execution.address?.toLowerCase() ?? null;
  const holding = exec
    ? i.indexes
        .map((x) => ({ x, k: x.assets.findIndex((y) => y.toLowerCase() === exec) }))
        .filter((r) => r.k >= 0)
        .map((r) => ({ name: r.x.name, w: `${Math.round((r.x.targetBps[r.k] ?? 0) / 100)}%`, href: `/index/${r.x.id}` }))
    : [];
  const status: TxLine | null = txLine(
    i.tx,
    { pendingSub: `One signature ${side === "Buy" ? "buys" : "sells"} ${side === "Buy" ? `${recv} ${sym}` : `${amt} ${sym}`}`, confirmed: `Swapped. You received ${recv} ${getSym}.`, failed: `${side} failed` },
    i.env.network,
    i.env.explorer,
  );

  return withInitials({
    a: {
      sym,
      execSym: a?.execution.symbol ?? "—",
      name: a?.name ?? "—",
      kindS: a ? (isStock ? "Stock" : "Token") : "—",
      badge: a ? (a.badge ?? a.dataSource) : "",
      // header avatar: logo, else the asset's color (the reference fill is NVIDIA green)
      avBg: logoFill(a?.id) ?? a?.color ?? GREY,
      ...(logoFill(a?.id) ? { ini2: "" } : {}),
    },
    pxS: pxs,
    // the asset's market (reference pools on mainnet); the Pantado venue row below keeps the app's own trades
    vol24S: b?.volume24hUsd === null || b?.volume24hUsd === undefined ? "—" : vol(b.volume24hUsd),
    liqS: "—",
    capS,
    routeName: isStock ? "Pantado stock venue" : "Pantado token venue",
    spreadS: a?.risk ? `${(a.risk.spreadBps / 100).toFixed(2)}%` : "—",
    chart,
    chartTitle: `${sym} / USDC · 1D`,
    chartAria: `Daily candlestick chart of ${sym}`,
    chartSource: i.candles?.source ?? null,
    poolRows: a ? poolRows(a, i.pools, pxs, vol24) : [],
    perf: perfs,
    chg24: perfs[0],
    notices,
    status,
    inIndexes: { title: `In ${holding.length} ${holding.length === 1 ? "index" : "indexes"}`, rows: holding },
    amt: i.ui.amt,
    onAmt: (e: { target: { value: string } }) => {
      // Buy pays USDC (6 decimals), Sell pays the asset
      if (amountInputOk(e.target.value, side === "Buy" ? 6 : decimals)) i.actions.setAmt(e.target.value);
    },
    swap,
    over: notices.length > 0,
    done: status !== null,
    doneText: `Swapped. You received ${recv} ${getSym}.`,
    sides,
    tabs,
    txs,
    tabPools: tab === "Pools",
    tabTx: tab === "Transactions",
    pay: side === "Buy" ? usdcTok : assetTok,
    get: side === "Buy" ? assetTok : usdcTok,
    recv,
    fee,
    cta,
    me: i.me,
  });
}
