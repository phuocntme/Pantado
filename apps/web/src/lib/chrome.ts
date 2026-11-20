"use client";
import { useMemo } from "react";
import { useApi } from "./api";
import { CONFIG, networkNames } from "./config";
import { money } from "./fmt";
import { short } from "./nav";
import { useWallet } from "./wallet";

export interface PortfolioSummary {
  walletTotalUsd: number;
  positions: { valueUsdWad: string }[];
}

export interface Me {
  gasS: string;
  /** top-bar network badge ("Fuji testnet"; "Local test chain" on the dev stack) */
  netBadge?: string;
  short: string;
  balanceS: string;
  address: string | null;
}

/** Top-bar account chrome shared by every screen (`me.*`). */
export function useChrome(): { me: Me } {
  const w = useWallet();
  const pf = useApi<PortfolioSummary>(w.address ? `/portfolio/${w.address}` : null, 15_000);
  const total = pf.data ? pf.data.walletTotalUsd + pf.data.positions.reduce((s, p) => s + Number(p.valueUsdWad) / 1e18, 0) : null;
  const me = useMemo(
    () => ({ netBadge: networkNames(CONFIG.network).badge, gasS: CONFIG.flags.gasSponsorship && CONFIG.paymasterUrl ? "Sponsored" : "Paid in test AVAX", short: short(w.address), balanceS: total === null ? "—" : money(total, 0), address: w.address }),
    [w.address, total],
  );
  return { me };
}
