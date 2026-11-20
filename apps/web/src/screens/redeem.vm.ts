/**
 * Redeem view model — reference/logic/redeem.js: the Portfolio behind the modal (pos, mine, assets, split,
 * walletTotal, walletDay, plus header totals under `bg`) and the in-kind redeem review (isReview, isDone, toDone).
 * Redeem needs no price and charges no fee: amounts are the holder's pro-rata share of each vault balance.
 */
import { money, pct, pctCol, withInitials, DOWN, UP } from "../lib/fmt";
import { logoAvatar, logoFill } from "../lib/logos";
import type { Me } from "../lib/chrome";
import { short } from "../lib/nav";
import { fixed, fromBase, MODE, UNIT_DECIMALS, USDC_DECIMALS, wad, type AssetInfo, type BoardAsset, type Composition, type IndexDetail, type Portfolio } from "./index.data";

export interface RedeemInput {
  id: string;
  detail: IndexDetail | null;
  comp: Composition | null;
  portfolio: Portfolio | null;
  assets: AssetInfo[] | null;
  board: BoardAsset[] | null;
  /** Units to redeem from the URL (`?units=`, whole units); default = the whole position. */
  unitsParam: bigint | null;
  me: Me;
}
export interface RedeemState {
  forfeit: string[]; // lower-case asset addresses the holder unticked
  step: "review" | "done";
  txHash: string | null;
  pending: boolean;
}
export interface RedeemHandlers {
  toggle: (asset: string) => void;
  redeem: (units: bigint, forfeit: string[]) => void;
}

const KIND: Record<string, string> = { stock: "Stock", token: "Token", quote: "Cash" };

/** "1.5743" / "0.003598" / "24.66": four significant digits like the reference. */
export function sig(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  return n >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 0 }) : Number(n.toPrecision(n >= 1 ? 5 : 4)).toString();
}

/** Held units of `id` and the units this redeem uses (URL amount capped at the position). */
export function redeemUnits(p: Portfolio | null, id: string, param: bigint | null): { held: bigint; units: bigint } {
  const pos = p?.positions.find((x) => x.index.id.toLowerCase() === id.toLowerCase());
  const held = pos ? BigInt(pos.units) : 0n;
  const units = param !== null && param > 0n && param < held ? param : held;
  return { held, units };
}

function background(input: RedeemInput) {
  const p = input.portfolio;
  const assets = input.assets ?? [];
  const kindOfAddr = (a: string): string | undefined => assets.find((x) => x.execution.address?.toLowerCase() === a.toLowerCase())?.kind;
  const positions = p?.positions ?? [];

  const pos = positions.map((x) => {
    const units = fromBase(x.units, UNIT_DECIMALS);
    const pnl = x.pnlUsdWad === null ? Number.NaN : wad(x.pnlUsdWad);
    const pnlS = Number.isFinite(pnl) ? `${pnl >= 0 ? "+" : "-"}${money(Math.abs(pnl), 2)}` : "—";
    const d = Number(x.maxDriftBps) / 100;
    return {
      id: x.index.id,
      name: x.index.name,
      units: `${fixed(units, 1)} ${x.index.ticker}`,
      value: money(wad(x.valueUsdWad), 2),
      pnl: pnlS,
      drift: !Number.isFinite(d) ? "—" : d < 1 ? "On target" : `${d.toFixed(1)}% drift`,
      needs: false,
      ok: true,
      pillBg: "#11261B",
      pillFg: "#3DD68C",
      pnlCol: pnlS === "—" ? "#8E8E96" : pnlS.charAt(0) === "-" ? DOWN : UP,
      _href: { IndexDetail: `/index/${x.index.id}`, Redeem: `/redeem/${x.index.id}` },
    };
  });

  const mine = (p?.yourIndexes ?? []).map((ix) => {
    const held = positions.find((x) => x.index.id.toLowerCase() === ix.id.toLowerCase());
    const pub = ix.isPublic;
    return {
      name: ix.name,
      units: `You hold ${held ? fixed(fromBase(held.units, UNIT_DECIMALS)) : "0.00"} ${ix.ticker}`,
      mode: ix.mode === MODE.Manual ? "Manual" : ix.mode === MODE.Auto ? (ix.driftBps > 0 ? `Auto · ${Math.round(ix.driftBps / 100)}% drift` : "Auto") : "Off",
      holders: pub ? "—" : "Only you",
      earned: "—",
      status: pub ? "Public" : "Private",
      pillBg: pub ? "#1F1F23" : "#221637",
      pillFg: pub ? "#F2F2F3" : "#C9B3FD",
      href: `/index/${ix.id}`,
      manual: ix.mode === MODE.Manual,
      _href: { Version: `/version/${ix.id}` },
    };
  });

  const wallet = p?.wallet ?? [];
  const wTot = p?.walletTotalUsd ?? 0;
  let acc = 0;
  const walletAssets = wallet.map((x) => {
    const info = assets.find((a) => a.id === x.id);
    const share = wTot > 0 ? (x.valueUsd / wTot) * 100 : 0;
    const before = acc;
    acc += share;
    const ch = info?.kind === "quote" ? null : (input.board ?? []).find((b) => b.id === x.id)?.change24h;
    const d = pct(ch);
    return {
      sym: x.symbol,
      kind: KIND[info?.kind ?? ""] ?? "—",
      amt: sig(fromBase(x.amount, x.decimals)),
      value: money(x.valueUsd, 2),
      d,
      dot: x.color,
      ...logoAvatar(x.id),
      dCol: d === "—" ? "#8E8E96" : pctCol(d),
      pct: `${share.toFixed(1)}%`,
      pctW: `${share.toFixed(1)}%`,
      dash: `${share.toFixed(2)} ${(100 - share).toFixed(2)}`,
      off: String(((100 - before) % 100).toFixed(2)),
    };
  });

  // allocation of everything you hold: wallet assets by kind + index positions split by their target weights
  let stocks = 0;
  let tokens = 0;
  let cash = 0;
  for (const x of wallet) {
    const k = assets.find((a) => a.id === x.id)?.kind;
    if (k === "stock") stocks += x.valueUsd;
    else if (k === "quote") cash += x.valueUsd;
    else tokens += x.valueUsd;
  }
  for (const x of positions) {
    const v = wad(x.valueUsdWad);
    if (!Number.isFinite(v)) continue;
    const sBps = x.index.assets.reduce((s, a, i) => s + (kindOfAddr(a) === "stock" ? (x.index.targetBps[i] ?? 0) : 0), 0);
    stocks += (v * sBps) / 10_000;
    tokens += (v * (10_000 - sBps)) / 10_000;
  }
  const total = stocks + tokens + cash;
  const share = (x: number): number => (total > 0 ? Math.round((x / total) * 100) : 0);
  const wshare = (k: string): number => (wTot > 0 ? (wallet.filter((x) => assets.find((a) => a.id === x.id)?.kind === k).reduce((s, x) => s + x.valueUsd, 0) / wTot) * 100 : 0);
  const claim = p ? fromBase(p.creatorEarnings.claimableUsdc, USDC_DECIMALS) : Number.NaN;

  return {
    pos,
    mine,
    assets: walletAssets,
    split: [
      { label: "Stocks", col: "#76B900", pct: `${wshare("stock").toFixed(1)}%` },
      { label: "Tokens", col: "#E84142", pct: `${wshare("token").toFixed(1)}%` },
      { label: "Cash", col: "#2775CA", pct: `${wshare("quote").toFixed(1)}%` },
    ],
    walletTotal: p ? money(wTot, 2) : "—",
    walletDay: "—",
    bg: {
      totalS: p ? money(total, 2) : "—",
      pnl30S: "—",
      earnedS: money(claim, 2),
      claimS: fixed(claim, 2),
      stocksL: `Stocks ${p ? `${share(stocks)}%` : "—"}`,
      tokensL: `Tokens ${p ? `${share(tokens)}%` : "—"}`,
      cashL: `USDC ${p ? `${share(cash)}%` : "—"}`,
      alloc: { stocks: share(stocks), tokens: share(tokens), cash: share(cash) },
    },
  };
}

export function redeemVM(input: RedeemInput, st: RedeemState, h: RedeemHandlers) {
  const { comp, detail, assets } = input;
  const ticker = detail?.ticker ?? "—";
  const { held, units } = redeemUnits(input.portfolio, input.id, input.unitsParam);
  const supply = comp ? BigInt(comp.supply) : 0n;
  const unitsN = fromBase(units.toString(), UNIT_DECIMALS);

  const legs = (comp?.legs ?? []).map((l) => {
    const info = assets?.find((a) => a.id === l.id);
    const amountBase = supply > 0n ? (BigInt(l.balance) * units) / supply : 0n;
    const usd = supply > 0n ? wad(((BigInt(l.valueUsdWad) * units) / supply).toString()) : Number.NaN;
    const asset = l.asset.toLowerCase();
    return {
      asset,
      sym: l.symbol ?? short(l.asset),
      color: info?.color ?? "#8E8E96",
      /** avatar fill: the logo when the asset has one */
      logo: logoFill(l.id),
      amt: info ? sig(fromBase(amountBase.toString(), info.decimals)) : "—",
      usdN: usd,
      usd: money(usd, 2),
      checked: !st.forfeit.includes(asset),
      toggle: () => h.toggle(asset),
    };
  });
  const kept = legs.filter((l) => l.checked);
  const value = kept.reduce((s, l) => s + (Number.isFinite(l.usdN) ? l.usdN : 0), 0);
  const unitsS = fixed(unitsN, 2);
  const canRedeem = units > 0n && kept.length > 0 && !st.pending;

  return withInitials({
    me: input.me,
    ...background(input),
    name: detail?.name ?? "—",
    ticker,
    held,
    units,
    amountS: `${unitsS} ${ticker}`,
    valueS: comp ? money(value, 2) : "—",
    unitsL: `${Number(unitsS.replace(/,/g, "")) % 1 === 0 ? fixed(unitsN, 0) : unitsS} ${ticker}`,
    legs,
    canRedeem,
    empty: input.portfolio !== null && held === 0n,
    doneTokens: `${kept.length} ${kept.length === 1 ? "token" : "tokens"}`,
    txShort: st.txHash ? short(st.txHash) : "—",
    isReview: st.step === "review",
    isDone: st.step === "done",
    toDone: () => {
      if (canRedeem) h.redeem(units, st.forfeit);
    },
    _href: { Portfolio: "/portfolio" },
  });
}
