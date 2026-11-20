"use client";
/**
 * Review purchase (reference route `review`): the index page with the "Review purchase" modal for an
 * index buy. Mount as `<ReviewPurchase index="0x…" amount="1000" />` (e.g. from the index page's
 * "Buy index" CTA). The Create flow's own review step uses the Create screen's review dialog.
 */
import { useEffect, useMemo, useState } from "react";
import { parseUnits, type Address } from "viem";
import { tx as txb } from "@pantado/sdk";
import { apiPost, useApi } from "../lib/api";
import { useChrome } from "../lib/chrome";
import { CONFIG } from "../lib/config";
import { DEFAULT_INTERVAL, IntervalBar, intervalSpec, type IntervalLabel } from "../lib/intervals";
import { nav } from "../lib/nav";
import { Shell } from "../lib/shell";
import { css, lookup, type Scope } from "../lib/tpl";
import { useTx, useWallet } from "../lib/wallet";
import { assetSlots, useQuote } from "./asset";
import type { AssetView, BoardRowView, IndexView } from "./asset.api";
import { NoticeBox, TxStatusLine, ZoomCandleChart } from "./asset.parts";
import type { Notice, TxLine } from "./asset.states";
import type { Side } from "./asset.vm";
import { ReviewScreen, title } from "./gen/Review.gen";
import { levelCandles, reviewVM, type AssessmentView, type BasketQuote, type CompositionView, type HolderView, type IndexEventView, type LevelPoint, type Step, type Tab, type VersionView } from "./review.vm";

const slots = {
  chart: assetSlots.chart!,
  chg24: assetSlots.chg24!,
  perf: assetSlots.perf!,
  banner: (s: Scope) => {
    const b = lookup("banner", s) as { title: string; change: string } | null;
    if (!b) return null;
    return (
      <a
        style={css("display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; padding: 12px 16px; background: #1E1A12; border: 1px solid #3A2F17; border-radius: 14px; font-size: 14px")}
        href={nav("Version", s)}
      >
        <span style={css("padding: 4px 10px; border-radius: 999px; background: #3A2F17; color: #F5B14C; font-size: 12px; font-weight: 600")}>{b.title}</span>
        <span>{b.change}</span>
        <span style={css("margin-left: auto; color: #F5B14C; font-weight: 600")}>{"View changes"}</span>
      </a>
    );
  },
  mixBar: (s: Scope) => {
    const st = Number(lookup("mix.stocks", s) ?? 0);
    return (
      <div style={css("display: flex; height: 6px; gap: 2px; border-radius: 3px; overflow: hidden")} aria-hidden="true">
        <span style={css(`display: block; width: ${st}%; background: #F2F2F3`)}></span>
        <span style={css(`display: block; width: ${100 - st}%; background: #9052F9`)}></span>
      </div>
    );
  },
  signing: (s: Scope) => {
    const notices = (lookup("notices", s) as Notice[]) ?? [];
    const l = lookup("status", s) as TxLine | null;
    const back = lookup("back", s) as () => void;
    const stuck = notices.length > 0 || (l !== null && l.dot !== "#C9B3FD");
    return (
      <div style={css("width: 100%; display: flex; flex-direction: column; gap: 8px; text-align: left")}>
        {notices.map((n, k) => (
          <NoticeBox key={k} n={n} />
        ))}
        {l ? <TxStatusLine s={l} /> : null}
        {stuck ? (
          <button
            type="button"
            onClick={back}
            style={css("width: 100%; min-height: 52px; background: #1A1A1D; color: #F2F2F3; border: 0; border-radius: 12px; font-size: 15px; font-weight: 600")}
          >
            {"Back"}
          </button>
        ) : null}
      </div>
    );
  },
};

export default function ReviewPurchase({ index, amount = "1000" }: { index: string; amount?: string }) {
  const [side, setSide] = useState<Side>("Buy");
  const [amt, setAmt] = useState(amount);
  const [tab, setTab] = useState<Tab>("Composition");
  const [iv, setIv] = useState<IntervalLabel>(DEFAULT_INTERVAL);
  const [step, setStep] = useState<Step>("review");
  const w = useWallet();
  const t = useTx();
  const { me } = useChrome();
  const id = encodeURIComponent(index);
  const ix = useApi<IndexView>(`/indexes/${id}`, 30_000);
  const comp = useApi<CompositionView>(`/indexes/${id}/composition`, 15_000);
  const levels = useApi<{ levels: LevelPoint[] }>(`/indexes/${id}/levels?limit=1000`, 60_000);
  const events = useApi<IndexEventView[]>(`/indexes/${id}/transactions`, 30_000);
  const holders = useApi<HolderView[]>(`/indexes/${id}/holders`, 60_000);
  const reb = useApi<{ versions: VersionView[] }>(`/indexes/${id}/rebalances`, 60_000);
  const board = useApi<BoardRowView[]>("/board", 30_000);
  const assets = useApi<AssetView[]>("/assets", 60_000);
  const [assess, setAssess] = useState<AssessmentView | null>(null);
  useEffect(() => {
    if (!CONFIG.agentUrl) return;
    let live = true;
    fetch(`${CONFIG.agentUrl}/assessment/${id}`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<AssessmentView>) : null))
      .then((a) => live && setAssess(a))
      .catch(() => live && setAssess(null));
    return () => {
      live = false;
    };
  }, [id]);

  const amountIn = useMemo(() => {
    try {
      return parseUnits(amt || "0", side === "Buy" ? 6 : 18);
    } catch {
      return 0n;
    }
  }, [amt, side]);
  const qKey = amountIn > 0n ? `${index}:${side}:${amountIn}` : null;
  const quote = useQuote<BasketQuote>(qKey, () => apiPost<BasketQuote>("/quote/basket", { index, side: side === "Buy" ? "buy" : "sell", amount: amountIn.toString() }));

  const sign = (): void => {
    setStep("signing");
    const dep = CONFIG.deployment;
    const q = quote.data;
    if (!dep || !q || !w.address || side !== "Buy" || !q.minUnits) return;
    const vault = index as Address;
    void t.run([txb.approve(dep.contracts.usdc, vault, amountIn), txb.buy(vault, amountIn, BigInt(q.minUnits), w.address)]).then((h) => {
      if (h) {
        setStep("done");
        holders.reload();
        events.reload();
      }
    });
  };

  const v = reviewVM({
    ix: ix.data,
    comp: comp.data,
    board: board.data ?? [],
    assets: assets.data ?? [],
    levels: levels.data?.levels ?? [],
    events: events.data ?? [],
    holders: holders.data ?? [],
    versions: reb.data?.versions ?? [],
    assessment: assess,
    quote: ix.error ? { data: null, error: { code: ix.error.code, message: ix.error.message } } : quote,
    ui: { side, amt, tab, step },
    tx: t.state,
    wallet: { connected: w.address !== null, chainOk: w.chainOk },
    env: { network: CONFIG.network, explorer: CONFIG.explorer, nowSec: Math.floor(Date.now() / 1000) },
    actions: {
      setSide,
      setAmt,
      setTab,
      sign,
      back: () => {
        t.reset();
        setStep("review");
      },
      connect: () => void w.connect().catch(() => undefined),
      switchChain: () => void w.switchChain(),
    },
    me,
  });
  const chartSlots = {
    ...slots,
    interval: () => <IntervalBar value={iv} onPick={setIv} />,
    chart: (sc: Scope) => (
      <ZoomCandleChart
        candles={levelCandles(levels.data?.levels ?? [], intervalSpec(iv).sec)}
        interval={iv}
        resetKey={index}
        chgDp={2}
        title={String(lookup("chartTitle", sc) ?? "").replace(/· 1D$/, `· ${iv}`)}
        aria={String(lookup("chartAria", sc) ?? "").replace(/^Daily/, iv === "1D" ? "Daily" : iv)}
        source={(lookup("chartSource", sc) as string | null) ?? null}
        emptyText="No price history yet"
      />
    ),
  };
  return (
    <Shell title={title}>
      <ReviewScreen v={v} nav={nav} slots={chartSlots} />
    </Shell>
  );
}
