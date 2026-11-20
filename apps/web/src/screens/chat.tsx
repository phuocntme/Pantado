"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApi } from "../lib/api";
import { useChrome } from "../lib/chrome";
import { CONFIG } from "../lib/config";
import { nav } from "../lib/nav";
import { Shell } from "../lib/shell";
import { css, type Scope } from "../lib/tpl";
import { useWallet } from "../lib/wallet";
import { ChatScreen, title as pageTitle } from "./gen/Chat.gen";
import type { Candle } from "./chat.charts";
import { Empty } from "./chat.history";
import { Conversation, ConvRow, type ConvRowData } from "./chat.parts";
import { AgentError, askStream, type AskEvent } from "./chat.sse";
import { anonSession, historyOf, newId, ownerOf, saveConvs, titleOf, type Conversation as Conv, type KV, type Turn } from "./chat.store";
import { chatVM, latestCard, type AssetCardData, type AssetLite, type BoardLite, type IndexCardData } from "./chat.vm";

const storage = (): KV | null => {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
};

type Mode = "auto" | "deep";

/** Apply one stream event to a turn. */
function applyEvent(t: Turn, e: AskEvent): Turn {
  switch (e.type) {
    case "token":
      return { ...t, text: t.text + e.text };
    case "card":
      return { ...t, cards: [...t.cards, e.card] };
    case "meta":
      return { ...t, meta: { tools: e.tools, ms: e.ms } };
    case "related":
      return { ...t, related: e.questions };
    case "done":
      return { ...t, status: "done" };
    default:
      return t;
  }
}

export default function Chat() {
  const router = useRouter();
  const params = useSearchParams();
  const w = useWallet();
  const { me } = useChrome();
  const [owner, setOwner] = useState<string | null>(null);
  // who the agent talks to: the wallet, else this browser's anonymous session (asking needs no wallet; only saving does)
  const [session, setSession] = useState<string | null>(null);
  const [convs, setConvs] = useState<Conv[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const abort = useRef<AbortController | null>(null);
  const handled = useRef<string | null>(null);

  // persist this screen's own changes: at once when nothing streams, at most once a second while an answer
  // streams, and once more when the screen is left — a conversation started and left mid-answer is kept (its
  // partial answer stored as interrupted by saveConvs). A list only read from storage is never written back, so
  // chats saved elsewhere (another tab, the Ask home's delete) are not overwritten.
  const latest = useRef<{ convs: Conv[]; owner: string | null }>({ convs, owner });
  latest.current = { convs, owner };
  const loaded = useRef<Conv[] | null>(null);
  const dirty = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const kv = storage();
    const { convs: cs, owner: o } = latest.current;
    if (!dirty.current || !kv || !o) return;
    saveConvs(kv, o, cs);
    dirty.current = false;
  }, []);

  // history owner: one history per wallet, each wallet sees only its own chats. Without a wallet a chat lives on this
  // screen only (not saved, not listed, not moved to a wallet later). Pending changes go to the previous owner first.
  useEffect(() => {
    const kv = storage();
    if (!kv) return;
    flush();
    const now = Date.now();
    const cs = historyOf(kv, w.address, now);
    loaded.current = cs;
    setConvs(cs);
    setOwner(ownerOf(w.address));
    setSession(ownerOf(w.address) ?? `anon:${anonSession(kv, now)}`);
  }, [w.address, flush]);

  useEffect(() => {
    if (!owner || convs === loaded.current) return;
    dirty.current = true;
    if (!convs.some((c) => c.turns.some((t) => t.status === "streaming"))) return flush();
    saveTimer.current ??= setTimeout(flush, 1000);
  }, [convs, owner, flush]);
  useEffect(() => {
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [flush]);

  useEffect(() => () => abort.current?.abort(), []);
  // desktop: the page fits the window and only the conversation scrolls (globals.css body.chatpage)
  useEffect(() => {
    document.body.classList.add("chatpage");
    return () => document.body.classList.remove("chatpage");
  }, []);

  const updateTurn = useCallback((id: string, f: (t: Turn) => Turn) => {
    setConvs((xs) =>
      xs.map((c) => {
        if (c.id !== id || !c.turns.length) return c;
        const turns = [...c.turns];
        turns[turns.length - 1] = f(turns[turns.length - 1] as Turn);
        return { ...c, turns, updated: Date.now() };
      }),
    );
  }, []);

  const send = useCallback(
    (text: string, mode: Mode, convId: string | null) => {
      if (!session) return;
      const id = convId ?? newId();
      const now = Date.now();
      const turn: Turn = { q: text, mode, text: "", cards: [], meta: null, status: "streaming" };
      setConvs((xs) => {
        const hit = xs.find((c) => c.id === id);
        if (hit) return [{ ...hit, turns: [...hit.turns, turn], updated: now }, ...xs.filter((c) => c.id !== id)];
        return [{ id, title: titleOf(text), created: now, updated: now, turns: [turn] }, ...xs];
      });
      setCurrentId(id);
      abort.current?.abort();
      const ctrl = new AbortController();
      abort.current = ctrl;
      askStream(CONFIG.agentUrl, { message: text, mode, sessionId: `${session}:${id}` }, (e) => updateTurn(id, (t) => applyEvent(t, e)), ctrl.signal)
        .then(() => updateTurn(id, (t) => (t.status === "streaming" ? { ...t, status: "done" } : t)))
        .catch((e: unknown) => {
          const message = e instanceof AgentError ? e.message : "The agent could not answer.";
          updateTurn(id, (t) => ({ ...t, status: "error", error: message }));
        });
      return id;
    },
    [session, updateTurn],
  );

  // `/ask?q=…&mode=…` starts a conversation once; `/ask?c=<id>` opens one from the history
  const qs = params.toString();
  useEffect(() => {
    if (!session || handled.current === qs) return;
    handled.current = qs;
    const q = params.get("q")?.trim();
    const c = params.get("c");
    if (q) {
      const id = send(q, params.get("mode") === "deep" ? "deep" : "auto", null);
      if (id) router.replace(`/ask?c=${id}`);
      handled.current = `c=${id}`;
    } else if (c) setCurrentId(c);
  }, [session, qs, params, send, router]);

  const cur = convs.find((c) => c.id === currentId) ?? null;
  // a follow-up runs in the mode picked under the conversation (default: the last answer's)
  const ask = useCallback(
    (text: string, mode?: Mode) => {
      const last = cur?.turns[cur.turns.length - 1];
      send(text, mode ?? last?.mode ?? "auto", cur?.id ?? null);
    },
    [cur, send],
  );
  const pickConv = useCallback(
    (id: string) => {
      handled.current = `c=${id}`;
      setCurrentId(id);
      router.push(`/ask?c=${id}`);
    },
    [router],
  );
  // remove a conversation from the history; deleting the open one stops its answer and leaves an empty Ask
  const deleteConv = useCallback(
    (id: string) => {
      setConvs((xs) => xs.filter((c) => c.id !== id));
      if (id === currentId) {
        abort.current?.abort();
        abort.current = null;
        setCurrentId(null);
        handled.current = "";
        router.replace("/ask");
      }
    },
    [currentId, router],
  );

  // live data behind the cards
  const assets = useApi<AssetLite[]>("/assets");
  const board = useApi<BoardLite[]>("/board?kind=indexes", 30_000);
  const assetCard = latestCard<AssetCardData>(cur, "asset");
  const indexCard = latestCard<IndexCardData>(cur, "index");
  const candles = useApi<{ candles: Candle[] }>(assetCard ? `/assets/${assetCard.id}/candles?interval=1d&limit=60` : null);
  const ixId = indexCard?.detail.id ?? null;
  const levels = useApi<{ levels: { ts: string; level: string }[] }>(ixId ? `/indexes/${ixId}/levels?limit=1000` : null);
  const holders = useApi<unknown[]>(ixId ? `/indexes/${ixId}/holders` : null);
  const levelPts = useMemo(() => {
    if (!levels.data) return null;
    const since = Date.now() / 1000 - 90 * 86400;
    return levels.data.levels.map((l) => ({ ts: Number(l.ts), level: Number(l.level) / 1e18 })).filter((p) => p.ts >= since);
  }, [levels.data]);

  const v = useMemo(
    () =>
      chatVM({
        convs,
        listed: owner !== null,
        currentId,
        search,
        pickConv,
        deleteConv,
        ask,
        assets: assets.data ?? [],
        board: board.data ?? [],
        candles: assetCard ? (candles.data?.candles ?? null) : null,
        levels: levelPts,
        holders: ixId && holders.data ? holders.data.length : null,
        me,
      }),
    [convs, owner, currentId, search, pickConv, deleteConv, ask, assets.data, board.data, assetCard, candles.data, levelPts, ixId, holders.data, me],
  );

  const assetSym = useCallback(
    (id: string): string => {
      const a = (assets.data ?? []).find((x) => x.id === id.toLowerCase());
      return a ? (a.displaySymbol ?? a.symbol) : id.toUpperCase();
    },
    [assets.data],
  );

  const slots = {
    chatSearch: () => (
      <input
        id="chat-search"
        type="text"
        placeholder="Search chats"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={css("flex: 1 1 auto; min-width: 0; height: 44px; background: transparent; border: 0; color: #F2F2F3; font-family: inherit; font-size: 15px")}
      />
    ),
    // keyed by conversation: a row's armed delete never carries over to the row that moves into its place
    convRow: (s: Scope) => {
      const cv = s.cv as ConvRowData;
      return <ConvRow key={cv.id} cv={cv} />;
    },
    listHead: () =>
      owner === null ? (
        <Empty text="Connect to see your chats" />
      ) : convs.length === 0 ? (
        <Empty text="No chats yet" />
      ) : (
        <span style={css("padding: 6px 12px; font-size: 12px; color: #8E8E96")}>{"Today"}</span>
      ),
    conversation: (s: Scope) => <Conversation v={s} onAsk={ask} assetSym={assetSym} />,
    // the reference's side columns stay empty: the cards are drawn inside the answer
    assetCard: () => null,
    draftCard: () => null,
    indexCard: () => null,
  };

  return (
    <Shell title={cur?.title ?? pageTitle}>
      <ChatScreen v={v} nav={nav} slots={slots} />
    </Shell>
  );
}
