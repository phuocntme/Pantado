"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { parseUnits, type Address } from "viem";
import { tx as txb } from "@pantado/sdk";
import { apiPost, ApiRequestError, useApi } from "../lib/api";
import { useChrome } from "../lib/chrome";
import { CONFIG } from "../lib/config";
import { DEFAULT_INTERVAL, IntervalBar, intervalSpec, PAGE, type IntervalLabel } from "../lib/intervals";
import { useCandleHistory } from "../lib/candles";
import { nav } from "../lib/nav";
import { Shell } from "../lib/shell";
import { css, lookup, type Scope } from "../lib/tpl";
import { useTx, useWallet } from "../lib/wallet";
import type { AssetDetail, BoardRowView, CandlesView, IndexView, PoolView, SwapQuote, TradeView } from "./asset.api";
import type { ChartModel } from "./asset.chart";
import { BigValue, CandleChart, Notices, PerfGrid, TxStatusLine, ZoomCandleChart } from "./asset.parts";
import type { Notice, Perf, TxLine } from "./asset.states";
import { assetVM, type PoolRow, type QuoteState, type Side, type Tab } from "./asset.vm";
import { AssetScreen, title } from "./gen/Asset.gen";

/** Debounced quote: re-runs `fetcher` when `key` changes (null key clears). */
export function useQuote<Q>(key: string | null, fetcher: () => Promise<Q>, delayMs = 200): QuoteState<Q> & { loading: boolean } {
  const [st, setSt] = useState<QuoteState<Q> & { loading: boolean }>({ data: null, error: null, loading: false });
  useEffect(() => {
    if (key === null) {
      setSt({ data: null, error: null, loading: false });
      return;
    }
    let live = true;
    // a quote belongs to its inputs: drop the old one at once (the screen shows an estimate; nothing signs on it)
    setSt({ data: null, error: null, loading: true });
    const t = setTimeout(() => {
      fetcher()
        .then((data) => live && setSt({ data, error: null, loading: false }))
        .catch((e: unknown) => {
          if (!live) return;
          const err = e instanceof ApiRequestError ? { code: e.code, message: e.message } : { code: "Network", message: "Cannot reach the Pantado API." };
          setSt({ data: null, error: err, loading: false });
        });
    }, delayMs);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return st;
}

const th = (label: string, left: boolean, pad = "10px 12px") => (
  <th scope="col" style={css(`padding: ${pad}; font-weight: 500${left ? "; text-align: left" : ""}`)}>
    {label}
  </th>
);

function PoolsTable({ rows }: { rows: PoolRow[] }) {
  return (
    <div style={css("overflow-x: auto")}>
      <table style={css("width: 100%; min-width: 620px; border-collapse: collapse; font-size: 13px")}>
        <thead>
          <tr style={css("text-align: right; color: #8E8E96; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase")}>
            {th("Pool", true, "10px 20px")}
            {th("Pair", true)}
            {th("Price", false)}
            {th("Liquidity", false)}
            {th("Volume 24h", false)}
            {th("Role", false, "10px 20px")}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={css("border-top: 1px solid #17171A; text-align: right")}>
              <td style={css("padding: 13px 20px; text-align: left")}>
                <span style={css("display: flex; flex-direction: column; gap: 2px")}>
                  <span style={css("font-weight: 600; font-size: 14px")}>{r.name}</span>
                  <span style={css("font-size: 12px; color: #8E8E96")}>{r.sub}</span>
                </span>
              </td>
              <td style={css("padding: 13px 12px; text-align: left; color: #B4B4BB")}>{r.pair}</td>
              <td style={css("padding: 13px 12px")}>{r.price}</td>
              <td style={css("padding: 13px 12px; color: #B4B4BB")}>{r.liq}</td>
              <td style={css("padding: 13px 12px; color: #B4B4BB")}>{r.vol}</td>
              <td style={css("padding: 13px 20px")}>
                {r.role === "route" ? (
                  <span style={css("display: inline-flex; align-items: center; gap: 8px")}>
                    <span style={css("display: block; width: 60px; height: 4px; background: #1F1F23; border-radius: 2px")}>
                      <span style={css("display: block; width: 100%; height: 4px; background: #9052F9; border-radius: 2px")}></span>
                    </span>
                    {"Your route 100%"}
                  </span>
                ) : (
                  <span style={css("color: #8E8E96")}>{r.role === "source" ? "Price source" : "Cross-check"}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InIndexes({ title: t, rows }: { title: string; rows: { name: string; w: string; href: string }[] }) {
  return (
    <div style={css("background: #0B0B0D; border: 1px solid #1C1C20; border-radius: 16px; padding: 14px 16px 6px; display: flex; flex-direction: column")}>
      <span style={css("padding-bottom: 10px; font-size: 13px; font-weight: 600")}>{t}</span>
      {rows.map((r) => (
        <a
          key={r.href}
          href={r.href}
          style={css("display: flex; justify-content: space-between; align-items: center; gap: 12px; min-height: 44px; padding: 0 2px; border-top: 1px solid #17171A; font-size: 14px")}
        >
          <span style={css("font-weight: 500")}>{r.name}</span>
          <span style={css("color: #B4B4BB")}>{r.w}</span>
        </a>
      ))}
    </div>
  );
}

/** Slot renderers shared with the Review screen (same reference markup). */
export const assetSlots: Record<string, (s: Scope) => ReactNode> = {
  chart: (s) => (
    <CandleChart
      m={lookup("chart", s) as ChartModel}
      title={String(lookup("chartTitle", s) ?? "")}
      aria={String(lookup("chartAria", s) ?? "")}
      source={(lookup("chartSource", s) as string | null) ?? null}
      emptyText="No price history yet"
    />
  ),
  pools: (s) => (lookup("tabPools", s) ? <PoolsTable rows={(lookup("poolRows", s) as PoolRow[]) ?? []} /> : null),
  chg24: (s) => {
    const p = lookup("chg24", s) as Perf | undefined;
    return <BigValue value={p?.value ?? "—"} col={p?.col ?? "#8E8E96"} />;
  },
  perf: (s) => <PerfGrid items={(lookup("perf", s) as Perf[]) ?? []} />,
  notices: (s) => <Notices list={(lookup("notices", s) as Notice[]) ?? []} />,
  status: (s) => {
    const l = lookup("status", s) as TxLine | null;
    return l ? <TxStatusLine s={l} /> : null;
  },
  inIndexes: (s) => {
    const x = lookup("inIndexes", s) as { title: string; rows: { name: string; w: string; href: string }[] };
    return <InIndexes title={x.title} rows={x.rows} />;
  },
};

export default function Asset({ id }: { id: string }) {
  const [side, setSideRaw] = useState<Side>("Buy");
  const [amt, setAmt] = useState("500");
  const [tab, setTab] = useState<Tab>("Pools");
  const [iv, setIv] = useState<IntervalLabel>(DEFAULT_INTERVAL);
  const w = useWallet();
  const t = useTx();
  const { me } = useChrome();
  const enc = encodeURIComponent(id);
  const asset = useApi<AssetDetail>(`/assets/${enc}`, 15_000);
  // daily candles feed the 90D figure; the chart reads the picked interval and pages back through its history
  const candles = useApi<CandlesView>(`/assets/${enc}/candles?interval=1d&limit=120`, 60_000);
  const spec = intervalSpec(iv);
  const chartHist = useCandleHistory(`/assets/${enc}/candles?interval=${spec.api}&limit=${spec.fetch}`, PAGE, 60_000);
  const chartData = chartHist.data;
  const pools = useApi<PoolView[]>(`/assets/${enc}/pools`);
  const trades = useApi<TradeView[]>(`/assets/${enc}/trades`, 15_000);
  const kind = asset.data?.kind;
  const board = useApi<BoardRowView[]>(kind === "stock" || kind === "token" ? `/board?kind=${kind}s` : null, 30_000);
  const indexes = useApi<IndexView[]>("/indexes", 60_000);
  const dep = CONFIG.deployment;
  const a = asset.data;
  const usdc = dep?.contracts.usdc ?? null;
  const token = (a ? ((dep?.assets[a.id] as Address | undefined) ?? (a.execution.address as Address | null)) : null) ?? null;
  const decimals = a?.decimals ?? 18;
  const amountIn = useMemo(() => {
    try {
      return parseUnits(amt || "0", side === "Buy" ? 6 : decimals);
    } catch {
      return 0n;
    }
  }, [amt, side, decimals]);
  const tokenIn = side === "Buy" ? usdc : token;
  const tokenOut = side === "Buy" ? token : usdc;
  const qKey = tokenIn && tokenOut && amountIn > 0n ? `${tokenIn}:${tokenOut}:${amountIn}` : null;
  const quote = useQuote<SwapQuote>(qKey, () => apiPost<SwapQuote>("/quote/swap", { tokenIn, tokenOut, amountIn: amountIn.toString() }));

  const setSide = (s: Side): void => {
    setSideRaw(s);
    setAmt(s === "Buy" ? "500" : "3");
    t.reset();
  };
  const submit = (): void => {
    const router = dep?.contracts.swapRouter;
    if (!router || !tokenIn || !tokenOut || !w.address || !quote.data) return;
    void t
      .run([txb.approve(tokenIn, router, amountIn), txb.swap(router, tokenIn, tokenOut, amountIn, BigInt(quote.data.minOut), w.address)])
      .then((h) => {
        if (h) {
          trades.reload();
          asset.reload();
        }
      });
  };

  const v = assetVM({
    asset: a,
    candles: candles.data,
    pools: pools.data ?? [],
    trades: trades.data ?? [],
    board: board.data?.find((r) => r.id === a?.id) ?? null,
    indexes: indexes.data ?? [],
    quote: asset.error ? { data: null, error: { code: asset.error.code, message: asset.error.message } } : quote,
    ui: { side, amt, tab },
    tx: t.state,
    wallet: { connected: w.address !== null, chainOk: w.chainOk },
    env: { network: CONFIG.network, explorer: CONFIG.explorer, nowSec: Math.floor(Date.now() / 1000), deployed: !!dep, swapFeeBps: CONFIG.swapFeeBps },
    actions: {
      setSide,
      setAmt: (x) => {
        setAmt(x);
        if (t.state.status !== "pending") t.reset();
      },
      setTab,
      submit,
      connect: () => void w.connect().catch(() => undefined),
      switchChain: () => void w.switchChain(),
    },
    me,
  });
  const slots = {
    ...assetSlots,
    interval: () => <IntervalBar value={iv} onPick={setIv} />,
    chart: (sc: Scope) => (
      <ZoomCandleChart
        candles={chartData?.candles ?? []}
        interval={iv}
        resetKey={id}
        title={String(lookup("chartTitle", sc) ?? "").replace(/· 1D$/, `· ${iv}`)}
        aria={String(lookup("chartAria", sc) ?? "").replace(/^Daily/, iv === "1D" ? "Daily" : iv)}
        source={chartData?.source ?? null}
        emptyText={chartData ? "No price history yet" : "Loading…"}
        onNeedOlder={chartHist.exhausted ? undefined : chartHist.loadOlder}
      />
    ),
  };
  return (
    <Shell title={a ? `${a.displaySymbol} · ${title}` : title}>
      <AssetScreen v={v} nav={nav} slots={slots} />
    </Shell>
  );
}
