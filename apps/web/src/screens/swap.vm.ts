import { short } from "../lib/nav";
import type { Scope } from "../lib/tpl";
import { amountInputOk, bigAmount, usdAmount } from "../lib/fmt";
import { estimateSwap, type Side as EstSide } from "../lib/estimate";
import { logoAvatar, logoFill } from "../lib/logos";
import type { Me } from "../lib/chrome";
import type { AssetView, SwapQuote } from "./asset.api";
import { errorNotice, staleNotice, txLine, wrongNetworkNotice, type Notice, type TxLine, type TxStateLike } from "./asset.states";
import { fromBase, priceS, type QuoteState } from "./asset.vm";

export type PickSide = "from" | "to";

export interface SwapInput {
  assets: AssetView[];
  /** `/assets/search?q=` result for the current query (null while not searched). */
  search: { data: AssetView[] | null; error: { code: string; message: string } | null };
  ui: { from: string; to: string; amt: string; pick: PickSide | null; q: string };
  quote: QuoteState<SwapQuote>;
  tx: TxStateLike;
  wallet: { connected: boolean; chainOk: boolean };
  env: { network: string; explorer: string; nowSec: number; deployed: boolean; /** router fee for the instant estimate */ swapFeeBps?: number };
  actions: {
    setAmt: (v: string) => void;
    setQ: (v: string) => void;
    open: (p: PickSide) => void;
    close: () => void;
    choose: (p: PickSide, id: string) => void;
    flip: () => void;
    submit: () => void;
    connect: () => void;
    switchChain: () => void;
  };
  me: Me;
}

const ini = (s: string): string => s.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase();
const sym = (a: AssetView | undefined): string => a?.displaySymbol ?? "—";

/** Amount like the reference swap card: "1,234.56" for large, "12.3456" / "0.123456" for small. */
export function recvFmt(n: number): string {
  if (n >= 1e6) return bigAmount(n, 2);
  return n >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : n.toFixed(n < 1 ? 6 : 4);
}

export const usdS = (n: number): string => usdAmount(n);

const isAddr = (q: string): boolean => q.trim().toLowerCase().startsWith("0x");

/** Swap view model — same shape as reference/logic/swap.js. */
export function swapVM(i: SwapInput): Scope {
  const { ui } = i;
  const byId = new Map(i.assets.map((a) => [a.id, a]));
  const f = byId.get(ui.from);
  const t = byId.get(ui.to);
  const amt = Number(ui.amt) || 0;
  const fpx = f?.price?.usd ?? (f?.kind === "quote" ? 1 : null);
  const other = ui.pick === "from" ? ui.to : ui.from;
  const q = ui.q.trim();
  const pool = q ? (i.search.data ?? []) : i.assets;
  const results = pool
    .filter((a) => a.id !== other)
    .map((a) => ({
      sym: a.displaySymbol,
      ini: ini(a.displaySymbol),
      dot: a.color,
      ...logoAvatar(a.id, "ini"),
      name: a.name,
      addr: a.execution.address ? short(a.execution.address) : a.display.address ? short(a.display.address) : "—",
      px: a.kind === "quote" ? "$1.00" : priceS(a.price?.usd),
      pick: () => ui.pick && i.actions.choose(ui.pick, a.id),
    }));
  const searching = !!q && i.search.data === null && i.search.error === null;
  const stock = f?.kind === "stock" || t?.kind === "stock";

  const qd = i.quote.data;
  // the exact on-chain quote when it is in; until then an instant estimate from the prices on screen
  const sideOf = (a: AssetView): EstSide => ({ usd: a.price?.usd ?? null, spreadBps: a.risk?.spreadBps ?? 0, isUsdc: a.kind === "quote" });
  const est = !qd && f && t ? estimateSwap(amt, sideOf(f), sideOf(t), i.env.swapFeeBps ?? 0) : null;
  const recvN = qd && t ? fromBase(qd.amountOut, t.kind === "quote" ? 6 : t.decimals) : (est?.out ?? null);
  const wrongNet = i.wallet.connected && !i.wallet.chainOk;
  const qErr = i.quote.error;
  const staleA = [f, t].find((a) => a && a.kind !== "quote" && a.price?.fresh === false);
  const notices: Notice[] = [];
  if (wrongNet) notices.push(wrongNetworkNotice(i.env.network));
  if (!i.env.deployed) notices.push(errorNotice("Trading is not available: Pantado is not deployed on this network yet."));
  if (staleA || qErr?.code === "PriceStale") {
    const s = staleA ? sym(staleA) : `${sym(f)} or ${sym(t)}`;
    notices.push(staleNotice(s, s, staleA?.price?.ts ?? null, i.env.nowSec, false));
  } else if (qErr) notices.push(errorNotice(qErr.message));
  const pending = i.tx.status === "pending";
  const status: TxLine | null = txLine(
    i.tx,
    { pendingSub: `One signature swaps ${ui.amt} ${sym(f)} for ${recvN === null ? "—" : recvFmt(recvN)} ${sym(t)}`, confirmed: `You received ${recvN === null ? "—" : recvFmt(recvN)} ${sym(t)}`, failed: "Swap failed" },
    i.env.network,
    i.env.explorer,
  );
  const go = (): void => {
    if (wrongNet) return i.actions.switchChain();
    if (!i.wallet.connected) return i.actions.connect();
    if (pending || !qd || notices.length > 0 || amt <= 0) return;
    i.actions.submit();
  };

  return {
    swapping: !ui.pick,
    picking: !!ui.pick,
    pickTitle: ui.pick === "from" ? "You pay with" : "You receive",
    q: ui.q,
    onQ: (e: { target: { value: string } }) => i.actions.setQ(e.target.value),
    close: () => i.actions.close(),
    results,
    none: results.length === 0 && !searching,
    noneText: isAddr(q) ? "No listed asset at this contract address. Pantado only trades assets in its registry." : `No stock or token matches “${ui.q}”.`,
    amt: ui.amt,
    onAmt: (e: { target: { value: string } }) => {
      if (amountInputOk(e.target.value, f ? (f.kind === "quote" ? 6 : f.decimals) : 18)) i.actions.setAmt(e.target.value);
    },
    from: { sym: sym(f), ini: ini(sym(f)), dot: f?.color ?? "#8E8E96", ...logoAvatar(f?.id, "ini"), open: () => i.actions.open("from") },
    to: { sym: sym(t), ini: ini(sym(t)), dot: t?.color ?? "#8E8E96", ...logoAvatar(t?.id, "ini"), open: () => i.actions.open("to") },
    fromUsd: fpx === null ? "—" : usdS(amt * fpx),
    recv: amt === 0 ? "0" : recvN === null ? "—" : recvN > 0 ? recvFmt(recvN) : "0",
    rate: recvN && recvN > 0 ? `1 ${sym(t)} = ${recvFmt(amt / recvN)} ${sym(f)}` : "—",
    route: stock ? "Pantado stock venue" : "Pantado token venue",
    fee: qd ? usdS(fromBase(qd.fee, 6)) : est ? usdS(est.feeUsd) : "—",
    flip: () => i.actions.flip(),
    go,
    done: status !== null || notices.length > 0,
    notices,
    status,
    me: i.me,
  };
}
