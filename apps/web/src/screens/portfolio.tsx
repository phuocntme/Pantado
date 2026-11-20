"use client";
import { useCallback, useEffect, useMemo } from "react";
import { tx } from "@pantado/sdk";
import { useApi } from "../lib/api";
import { useChrome } from "../lib/chrome";
import { CONFIG } from "../lib/config";
import { nav } from "../lib/nav";
import { Shell } from "../lib/shell";
import { bool, css, lookup, type Scope } from "../lib/tpl";
import { useTx, useWallet } from "../lib/wallet";
import { PortfolioScreen, title } from "./gen/Portfolio.gen";
import { EmptyPortfolio, LoadingRows, str, TxRow } from "./portfolio.parts";
import { useMany } from "./portfolio.hooks";
import { portfolioVM, type AssetMeta, type BoardChange, type Composition, type PortfolioResp } from "./portfolio.vm";

export default function Portfolio() {
  const w = useWallet();
  const { me } = useChrome();
  const t = useTx();
  const pf = useApi<PortfolioResp>(w.address ? `/portfolio/${w.address}` : null, 15_000);
  const assets = useApi<AssetMeta[]>("/assets");
  const board = useApi<BoardChange[]>("/board", 30_000);

  const posIds = useMemo(() => (pf.data?.positions ?? []).map((p) => p.index.id.toLowerCase()), [pf.data]);
  const pubIds = useMemo(() => (pf.data?.yourIndexes ?? []).filter((i) => i.isPublic).map((i) => i.id.toLowerCase()), [pf.data]);
  const planStatus = useMany<{ plan: { status: number | string } }, number>(posIds, (id) => `/indexes/${id}`, (r) => Number(r.plan.status), 30_000);
  const composition = useMany<Composition, Composition>(posIds, (id) => `/indexes/${id}/composition`, (r) => r, 30_000);
  const holders = useMany<unknown[], number>(pubIds, (id) => `/indexes/${id}/holders`, (r) => r.length, 60_000);

  const feeSplitter = CONFIG.deployment?.contracts.feeSplitter ?? null;
  const claim = useCallback(() => {
    if (!w.address || !feeSplitter) return;
    void t.run([tx.claim(feeSplitter, w.address)]);
  }, [w.address, feeSplitter, t]);
  const reload = pf.reload;
  useEffect(() => {
    if (t.state.status === "confirmed") reload();
  }, [t.state.status, reload]);

  const v = useMemo(
    () =>
      portfolioVM({
        connected: w.address !== null,
        loading: w.address !== null && pf.loading,
        pf: pf.data,
        assets: assets.data ?? [],
        board: board.data ?? [],
        planStatus,
        holders,
        composition,
        claiming: t.state.status === "pending",
        claim,
        me,
      }),
    [w.address, pf.loading, pf.data, assets.data, board.data, planStatus, holders, composition, t.state.status, claim, me],
  );

  const slots = {
    walletDay: (s: Scope) => <span style={{ ...css("font-size: 13px"), color: String(lookup("walletDayCol", s) ?? "#8E8E96") }}>{`${String(lookup("walletDay", s) ?? "—")} today`}</span>,
    pnlTotal: (s: Scope) => {
      const txt = str("pnl30S", s);
      const col = txt.startsWith("-") ? "#FF6B6B" : txt.startsWith("+") ? "#3DD68C" : "#F2F2F3";
      return <div style={css(`margin-top: 8px; font-family: 'Inter Tight', sans-serif; font-size: 30px; font-weight: 600; letter-spacing: -0.02em; color: ${col}`)}>{txt}</div>;
    },
    claimButton: (s: Scope) => {
      const on = bool(s.canClaim) && feeSplitter !== null;
      const st = t.state;
      return (
        <>
          <button
            type="button"
            disabled={!on}
            onClick={claim}
            style={css(
              on
                ? "margin-top: 10px; min-height: 40px; padding: 0 14px; background: #F2F2F3; color: #0B0B0D; border: 0; border-radius: 10px; font-size: 13px; font-weight: 700"
                : "margin-top: 10px; min-height: 40px; padding: 0 14px; background: #1F1F23; color: #8E8E96; border: 0; border-radius: 10px; font-size: 13px; font-weight: 700",
            )}
          >
            {str("claimLabel", s)}
          </button>
          {st.status === "pending" && <TxRow dot="#C9B3FD" title="Confirm in your wallet" sub={str("claimLabel", s)} />}
          {st.status === "confirmed" && <TxRow dot="#3DD68C" title="Claimed" sub={`Confirmed on ${CONFIG.network.charAt(0).toUpperCase()}${CONFIG.network.slice(1)} · ${st.hash.slice(0, 6)}…${st.hash.slice(-4)}`} />}
          {st.status === "failed" && <TxRow dot="#FF6B6B" title="Claim failed" sub={st.error.message} />}
        </>
      );
    },
    allocBar: (s: Scope) => (
      <div style={css("display: flex; height: 8px; gap: 2px; border-radius: 4px; overflow: hidden")} aria-hidden="true">
        {bool((s.alloc as Scope | undefined)?.known) ? (
          <>
            <span style={css(`display: block; width: ${str("alloc.stocksW", s)}; background: #F2F2F3`)}></span>
            <span style={css(`display: block; width: ${str("alloc.tokensW", s)}; background: #E84142`)}></span>
            <span style={css(`display: block; width: ${str("alloc.usdcW", s)}; background: #2775CA`)}></span>
          </>
        ) : (
          <span style={css("display: block; width: 100%; background: #1F1F23")}></span>
        )}
      </div>
    ),
    positionsHead: (s: Scope) => (
      <>
        <h2 style={css("margin: 0; padding: 16px 20px 10px; font-size: 16px; font-weight: 600")}>{"Index positions"}</h2>
        {bool(s.loading) ? <LoadingRows /> : bool(s.noPositions) || bool(s.empty) ? <EmptyPortfolio v={s} nav={nav} /> : null}
      </>
    ),
  };

  return (
    <Shell title={title}>
      <PortfolioScreen v={v} nav={nav} slots={slots} />
    </Shell>
  );
}
