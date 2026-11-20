"use client";
import { useMemo, useState } from "react";
import { parseUnits, type Address } from "viem";
import { tx as txb } from "@pantado/sdk";
import { apiPost, useApi } from "../lib/api";
import { useChrome } from "../lib/chrome";
import { CONFIG } from "../lib/config";
import { nav } from "../lib/nav";
import { Shell } from "../lib/shell";
import { css, lookup, type Scope } from "../lib/tpl";
import { useTx, useWallet } from "../lib/wallet";
import { useQuote } from "./asset";
import type { AssetView, SwapQuote } from "./asset.api";
import { Notices, TxStatusLine } from "./asset.parts";
import type { Notice, TxLine } from "./asset.states";
import { SwapScreen, title } from "./gen/Swap.gen";
import { swapVM, type PickSide } from "./swap.vm";

const slots = {
  status: (s: Scope) => {
    const l = lookup("status", s) as TxLine | null;
    return (
      <div style={css("display: flex; flex-direction: column; gap: 8px")}>
        <Notices list={(lookup("notices", s) as Notice[]) ?? []} />
        {l ? <TxStatusLine s={l} /> : null}
      </div>
    );
  },
};

/** Execution address of a registry asset (deployment first, API second). */
const addrOf = (a: AssetView | undefined): Address | null => {
  if (!a) return null;
  const dep = CONFIG.deployment;
  if (a.kind === "quote") return (dep?.contracts.usdc as Address | undefined) ?? (a.execution.address as Address | null);
  return (dep?.assets[a.id] as Address | undefined) ?? (a.execution.address as Address | null);
};

export default function Swap() {
  const [from, setFrom] = useState("usdc");
  const [to, setTo] = useState("nvda");
  const [amt, setAmt] = useState("1000");
  const [pick, setPick] = useState<PickSide | null>(null);
  const [q, setQ] = useState("");
  const w = useWallet();
  const t = useTx();
  const { me } = useChrome();
  const assets = useApi<AssetView[]>("/assets", 15_000);
  const qs = q.trim();
  const search = useApi<AssetView[]>(qs ? `/assets/search?q=${encodeURIComponent(qs)}` : null);
  const byId = useMemo(() => new Map((assets.data ?? []).map((a) => [a.id, a])), [assets.data]);
  const f = byId.get(from);
  const tt = byId.get(to);
  const tokenIn = addrOf(f);
  const tokenOut = addrOf(tt);
  const amountIn = useMemo(() => {
    try {
      return f ? parseUnits(amt || "0", f.kind === "quote" ? 6 : f.decimals) : 0n;
    } catch {
      return 0n;
    }
  }, [amt, f]);
  const qKey = tokenIn && tokenOut && amountIn > 0n ? `${tokenIn}:${tokenOut}:${amountIn}` : null;
  const quote = useQuote<SwapQuote>(qKey, () => apiPost<SwapQuote>("/quote/swap", { tokenIn, tokenOut, amountIn: amountIn.toString() }));

  const v = swapVM({
    assets: assets.data ?? [],
    search: {
      data: qs && search.data && !search.loading ? search.data : null,
      error: qs && search.error && !search.loading ? { code: search.error.code, message: search.error.message } : null,
    },
    ui: { from, to, amt, pick, q },
    quote: assets.error ? { data: null, error: { code: assets.error.code, message: assets.error.message } } : quote,
    tx: t.state,
    wallet: { connected: w.address !== null, chainOk: w.chainOk },
    env: { network: CONFIG.network, explorer: CONFIG.explorer, nowSec: Math.floor(Date.now() / 1000), deployed: !!CONFIG.deployment, swapFeeBps: CONFIG.swapFeeBps },
    actions: {
      setAmt: (x) => {
        setAmt(x);
        if (t.state.status !== "pending") t.reset();
      },
      setQ,
      open: (p) => setPick(p),
      close: () => {
        setPick(null);
        setQ("");
      },
      choose: (p, id) => {
        if (p === "from") setFrom(id);
        else setTo(id);
        setPick(null);
        setQ("");
        t.reset();
      },
      flip: () => {
        setFrom(to);
        setTo(from);
        t.reset();
      },
      submit: () => {
        const router = CONFIG.deployment?.contracts.swapRouter;
        if (!router || !tokenIn || !tokenOut || !w.address || !quote.data) return;
        void t.run([txb.approve(tokenIn, router, amountIn), txb.swap(router, tokenIn, tokenOut, amountIn, BigInt(quote.data.minOut), w.address)]);
      },
      connect: () => void w.connect().catch(() => undefined),
      switchChain: () => void w.switchChain(),
    },
    me,
  });
  return (
    <Shell title={title}>
      <SwapScreen v={v} nav={nav} slots={slots} />
    </Shell>
  );
}
