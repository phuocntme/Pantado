import { DOWN, UP, withInitials } from "../lib/fmt";
import type { Scope } from "../lib/tpl";
import { logoAvatar, logoFill } from "../lib/logos";
import type { Me } from "../lib/chrome";
import type { AssetView, CreateQuote } from "./asset.api";
import { errorNotice, staleNotice, txLine, wrongNetworkNotice, type Notice, type TxLine, type TxStateLike } from "./asset.states";
import type { QuoteState } from "./asset.vm";
import type { Backtest } from "./create.metrics";
import type { Mode, PresetKey } from "./create.draft";

export type KindFilter = "All" | "Stocks" | "Tokens";
export type Vis = "Private" | "Public";
export type Step = "edit" | "review" | "done";

export const TICKER_RE = /^[A-Z0-9]{2,6}$/;
export const MIN_FIRST_BUY = 100;
export const MAX_ASSETS = 20;

export interface CreateState {
  picked: string[];
  w: Record<string, number>;
  f: KindFilter;
  search: string;
  name: string;
  ticker: string;
  description: string;
  vis: Vis;
  mode: Mode;
  drift: number; // θ in percent (10–200)
  first: string;
  step: Step;
}

export interface CreateInput {
  s: CreateState;
  assets: AssetView[];
  tickerTaken: boolean | null;
  creationFee: bigint | null; // USDC base units (factory limits or quote)
  presetError: string | null;
  backtest: Backtest | null;
  slip: number | null;
  quote: QuoteState<CreateQuote>;
  tx: TxStateLike;
  created: { index: string | null; units: string | null } | null;
  wallet: { connected: boolean; chainOk: boolean };
  env: { network: string; explorer: string; nowSec: number; deployed: boolean };
  actions: {
    set: (p: Partial<CreateState>) => void;
    toggle: (id: string) => void;
    setW: (id: string, v: number) => void;
    preset: (p: PresetKey) => void;
    review: () => void;
    confirm: () => void;
    connect: () => void;
    switchChain: () => void;
  };
  me: Me;
}

const KIND: Record<KindFilter, AssetView["kind"] | null> = { All: null, Stocks: "stock", Tokens: "token" };
const GREY = "#8E8E96";

const usdc = (raw: bigint | string | null | undefined, dp = 2): string | null => (raw === null || raw === undefined ? null : (Number(BigInt(raw)) / 1e6).toFixed(dp));
/** "5" for whole amounts, "5.50" otherwise. */
const usdcShort = (raw: bigint): string => {
  const n = Number(raw) / 1e6;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
};

/** First failing rule as the reference CTA label, or null when the form is valid. */
export function validate(s: CreateState, tickerTaken: boolean | null): string | null {
  const total = s.picked.reduce((x, id) => x + (s.w[id] ?? 0), 0);
  const first = Number(s.first) || 0;
  if (total !== 100) return "Weights must total 100%";
  if (s.picked.length < 2) return "Add at least 2 assets";
  if (s.picked.some((id) => (s.w[id] ?? 0) < 1)) return "Every asset needs at least 1%";
  if (s.ticker.length < 2) return "Add a ticker";
  if (!TICKER_RE.test(s.ticker)) return "Ticker must be 2–6 characters, A–Z or 0–9.";
  if (tickerTaken) return "This ticker is already taken.";
  if (!s.name.trim()) return "Add a name";
  if (first < MIN_FIRST_BUY) return "First buy is at least 100 USDC";
  return null;
}

/** Create view model — same shape as reference/logic/create.js. */
export function createVM(i: CreateInput): Scope {
  const { s, actions } = i;
  const byId = new Map(i.assets.filter((a) => a.kind !== "quote").map((a) => [a.id, a]));
  const kindS = (a: AssetView): string => (a.kind === "stock" ? "Stock" : "Token");
  const q = s.search.trim().toLowerCase();
  const catalog = [...byId.values()]
    .filter((a) => !KIND[s.f] || a.kind === KIND[s.f])
    .filter((a) => !q || a.id.includes(q) || a.displaySymbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q))
    .map((a) => {
      const on = s.picked.includes(a.id);
      return {
        sym: a.displaySymbol,
        name: a.name,
        kind: kindS(a),
        dot: a.color,
        ...logoAvatar(a.id),
        on: on ? "true" : "false",
        btn: on ? "Added" : "Add",
        bg: on ? "#1F1F23" : "#F2F2F3",
        fg: on ? "#B4B4BB" : "#0B0B0D",
        toggle: () => actions.toggle(a.id),
      };
    });
  const sel = s.picked.map((id) => byId.get(id)).filter((a): a is AssetView => !!a);
  const basket = sel.map((a) => ({
    sym: a.displaySymbol,
    kind: kindS(a),
    dot: a.color,
    ...logoAvatar(a.id),
    w: s.w[a.id] ?? 0,
    label: `Weight of ${a.displaySymbol}`,
    rmLabel: `Remove ${a.displaySymbol}`,
    set: (e: { target: { value: string } }) => actions.setW(a.id, Number(e.target.value)),
    remove: () => actions.toggle(a.id),
  }));
  const total = basket.reduce((x, b) => x + b.w, 0);
  const t = total || 1;
  const stocks = sel.filter((a) => a.kind === "stock").reduce((x, a) => x + (s.w[a.id] ?? 0), 0);
  const first = Number(s.first) || 0;
  const invalid = validate(s, i.tickerTaken);
  const isPublic = s.vis === "Public";
  const ticker = s.ticker.toUpperCase();
  const bt = i.backtest;
  const pctS = (f: number, dp: number, sign: boolean): string => `${sign && f >= 0 ? "+" : ""}${(f * 100).toFixed(dp)}%`;

  const qd = i.quote.data;
  const qErr = i.quote.error;
  const fee = qd ? BigInt(qd.creationFee) : i.creationFee;
  const unitsN = qd ? Number(BigInt(qd.units)) / 1e18 : null;
  const createdUnits = i.created?.units ? Number(BigInt(i.created.units)) / 1e18 : unitsN;
  const wrongNet = i.wallet.connected && !i.wallet.chainOk;
  const notices: Notice[] = [];
  if (wrongNet) notices.push(wrongNetworkNotice(i.env.network));
  if (!i.env.deployed) notices.push(errorNotice("Creating is not available: Pantado is not deployed on this network yet."));
  if (i.presetError) notices.push({ tone: "amber", title: i.presetError, body: "Your weights were kept." });
  if (i.tickerTaken && s.step === "edit") notices.push(errorNotice("This ticker is already taken."));
  const staleA = sel.find((a) => a.price?.fresh === false);
  if (s.step === "review" && (qErr?.code === "PriceStale" || staleA)) {
    const sym = staleA?.displaySymbol ?? "An asset";
    notices.push(staleNotice(sym, "this basket", staleA?.price?.ts ?? null, i.env.nowSec, false));
  } else if (s.step === "review" && qErr) notices.push(errorNotice(qErr.message));
  const status: TxLine | null =
    s.step === "done"
      ? null
      : txLine(
          i.tx,
          { pendingSub: `One signature creates ${ticker} and buys every asset`, confirmed: `Created ${ticker}`, failed: "Create failed" },
          i.env.network,
          i.env.explorer,
        );
  const confirm = (): void => {
    if (wrongNet) return actions.switchChain();
    if (!i.wallet.connected) return actions.connect();
    if (!qd || i.tx.status === "pending" || notices.length > 0) return;
    actions.confirm();
  };

  return withInitials({
    chips: (["All", "Stocks", "Tokens"] as KindFilter[]).map((c) => ({
      label: c,
      on: c === s.f ? "true" : "false",
      bg: c === s.f ? "#F2F2F3" : "#1A1A1D",
      fg: c === s.f ? "#0B0B0D" : "#B4B4BB",
      pick: () => actions.set({ f: c }),
    })),
    catalog,
    basket,
    presets: [
      { label: "Equal", pick: () => actions.preset("equal") },
      { label: "Market cap", pick: () => actions.preset("marketcap") },
      { label: "Low volatility", pick: () => actions.preset("lowvol") },
    ],
    vis: (["Private", "Public"] as Vis[]).map((x) => ({
      label: x,
      on: x === s.vis ? "true" : "false",
      bg: x === s.vis ? "#2A2A2F" : "transparent",
      fg: x === s.vis ? "#F2F2F3" : GREY,
      pick: () => actions.set({ vis: x }),
    })),
    isPublic,
    segs: basket.map((b) => ({ w: b.w, dot: b.dot })),
    total,
    totalCol: total === 100 ? UP : "#F5B14C",
    mixText: total ? `Stocks ${Math.round((stocks / t) * 100)}% · Tokens ${100 - Math.round((stocks / t) * 100)}%` : "Add assets to start",
    ret: bt ? pctS(bt.ret, 1, true) : "—",
    retCol: bt ? (bt.ret >= 0 ? UP : DOWN) : GREY,
    vol: bt ? `${(bt.vol * 100).toFixed(0)}%` : "—",
    dd: bt ? pctS(bt.dd, 1, false) : "—",
    slip: i.slip === null ? "—" : `${(i.slip * 100).toFixed(2)}%`,
    disabled: invalid ? "true" : "false",
    created: s.step === "done" || notices.length > 0 || status !== null,
    isDone: s.step === "done",
    reviewing: s.step === "review",
    createdText: `${isPublic ? "Published " : "Created "}${ticker}. You hold ${createdUnits === null ? "—" : createdUnits.toFixed(2)} units.`,
    createdSub: isPublic
      ? "It is listed in the Marketplace. You earn 0.20% of every buy and sell."
      : "Private: it is not listed in the Marketplace. Only you see it, in Portfolio › Your indexes. You can make it public later.",
    _href: i.created?.index ? { IndexDetail: `/index/${i.created.index}` } : {},
    visLabel: isPublic ? "Public" : "Private",
    modeSummary: s.mode === "Auto" ? `Auto at ${s.drift}% drift` : s.mode,
    firstS: `${first.toFixed(2)} USDC`,
    creationFeeS: fee === null ? "—" : `${usdc(fee)} USDC`,
    feeLine: `Creation fee ${fee === null ? "—" : usdcShort(fee)} USDC`,
    tradeFee: qd ? `${usdc(qd.tradeFee)} USDC` : "—",
    payS: qd ? `${usdc(qd.totalUsdc)} USDC` : "—",
    unitsS: `${unitsN === null ? "—" : unitsN.toFixed(2)} ${ticker} at level 100`,
    name: s.name,
    ticker: s.ticker,
    onTicker: (e: { target: { value: string } }) => actions.set({ ticker: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) }),
    back: () => actions.set({ step: "edit" }),
    confirm,
    create: () => {
      if (!invalid) actions.review();
    },
    cta: !invalid
      ? { bg: "#F2F2F3", fg: "#0B0B0D", label: `Review: ${isPublic ? "publish" : "create"} and buy` }
      : { bg: "#1F1F23", fg: GREY, label: invalid },
    modes: (["Off", "Manual", "Auto"] as Mode[]).map((m) => ({
      label: m,
      on: m === s.mode ? "true" : "false",
      bg: m === s.mode ? "#2A2A2F" : "transparent",
      fg: m === s.mode ? "#F2F2F3" : GREY,
      pick: () => actions.set({ mode: m }),
    })),
    modeText: { Off: "Weights move with prices. The basket never changes.", Manual: "You publish new weights. Holders get 48h notice.", Auto: "Rebalances itself when an asset drifts too far." }[s.mode],
    isAuto: s.mode === "Auto",
    drift: s.drift,
    onDrift: (e: { target: { value: string } }) => actions.set({ drift: Number(e.target.value) }),
    driftEx: `A 20% target triggers below ${(20 * (1 - s.drift / 100)).toFixed(0)}% or above ${(20 * (1 + s.drift / 100)).toFixed(0)}%.`,
    first: s.first,
    onFirst: (e: { target: { value: string } }) => actions.set({ first: e.target.value }),
    notices,
    status,
    me: i.me,
  });
}
