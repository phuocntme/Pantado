"use client";
import { useCallback, useMemo, useState } from "react";
import { useApi } from "../lib/api";
import { useChrome } from "../lib/chrome";
import { nav } from "../lib/nav";
import { Shell } from "../lib/shell";
import { css, type Scope } from "../lib/tpl";
import { useWallet } from "../lib/wallet";
import { CreatorScreen, title } from "./gen/Creator.gen";
import { creatorVM, type BoardIndexRow, type CreatorResp } from "./creator.vm";
import { useMany } from "./portfolio.hooks";
import { str } from "./portfolio.parts";

/** Creator page for `address`; `self` = the Profile entry of the account menu (the connected wallet). */
export default function Creator({ address, self = false }: { address?: string; self?: boolean }) {
  const w = useWallet();
  const { me } = useChrome();
  const who = self ? w.address : (address ?? null);
  const creator = useApi<CreatorResp>(who ? `/creators/${who}` : null, 30_000);
  const board = useApi<BoardIndexRow[]>("/board?kind=indexes", 30_000);
  const ids = useMemo(() => (creator.data?.indexes ?? []).map((i) => i.id.toLowerCase()), [creator.data]);
  const holders = useMany<unknown[], number>(ids, (id) => `/indexes/${id}/holders`, (r) => r.length, 60_000);
  const [copied, setCopied] = useState(false);
  const wallet = creator.data?.wallet ?? who;
  const copy = useCallback(() => {
    if (!wallet) return;
    void navigator.clipboard?.writeText(wallet).then(
      () => setCopied(true),
      () => undefined,
    );
  }, [wallet]);

  const v = useMemo(
    () => creatorVM({ creator: creator.data, address: who, board: board.data ?? [], holders, copied, copy, me }),
    [creator.data, who, board.data, holders, copied, copy, me],
  );

  const slots = {
    walletCopy: (s: Scope) => (
      <button
        type="button"
        onClick={copy}
        style={css("display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 14px; background: #131316; color: #F2F2F3; border: 0; border-radius: 10px; font-size: 14px")}
      >
        <svg width="16" height="16" viewBox="0 0 22 22" aria-hidden="true">
          <path d="M3 6h14a2 2 0 012 2v8a2 2 0 01-2 2H3zM3 6V5a1 1 0 011-1h11M15 12h1" fill="none" stroke="#8E8E96" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
        {str("walletShort", s)}
        <span style={css("color: #8E8E96; font-size: 13px")}>{str("copyLabel", s)}</span>
      </button>
    ),
    xLink: (s: Scope) => {
      const x = s.x as { href: string; label: string } | null;
      if (!x) return null;
      return (
        <a style={css("display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 14px; background: #131316; border-radius: 10px; font-size: 14px")} href={x.href} target="_blank" rel="noreferrer">
          <span style={css("font-weight: 700; color: #8E8E96")} aria-hidden="true">
            {"X"}
          </span>
          {x.label}
        </a>
      );
    },
  };

  return (
    <Shell title={title}>
      <CreatorScreen v={v} nav={nav} slots={slots} />
    </Shell>
  );
}
