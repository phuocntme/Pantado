/**
 * Spec §12 states as plain data (rendered with the States page markup by asset.parts.tsx). Pure, unit-tested.
 */
import { DOWN, pct, UP } from "../lib/fmt";
import { networkNames } from "../lib/config";
import { short } from "../lib/nav";

export type Tone = "amber" | "red" | "blue";
export interface Notice {
  tone: Tone;
  title: string;
  body: string;
  action?: { label: string; run: () => void };
}

export interface TxLine {
  dot: string;
  title: string;
  sub: string;
  href?: string;
}

export interface Perf {
  label: string;
  value: string;
  col: string;
}

/** Structural copy of `TxState` from lib/wallet (kept here so view models stay pure). */
export type TxStateLike =
  | { status: "idle" }
  | { status: "pending"; hash?: string }
  | { status: "confirmed"; hash: string }
  | { status: "failed"; error: { code: string; message: string } };

export const networkLabel = (n: string): string => (n ? networkNames(n).label : "");

/** "6 minutes" / "2 hours" / "3 days" for a stale price age. */
export function ageText(tsSec: number, nowSec: number): string {
  const s = Math.max(0, Math.floor(nowSec - tsSec));
  if (s < 120) return `${s} seconds`;
  if (s < 7200) return `${Math.floor(s / 60)} minutes`;
  if (s < 172800) return `${Math.floor(s / 3600)} hours`;
  return `${Math.floor(s / 86400)} days`;
}

export function staleNotice(sym: string, what: string, priceTs: number | null, nowSec: number, redeem: boolean): Notice {
  return {
    tone: "amber",
    title: priceTs ? `${sym} price is ${ageText(priceTs, nowSec)} old.` : `${sym} price is out of date.`,
    body: `Buying and selling ${what} is paused until it updates.${redeem ? " You can still redeem from Portfolio." : ""}`,
  };
}

export function buysPausedNotice(sym: string): Notice {
  return { tone: "amber", title: `New ${sym} buys are paused.`, body: `The stock venue reached its limit for ${sym}. Selling and redeem stay open.` };
}

/** The screen's main button already reads "Switch to …" and switches: the notice explains, it adds no second button. */
export function wrongNetworkNotice(network: string): Notice {
  const net = networkLabel(network);
  return {
    tone: "amber",
    title: "Your wallet is on another network.",
    body: `Pantado trades on ${net} while in testnet. Use the button below to switch your wallet.`,
  };
}

export function errorNotice(message: string): Notice {
  return { tone: "red", title: message, body: "" };
}

/** Transaction pending / confirmed / failed lines (States › Transaction status). */
export function txLine(
  s: TxStateLike,
  copy: { pendingSub: string; confirmed: string; failed: string },
  network: string,
  explorer: string,
): TxLine | null {
  if (s.status === "idle") return null;
  if (s.status === "pending") return { dot: "#C9B3FD", title: "Confirm in your wallet", sub: copy.pendingSub };
  if (s.status === "confirmed")
    return { dot: UP, title: copy.confirmed, sub: `Confirmed on ${networkLabel(network)} · ${short(s.hash)}`, href: explorer ? `${explorer}/tx/${s.hash}` : undefined };
  return { dot: DOWN, title: copy.failed, sub: s.error.message };
}

/** Performance cell with sign color ("—" when unknown). */
export function perf(label: string, f: number | null | undefined, digits = 1): Perf {
  const value = pct(f, digits);
  return { label, value, col: value === "—" ? "#8E8E96" : value.charAt(0) === "-" ? DOWN : UP };
}
