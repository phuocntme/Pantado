"use client";
import { useMemo, useState } from "react";
import { useApi } from "../lib/api";
import { BRAND_LOGOS } from "../lib/logos";
import { useChrome } from "../lib/chrome";
import { nav } from "../lib/nav";
import { Shell } from "../lib/shell";
import { ConnectScreen, title } from "./gen/Connect.gen";
import type { AskBoardRow, AskMode, AskTab } from "./ask.vm";
import { useDailySuggestions } from "./ask";
import { useChatHistorySlots } from "./chat.history";
import { connectVM } from "./connect.vm";

/** A sign-in mark at the reference swatch's size (Google 18 px round, X 16 px, wallets 26 px with 8 px corners). */
const mark = (src: string, size: number, radius = 0) => () => (
  <img src={src} alt="" aria-hidden="true" width={size} height={size} style={{ width: size, height: size, borderRadius: radius, flex: "none", display: "block" }} />
);
const slots = {
  googleMark: mark(BRAND_LOGOS.google, 18),
  xMark: mark(BRAND_LOGOS.x, 16),
  coreMark: mark(BRAND_LOGOS.core, 26, 8),
  metamaskMark: mark(BRAND_LOGOS.metamask, 26, 8),
  walletconnectMark: mark(BRAND_LOGOS.walletconnect, 26, 8),
};

/** Connect: `data-connect` buttons sign in through the Shell and return to the previous page. */
export default function Connect() {
  const [tab, setTab] = useState<AskTab>("Today");
  const [mode, setMode] = useState<AskMode>("Auto");
  const board = useApi<AskBoardRow[]>("/board", 30_000);
  const { me } = useChrome();
  const daily = useDailySuggestions();
  const v = useMemo(() => connectVM({ tab, mode, pickTab: setTab, pickMode: setMode, board: board.data ?? [], daily, draft: "", me }), [tab, mode, board.data, daily, me]);
  const history = useChatHistorySlots();
  return (
    <Shell title={title}>
      <ConnectScreen v={v} nav={nav} slots={{ ...slots, ...history }} />
    </Shell>
  );
}
