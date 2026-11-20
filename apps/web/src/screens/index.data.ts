/**
 * API shapes (services/api/src/server.ts) used by the Index, Private, New version and Redeem screens, plus
 * small pure helpers shared by their view models. Bigints arrive as decimal strings.
 */
import { bigAmount } from "../lib/fmt";

export const WAD = 1e18;
/** USDC base units (spec §5.3: quote is USDC, 6 decimals). */
export const USDC_DECIMALS = 6;
/** Index units are ERC-20 with 18 decimals (spec §5.1). */
export const UNIT_DECIMALS = 18;
/** Index level starts at 100 (spec §5.3). */
export const START_LEVEL = 100;

/** Rebalancer.Mode / Rebalancer.Status (contracts/src/rebalance/Rebalancer.sol). */
export const MODE = { Off: 0, Manual: 1, Auto: 2 } as const;
export const PLAN = { None: 0, Scheduled: 1, Active: 2 } as const;

export interface IndexDetail {
  id: string;
  ticker: string;
  name: string;
  description: string;
  creator: string;
  isPublic: boolean;
  mode: number;
  driftBps: number;
  assets: string[];
  targetBps: number[];
  version: number;
  supply: string;
  level: string;
  value: string;
  volumeUsdc: string;
  createdAt: string;
  badge: string | null;
  visibility: "public" | "private";
  plan?: {
    mode: number;
    version: number;
    status: number;
    startAt: string;
    auctionLive: boolean;
    pendingMode: number | null;
    pendingAt: string | null;
  };
}

export interface CompositionLeg {
  asset: string;
  id: string | null;
  symbol: string | null;
  kind: "stock" | "token" | "quote" | null;
  balance: string;
  priceWad: string;
  fresh: boolean;
  valueUsdWad: string;
  currentBps: number;
  targetBps: number;
  driftBps: number;
}
export interface Composition {
  level: string;
  value: string;
  supply: string;
  maxDriftBps: number | string;
  allFresh: boolean;
  legs: CompositionLeg[];
}

export interface IndexEvent {
  id: string;
  kind: string;
  account: string | null;
  usdc: string | null;
  units: string | null;
  data: Record<string, unknown> | null;
  ts: string;
  txHash: string;
}

export interface PlanRow {
  planId: number;
  status: string;
  manual: boolean;
  startAt: string;
  startedAt: string | null;
  endedAt: string | null;
  value: string | null;
  lossBudget: string | null;
  loss: string | null;
  traded: string | null;
}
export interface AuctionRow {
  planId: number;
  auctionId: number;
  sellAsset: string;
  buyAsset: string;
  lot: string;
  filled: string;
  endAt: string;
  ts: string;
}
export interface VersionRow {
  version: number;
  targetBps: number[];
  reason: string;
  startAt: string;
  ts: string;
}
export interface Rebalances {
  plans: PlanRow[];
  auctions: AuctionRow[];
  fills: unknown[];
  versions: VersionRow[];
}

export interface Holder {
  holder: string;
  units: string;
  shareBps: number;
}

export interface Levels {
  badge: string | null;
  levels: { block: string; ts: string; level: string }[];
}

/** `/assets` row (only the fields these screens read). */
export interface AssetInfo {
  id: string;
  symbol: string;
  displaySymbol?: string;
  name: string;
  kind: "stock" | "token" | "quote";
  decimals: number;
  color: string;
  execution: { address: string | null };
}

/** `/board` asset row (24h / 30d change per asset). */
export interface BoardAsset {
  id: string;
  kind: string;
  change24h: number | null;
  change30d: number | null;
}

export interface QuoteBuy {
  side: "buy";
  usdcIn: string;
  fee: string;
  units: string;
  minUnits: string;
}
export interface QuoteSell {
  side: "sell";
  units: string;
  fee: string;
  gross: string;
  usdcOut: string;
  minOut: string;
}
export type Quote = QuoteBuy | QuoteSell;

export interface PortfolioPosition {
  index: IndexDetail;
  units: string;
  valueUsdWad: string;
  costUsdc: string;
  pnlUsdWad: string | null;
  unknownCostBasis: boolean;
  maxDriftBps: number | string;
}
export interface Portfolio {
  address: string;
  positions: PortfolioPosition[];
  yourIndexes: IndexDetail[];
  wallet: { id: string; symbol: string; color: string; amount: string; decimals: number; valueUsd: number; shareBps: number }[];
  walletTotalUsd: number;
  creatorEarnings: { claimableUsdc: string };
}

// ------------------------------------------------------------------ helpers

/** Base-unit string → number of whole tokens. Safe for display only. */
export const fromBase = (raw: string | null | undefined, decimals: number): number => {
  if (raw === null || raw === undefined || raw === "") return Number.NaN;
  try {
    return Number(BigInt(raw)) / 10 ** decimals;
  } catch {
    return Number.NaN;
  }
};
export const wad = (raw: string | null | undefined): number => fromBase(raw, 18);

/** Whole-token decimal string → base units (truncates extra decimals). null when not a positive number. */
export function toBase(s: string, decimals: number): bigint | null {
  const t = s.trim();
  if (!/^\d*\.?\d*$/.test(t) || t === "" || t === ".") return null;
  const [i = "0", f = ""] = t.split(".");
  const v = BigInt(i || "0") * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
  return v > 0n ? v : null;
}

export const fixed = (n: number, dp = 2): string =>
  !Number.isFinite(n) ? "—" : Math.abs(n) >= 1e6 ? bigAmount(n, dp) : n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

/** "$169.95" / "$74,357" like the reference price column. */
export function priceS(usd: number): string {
  if (!Number.isFinite(usd)) return "—";
  const d = usd >= 1000 ? 0 : 2;
  return `$${usd.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}

/** Duration until `targetSec`: "18h", "2d", "35m". */
export function until(targetSec: number, nowSec: number): string {
  const s = Math.max(0, targetSec - nowSec);
  if (s > 3 * 86400) return `${Math.round(s / 86400)}d`;
  if (s >= 3600) return `${Math.round(s / 3600)}h`;
  return `${Math.max(1, Math.round(s / 60))}m`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Nov 13" (UTC). */
export function dayLabel(tsSec: number): string {
  const d = new Date(tsSec * 1000);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
export const monthName = (m: number): string => MONTHS[m] ?? "";

/** Asset symbol for an execution address, from composition legs or `/assets`. */
export function symbolOf(addr: string, legs: CompositionLeg[], assets: AssetInfo[]): string {
  const a = addr.toLowerCase();
  const leg = legs.find((l) => l.asset.toLowerCase() === a);
  if (leg?.symbol) return leg.symbol;
  const info = assets.find((x) => x.execution.address?.toLowerCase() === a);
  return info ? (info.displaySymbol ?? info.symbol) : `${addr.slice(0, 6)}…`;
}

/** "NVDA 25 → 30% · AVAX 15 → 10%" between two target vectors over the same assets. */
export function changeText(symbols: string[], from: number[] | null, to: number[]): string {
  if (!from) return "—";
  const parts: string[] = [];
  symbols.forEach((s, i) => {
    const a = Math.round((from[i] ?? 0) / 100);
    const b = Math.round((to[i] ?? 0) / 100);
    if (a !== b) parts.push(`${s} ${a} → ${b}%`);
  });
  return parts.length ? parts.join(" · ") : "No weight changes";
}

export const MODE_LABEL = (mode: number, driftBps: number): string =>
  mode === MODE.Manual
    ? "Manual · creator publishes versions"
    : mode === MODE.Auto
      ? driftBps > 0
        ? `Auto · ${Math.round(driftBps / 100)}% drift`
        : "Auto"
      : "Off · weights drift with prices";
