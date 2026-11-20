"use client";
import dynamic from "next/dynamic";
import { createContext, type ReactNode } from "react";
import type { Address } from "viem";
import { CONFIG } from "./config";

export interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, fn: (...a: unknown[]) => void): void;
}

export type SocialMethod = "google" | "twitter" | "email";

/** What the wallet layer needs from Privy: sign-in with Google, X or email, and the embedded wallet. */
export interface PrivyBridge {
  ready: boolean;
  authenticated: boolean;
  login(method: SocialMethod, email?: string): void;
  logout(): Promise<void>;
  /** `embedded`: the wallet Privy made at sign-in (no other way to get gas, so auto-fund may send some) */
  wallet: { address: Address; embedded: boolean; provider(): Promise<Eip1193> } | null;
  /** the signed-in user's Privy access token (the API verifies it before sending gas) */
  accessToken(): Promise<string | null>;
}

/** null when no Privy app id is configured: the app connects browser wallets only. */
export const PrivyCtx = createContext<PrivyBridge | null>(null);

// the auth SDK is loaded only when an app id is configured
const PrivyRoot = dynamic(() => import("./privy-provider").then((m) => m.PrivyRoot), { ssr: false });

/** Wraps the app in Privy when `NEXT_PUBLIC_PRIVY_APP_ID` is set. */
export function MaybePrivy({ children }: { children: ReactNode }) {
  if (!CONFIG.privyAppId) return <>{children}</>;
  return <PrivyRoot appId={CONFIG.privyAppId}>{children}</PrivyRoot>;
}
