"use client";
/**
 * Index page container (app/index/[id]): loads `/indexes/:id` and its tabs, quotes Buy/Sell through the API,
 * sends Buy/Sell (and Make public on a private index) with the user's wallet. Renders the private screen to
 * the creator of a private index, the public screen to everyone else. Redeem lives in Portfolio only.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { erc20Abi, isAddress, type Address } from "viem";
import { tx } from "@pantado/sdk";
import { apiPost, ApiRequestError, useApi } from "../lib/api";
import { useChrome } from "../lib/chrome";
import { CONFIG } from "../lib/config";
import { DEFAULT_INTERVAL, IntervalBar, type IntervalLabel } from "../lib/intervals";
import { nav } from "../lib/nav";
import { Shell } from "../lib/shell";
import { useTx, useWallet } from "../lib/wallet";
import { IndexScreen, title as indexTitle } from "./gen/Index.gen";
import { PrivateScreen } from "./gen/Private.gen";
import { fixed, fromBase, toBase, UNIT_DECIMALS, USDC_DECIMALS } from "./index.data";
import type { AssetInfo, BoardAsset, Composition, Holder, IndexDetail, IndexEvent, Levels, Quote, Rebalances } from "./index.data";
import { AskAgent, AssessTags, Changes, PlanStatus, Split, StatsTop, TradeCta, VersionBanner, ZoomLevelChart, IndexAbout } from "./index.parts";
import { askHref } from "./ask.vm";
import { askAboutIndex, DEFAULT_AMT, indexVM, type Assessment, type IndexVM, type Side, type Tab } from "./index.vm";
import { privateVM, showPrivate, type PubState } from "./private.vm";

const QUOTE_DEBOUNCE_MS = 350;

/** Agent assessment (services/agent GET /assessment/:index). Optional: "—" until the agent serves it. */
function useAssessment(id: string): Assessment | null {
  const [a, setA] = useState<Assessment | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`${CONFIG.agentUrl}/assessment/${id}`, { cache: "no-store" })
      .then(async (r) => (r.ok ? ((await r.json()) as { text?: unknown; summary?: unknown; tags?: unknown }) : null))
      .then((j) => {
        if (!live || !j) return;
        const text = typeof j.text === "string" ? j.text : typeof j.summary === "string" ? j.summary : null;
        const tags = Array.isArray(j.tags)
          ? j.tags
              .map((t: unknown) => (typeof t === "string" ? { label: t, good: true } : t && typeof t === "object" && typeof (t as { label?: unknown }).label === "string" ? { label: (t as { label: string }).label, good: (t as { good?: unknown }).good !== false } : null))
              .filter((t): t is { label: string; good: boolean } => t !== null)
          : [];
        if (text) setA({ text, tags });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [id]);
  return a;
}

export default function IndexPage({ id }: { id: string }) {
  const valid = isAddress(id);
  const base = valid ? `/indexes/${id}` : null;
  const detail = useApi<IndexDetail>(base, 15_000);
  const comp = useApi<Composition>(base && `${base}/composition`, 10_000);
  const txs = useApi<IndexEvent[]>(base && `${base}/transactions`, 15_000);
  const reb = useApi<Rebalances>(base && `${base}/rebalances`, 30_000);
  const holders = useApi<Holder[]>(base && `${base}/holders`, 30_000);
  const levels = useApi<Levels>(base && `${base}/levels?limit=1000`, 30_000);
  const assets = useApi<AssetInfo[]>("/assets");
  const board = useApi<BoardAsset[]>("/board", 60_000);
  const assess = useAssessment(id);
  const { me } = useChrome();
  const w = useWallet();
  const trade = useTx();
  const pubTx = useTx();

  const [tab, setTab] = useState<Tab>("Composition");
  const [iv, setIv] = useState<IntervalLabel>(DEFAULT_INTERVAL);
  const [side, setSideRaw] = useState<Side>("Buy");
  const [amt, setAmt] = useState<string>(DEFAULT_AMT.Buy);
  const [now, setNow] = useState<number>(() => Math.floor(Date.now() / 1000));
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<{ code: string; message: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [txText, setTxText] = useState({ pending: "", confirmed: "" });
  const [madePublic, setMadePublic] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(t);
  }, []);

  const setSide = useCallback((s: Side) => {
    setSideRaw(s);
    setAmt(DEFAULT_AMT[s]);
  }, []);

  const amountBase = useMemo(() => toBase(amt, side === "Buy" ? USDC_DECIMALS : UNIT_DECIMALS), [amt, side]);

  const fetchQuote = useCallback(async (): Promise<Quote | null> => {
    if (!valid || amountBase === null) return null;
    try {
      const q = await apiPost<Quote>("/quote/basket", { index: id, side: side === "Buy" ? "buy" : "sell", amount: amountBase.toString() });
      setQuote(q);
      setQuoteError(null);
      return q;
    } catch (e) {
      setQuote(null);
      setQuoteError(e instanceof ApiRequestError ? { code: e.code, message: e.message } : { code: "Network", message: "Cannot reach the Pantado API." });
      return null;
    }
  }, [valid, amountBase, id, side]);

  const seq = useRef(0);
  useEffect(() => {
    const n = ++seq.current;
    setQuote(null);
    setQuoteError(null);
    if (amountBase === null) return;
    const t = setTimeout(() => {
      if (n === seq.current) void fetchQuote();
    }, QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [fetchQuote, amountBase]);

  const contracts = CONFIG.deployment?.contracts ?? null;
  const reloadAll = useCallback(() => {
    detail.reload();
    comp.reload();
    txs.reload();
    holders.reload();
    levels.reload();
  }, [detail, comp, txs, holders, levels]);

  const submit = useCallback(async () => {
    if (submitting || !w.address || amountBase === null || !valid) return;
    if (!contracts) {
      setQuoteError({ code: "NotDeployed", message: "Pantado contracts are not deployed on this network yet." });
      return;
    }
    setSubmitting(true);
    try {
      const q = await fetchQuote(); // fresh quote right before signing (spec §9.5)
      if (!q) return;
      const index = id as Address;
      const ticker = detail.data?.ticker ?? "";
      if (q.side === "buy") {
        const allowance = await w.pub.readContract({ address: contracts.usdc, abi: erc20Abi, functionName: "allowance", args: [w.address, index] });
        const needsApprove = allowance < amountBase;
        const units = fixed(fromBase(q.units, UNIT_DECIMALS));
        setTxText({
          pending: needsApprove ? `Approve USDC, then buy ${units} ${ticker}` : `One signature buys ${units} ${ticker}`,
          confirmed: `You bought ${units} ${ticker}`,
        });
        const reqs = needsApprove ? [tx.approve(contracts.usdc, index, amountBase), tx.buy(index, amountBase, BigInt(q.minUnits), w.address)] : [tx.buy(index, amountBase, BigInt(q.minUnits), w.address)];
        if (await trade.run(reqs)) reloadAll();
      } else {
        const out = fixed(fromBase(q.usdcOut, USDC_DECIMALS));
        setTxText({ pending: `One signature sells ${amt} ${ticker}`, confirmed: `You sold ${amt} ${ticker} for $${out}` });
        if (await trade.run([tx.sell(index, amountBase, BigInt(q.minOut), w.address)])) reloadAll();
      }
    } finally {
      setSubmitting(false);
    }
  }, [submitting, w, amountBase, valid, contracts, fetchQuote, id, detail.data, trade, reloadAll, amt]);

  const makePublic = useCallback(() => {
    if (!contracts || !valid) return;
    void pubTx.run([tx.makePublic(contracts.factory, id as Address)]).then((h) => {
      if (h) {
        setMadePublic(true);
        detail.reload();
      }
    });
  }, [contracts, valid, pubTx, id, detail]);

  const input = {
    detail: detail.data,
    comp: comp.data,
    txs: txs.data,
    reb: reb.data,
    holders: holders.data,
    levels: levels.data,
    assets: assets.data,
    board: board.data,
    quote,
    quoteError,
    assess,
    now,
    me,
  };
  const state = { tab, side, amt };
  const handlers = { setTab, setSide, setAmt };
  const isPrivate = showPrivate(detail.data, me.address);
  const pub: PubState = madePublic || detail.data?.isPublic ? "public" : pubTx.state.status === "pending" ? "pending" : "private";
  const v = isPrivate ? privateVM(input, state, handlers, pub, makePublic) : indexVM(input, state, handlers);

  const loadError = !valid ? "This is not an index address." : detail.error ? detail.error.message : null;
  const slots = {
    levelChart: () => <ZoomLevelChart name={v.name} levels={levels.data?.levels ?? []} txs={txs.data ?? []} interval={iv} resetKey={id} />,
    interval: () => <IntervalBar value={iv} onPick={setIv} />,
    versionBanner: () => (
      <>
        <IndexAbout text={detail.data?.description ?? ""} />
        <VersionBanner banner={v.banner} onOpen={() => setTab("Rebalances")} />
      </>
    ),
    planStatus: () => <PlanStatus plan={v.plan} />,
    statsTop: () => <StatsTop stats={v.stats} />,
    changes: () => <Changes changes={v.changes} />,
    split: () => <Split split={v.split} />,
    assessTags: () => <AssessTags tags={v.assess.tags} />,
    agentActions: () => (
      <AskAgent href={detail.data ? askHref(askAboutIndex(detail.data.name, detail.data.ticker, id), "Auto") : "/ask"} />
    ),
    cta: () => (
      <TradeCta
        vm={v as IndexVM}
        side={side}
        connected={!!w.address}
        chainOk={w.chainOk}
        tx={trade.state}
        submitting={submitting}
        onSubmit={() => void submit()}
        onSwitch={() => void w.switchChain()}
        onRedeemHref={valid ? `/redeem/${id}` : "/portfolio"}
        loadError={loadError}
        pending={txText.pending}
        confirmed={txText.confirmed}
      />
    ),
  };

  return (
    <Shell title={detail.data?.name ?? indexTitle}>
      {isPrivate ? <PrivateScreen v={v} nav={nav} slots={slots} /> : <IndexScreen v={v} nav={nav} slots={slots} />}
    </Shell>
  );
}
