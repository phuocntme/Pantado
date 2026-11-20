"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { parseEventLogs, type Address } from "viem";
import { indexFactoryAbi, indexVaultAbi, RebalanceMode, tx as txb } from "@pantado/sdk";
import { apiGet, apiPost, ApiRequestError, useApi } from "../lib/api";
import { useChrome } from "../lib/chrome";
import { CONFIG } from "../lib/config";
import { nav } from "../lib/nav";
import { Shell } from "../lib/shell";
import { css, lookup, type Scope } from "../lib/tpl";
import { useTx, useWallet } from "../lib/wallet";
import { useQuote } from "./asset";
import type { AssetView, CandlesView, CreateQuote, IndexView, PresetView } from "./asset.api";
import { Notices, TxStatusLine } from "./asset.parts";
import type { Notice, TxLine } from "./asset.states";
import { forkPrefill, parseDraft, type PresetKey, type Prefill } from "./create.draft";
import { backtest, slippage1k, type DailyClose } from "./create.metrics";
import { createVM, MAX_ASSETS, validate, type CreateState } from "./create.vm";
import { CreateScreen, title } from "./gen/Create.gen";

const INITIAL: CreateState = {
  picked: [],
  w: {},
  f: "All",
  search: "",
  name: "My basket",
  ticker: "",
  description: "",
  vis: "Private",
  mode: "Auto",
  drift: 50,
  first: "100",
  step: "edit",
};

/** Created banner (reference markup) with the live notices and tx line above it. */
const slots = {
  status: (s: Scope) => {
    const l = lookup("status", s) as TxLine | null;
    const done = lookup("isDone", s) === true;
    return (
      <div data-create-status="" style={css("display: flex; flex-direction: column; gap: 8px")}>
        <Notices list={(lookup("notices", s) as Notice[]) ?? []} />
        {l ? <TxStatusLine s={l} /> : null}
        {done ? (
          <div role="status" style={css("display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; padding: 12px 16px; background: #11261B; border: 1px solid #1D4A33; border-radius: 14px; font-size: 14px")}>
            <span style={css("display: flex; flex-direction: column; gap: 2px")}>
              <span style={css("color: #3DD68C; font-weight: 600")}>{String(lookup("createdText", s) ?? "")}</span>
              <span style={css("font-size: 13px; color: #B4B4BB")}>{String(lookup("createdSub", s) ?? "")}</span>
            </span>
            <span style={css("margin-left: auto; display: flex; gap: 8px")}>
              <a style={css("display: flex; align-items: center; min-height: 40px; padding: 0 14px; background: #1A1A1D; border-radius: 10px; font-size: 13px; font-weight: 600")} href={nav("Portfolio", s)}>
                {"Your indexes"}
              </a>
              <a style={css("display: flex; align-items: center; min-height: 40px; padding: 0 14px; background: #F2F2F3; color: #0B0B0D; border-radius: 10px; font-size: 13px; font-weight: 700")} href={nav("IndexDetail", s)}>
                {"Open index"}
              </a>
            </span>
          </div>
        ) : null}
      </div>
    );
  },
};

const addrOf = (a: AssetView): Address | null => (CONFIG.deployment?.assets[a.id] as Address | undefined) ?? (a.execution.address as Address | null);

export default function Create({ draft, fork }: { draft?: string; fork?: string }) {
  const [s, setS] = useState<CreateState>(INITIAL);
  // the review opens under the "Review" button at the bottom (globals.css): bring it into view
  useEffect(() => {
    if (s.step !== "review" && s.step !== "done") return;
    const id = window.setTimeout(() => {
      document.querySelector(s.step === "review" ? "main > [aria-labelledby='cr-title']" : "main > [data-create-status]")?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, 60);
    return () => window.clearTimeout(id);
  }, [s.step]);
  const set = useCallback((p: Partial<CreateState>) => setS((x) => ({ ...x, ...p })), []);
  const [formKey, setFormKey] = useState(0);
  const [presetError, setPresetError] = useState<string | null>(null);
  const [tickerTaken, setTickerTaken] = useState<boolean | null>(null);
  const [creationFee, setCreationFee] = useState<bigint | null>(null);
  const [closes, setCloses] = useState<Record<string, DailyClose[]>>({});
  const [created, setCreated] = useState<{ index: string | null; units: string | null } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const w = useWallet();
  const t = useTx();
  const { me } = useChrome();
  const assets = useApi<AssetView[]>("/assets", 30_000);
  const forkIx = useApi<IndexView>(fork ? `/indexes/${encodeURIComponent(fork)}` : null);
  const byId = useMemo(() => new Map((assets.data ?? []).filter((a) => a.kind !== "quote").map((a) => [a.id, a])), [assets.data]);
  const factory = CONFIG.deployment?.contracts.factory ?? null;

  // ---- pre-fill (agent draft or fork), once the registry is loaded
  const prefilled = useRef(false);
  const apply = useCallback(
    (p: Prefill) => {
      prefilled.current = true;
      setS((x) => ({
        ...x,
        picked: p.picked,
        w: p.w,
        name: p.name ?? x.name,
        ticker: p.ticker ?? x.ticker,
        description: p.description ?? x.description,
        mode: p.mode ?? x.mode,
      }));
      setFormKey((k) => k + 1);
    },
    [],
  );
  useEffect(() => {
    if (prefilled.current || byId.size === 0) return;
    if (draft) {
      const p = parseDraft(draft, new Set(byId.keys()));
      if (p) apply(p);
      else prefilled.current = true;
    } else if (fork && forkIx.data) {
      const idByAddr = new Map<string, string>();
      for (const a of byId.values()) {
        const x = addrOf(a);
        if (x) idByAddr.set(x.toLowerCase(), a.id);
      }
      apply(forkPrefill(forkIx.data.assets, forkIx.data.targetBps, idByAddr));
    }
  }, [draft, fork, forkIx.data, byId, apply]);

  // ---- uncontrolled reference inputs (name, description, asset search): read through a delegated listener
  useEffect(() => {
    const ta = wrap.current?.querySelector<HTMLTextAreaElement>('section[aria-label="Your index"] textarea');
    if (ta && ta.value !== s.description) ta.value = s.description;
    // only on (re)mount of the form
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formKey]);
  const onFormChange = (e: ChangeEvent<HTMLDivElement>): void => {
    const el = e.target as unknown as HTMLInputElement | HTMLTextAreaElement;
    if (el.id === "ix-name") set({ name: el.value.slice(0, 64) });
    else if (el.id === "asset-search") set({ search: el.value });
    else if (el.tagName === "TEXTAREA") set({ description: el.value.slice(0, 280) });
  };

  // ---- ticker uniqueness (factory read) and creation fee (factory limits)
  useEffect(() => {
    if (!factory || !/^[A-Z0-9]{2,6}$/.test(s.ticker)) {
      setTickerTaken(null);
      return;
    }
    let live = true;
    const h = setTimeout(() => {
      w.pub
        .readContract({ address: factory, abi: indexFactoryAbi, functionName: "isTickerTaken", args: [s.ticker] })
        .then((x) => live && setTickerTaken(Boolean(x)))
        .catch(() => live && setTickerTaken(null));
    }, 400);
    return () => {
      live = false;
      clearTimeout(h);
    };
  }, [s.ticker, factory, w.pub]);
  useEffect(() => {
    if (!factory) return;
    w.pub
      .readContract({ address: factory, abi: indexFactoryAbi, functionName: "limits" })
      .then((l) => setCreationFee((l as readonly bigint[])[0] ?? null))
      .catch(() => setCreationFee(null));
  }, [factory, w.pub]);

  // ---- metrics: daily closes per picked asset → backtest; $1k create quote → slippage
  const pickedKey = s.picked.join(",");
  useEffect(() => {
    const missing = s.picked.filter((id) => !(id in closes));
    if (missing.length === 0) return;
    let live = true;
    void Promise.all(
      missing.map((id) =>
        apiGet<CandlesView>(`/assets/${encodeURIComponent(id)}/candles?interval=1d&limit=120`)
          .then((c) => [id, c.candles.map((k) => ({ t: k.t, c: k.c }))] as const)
          .catch(() => [id, [] as DailyClose[]] as const),
      ),
    ).then((rows) => live && setCloses((x) => ({ ...x, ...Object.fromEntries(rows) })));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedKey]);
  const bt = useMemo(
    () => (s.picked.every((id) => id in closes) ? backtest(s.picked.map((id) => closes[id] ?? []), s.picked.map((id) => s.w[id] ?? 0)) : null),
    [s.picked, s.w, closes],
  );

  const sel = s.picked.map((id) => byId.get(id)).filter((a): a is AssetView => !!a);
  const addrs = sel.map(addrOf);
  const weightsBps = s.picked.map((id) => (s.w[id] ?? 0) * 100);
  const basketOk = sel.length >= 2 && addrs.every((a) => a !== null) && weightsBps.reduce((x, y) => x + y, 0) === 10_000 && weightsBps.every((x) => x >= 100);
  const basketKey = basketOk ? `${addrs.join(",")}|${weightsBps.join(",")}` : null;
  const slipQ = useQuote<CreateQuote>(basketKey ? `1k|${basketKey}` : null, () =>
    apiPost<CreateQuote>("/quote/create", { assets: addrs, weightsBps, usdcIn: "1000000000" }),
  );
  const usdcIn = BigInt(Math.round((Number(s.first) || 0) * 1e6));
  const reviewQ = useQuote<CreateQuote>(s.step === "review" && basketKey ? `rv|${basketKey}|${usdcIn}` : null, () =>
    apiPost<CreateQuote>("/quote/create", { assets: addrs, weightsBps, usdcIn: usdcIn.toString() }),
  );

  // ---- actions
  const toggle = (id: string): void =>
    setS((x) => {
      if (x.picked.includes(id)) return { ...x, picked: x.picked.filter((p) => p !== id) };
      if (x.picked.length >= MAX_ASSETS) return x;
      return { ...x, picked: [...x.picked, id], w: { ...x.w, [id]: x.w[id] ?? 0 } };
    });
  const preset = (p: PresetKey): void => {
    if (s.picked.length < 2) return;
    setPresetError(null);
    apiGet<PresetView>(`/presets?assets=${s.picked.map(encodeURIComponent).join(",")}&preset=${p}`)
      .then((r) => {
        const ids = s.picked;
        setS((x) => ({ ...x, w: { ...x.w, ...Object.fromEntries(ids.map((id, k) => [id, r.weights[k] ?? 0])) } }));
      })
      .catch((e: unknown) => setPresetError(e instanceof ApiRequestError ? e.message : "Cannot reach the Pantado API."));
  };
  const confirm = (): void => {
    const dep = CONFIG.deployment;
    if (!dep || !w.address || !basketOk) return;
    const owner = w.address;
    // spec §9.5: refresh the quote right before signing (never sign on a missing or stale quote)
    void apiPost<CreateQuote>("/quote/create", { assets: addrs, weightsBps, usdcIn: usdcIn.toString() })
      .catch(() => reviewQ.data)
      .then((fresh) => {
        const q = fresh ?? reviewQ.data;
        if (!q) return;
        const total = BigInt(q.usdcIn) + BigInt(q.creationFee);
        return t
      .run([
        txb.approve(dep.contracts.usdc, dep.contracts.factory, total),
        txb.createAndBuy(dep.contracts.factory, {
          name: s.name.trim(),
          ticker: s.ticker,
          description: s.description.trim(),
          assets: addrs.filter((a): a is Address => a !== null),
          weightsBps,
          mode: RebalanceMode[s.mode],
          driftBps: Math.min(20_000, Math.max(1_000, s.drift * 100)),
          isPublic: s.vis === "Public",
          usdcIn: BigInt(q.usdcIn),
          minUnits: BigInt(q.minUnits),
        }),
      ])
      .then(async (hash) => {
        if (!hash) return;
        let index: string | null = null;
        let units: string | null = q.units;
        try {
          const rc = await w.pub.getTransactionReceipt({ hash });
          const ev = parseEventLogs({ abi: indexFactoryAbi, eventName: "IndexCreated", logs: rc.logs })[0];
          index = ev ? (ev.args as { index: Address }).index : null;
          if (index) units = String(await w.pub.readContract({ address: index as Address, abi: indexVaultAbi, functionName: "balanceOf", args: [owner] }));
        } catch {
          /* keep the quoted units */
        }
        setCreated({ index, units });
        set({ step: "done" });
      });
      });
  };

  const v = createVM({
    s,
    assets: assets.data ?? [],
    tickerTaken,
    creationFee,
    presetError: presetError ?? (assets.error ? assets.error.message : forkIx.error ? forkIx.error.message : null),
    backtest: bt,
    slip: slippage1k(slipQ.data),
    quote: reviewQ,
    tx: t.state,
    created,
    wallet: { connected: w.address !== null, chainOk: w.chainOk },
    env: { network: CONFIG.network, explorer: CONFIG.explorer, nowSec: Math.floor(Date.now() / 1000), deployed: !!CONFIG.deployment },
    actions: {
      set: (p) => {
        if (p.step === "edit") t.reset();
        set(p);
      },
      toggle,
      setW: (id, val) => setS((x) => ({ ...x, w: { ...x.w, [id]: Math.max(0, Math.min(100, Math.round(val))) } })),
      preset,
      review: () => {
        if (validate(s, tickerTaken)) return;
        t.reset();
        set({ step: "review" });
        try {
          window.scrollTo(0, 0);
        } catch {
          /* no window */
        }
      },
      confirm,
      connect: () => void w.connect().catch(() => undefined),
      switchChain: () => void w.switchChain(),
    },
    me,
  });
  return (
    <Shell title={title}>
      <div ref={wrap} style={css("display: contents")} onChange={onFormChange}>
        <CreateScreen key={formKey} v={v} nav={nav} slots={slots} />
      </div>
    </Shell>
  );
}
