"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useApi } from "../lib/api";
import { CONFIG } from "../lib/config";
import { useChrome } from "../lib/chrome";
import { nav } from "../lib/nav";
import { Shell } from "../lib/shell";
import { css } from "../lib/tpl";
import { AskScreen, title } from "./gen/Ask.gen";
import { askHref, askVM, type AskBoardRow, type AskMode, type AskTab, type DailySuggestions } from "./ask.vm";
import { useChatHistorySlots } from "./chat.history";

/** The agent's questions of the day; null while loading or when the agent is not running. */
export function useDailySuggestions(): DailySuggestions | null {
  const [d, setD] = useState<DailySuggestions | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`${CONFIG.agentUrl}/suggestions`, { signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<DailySuggestions>) : null))
      .then((x) => setD(x && typeof x === "object" && "tabs" in x ? x : null))
      .catch(() => undefined);
    return () => ctrl.abort();
  }, []);
  return d;
}

/** Live state shared by Ask home and the Connect dialog backdrop. */
export function useAskHome(draft: string) {
  const [tab, setTab] = useState<AskTab>("Today");
  const [mode, setMode] = useState<AskMode>("Auto");
  const board = useApi<AskBoardRow[]>("/board", 30_000);
  const { me } = useChrome();
  const daily = useDailySuggestions();
  const v = useMemo(
    () => askVM({ tab, mode, pickTab: setTab, pickMode: setMode, board: board.data ?? [], daily, draft, me }),
    [tab, mode, board.data, daily, draft, me],
  );
  return { v, mode };
}

export default function Ask() {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const { v, mode } = useAskHome(draft);
  const history = useChatHistorySlots();
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && !e.shiftKey && draft.trim()) {
      e.preventDefault();
      router.push(askHref(draft, mode));
    }
  };
  const slots = {
    ...history,
    askInput: () => (
      <textarea
        id="ask-input"
        rows={3}
        placeholder="Ask about a token, a stock, or an index idea"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        style={css("width: 100%; box-sizing: border-box; min-height: 96px; resize: none; background: transparent; border: 0; color: #F2F2F3; font-family: inherit; font-size: 16px; line-height: 1.5")}
      />
    ),
  };
  return (
    <Shell title={title}>
      <AskScreen v={v} nav={nav} slots={slots} />
    </Shell>
  );
}
