"use client";
/**
 * The Ask home's chat list (its sidebar in the reference shows only the empty state): the same history the
 * conversation screen keeps (chat.store — per wallet, or per anonymous session), so a chat started and left is
 * found again from the Ask rail. Rows are the conversation screen's rows (open on press, two-press delete).
 */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { css } from "../lib/tpl";
import { useWallet } from "../lib/wallet";
import { ConvRow } from "./chat.parts";
import { filterConvs, historyOf, ownerOf, saveConvs, type Conversation, type KV } from "./chat.store";

const storage = (): KV | null => {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
};

/** Saved conversations of this wallet / session, newest first, with a delete that persists. */
export function useChatHistory(): { convs: Conversation[]; remove: (id: string) => void } {
  const w = useWallet();
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [owner, setOwner] = useState<string | null>(null);
  useEffect(() => {
    const kv = storage();
    if (!kv) return;
    const now = Date.now();
    setConvs(historyOf(kv, w.address, now));
    setOwner(ownerOf(w.address));
  }, [w.address]);
  const remove = useCallback(
    (id: string) => {
      setConvs((xs) => {
        const next = xs.filter((c) => c.id !== id);
        const kv = storage();
        if (kv && owner) saveConvs(kv, owner, next);
        return next;
      });
    },
    [owner],
  );
  return { convs, remove };
}

/** The reference empty state (no chats yet). */
export function Empty({ text }: { text: string }): ReactNode {
  return (
    <div style={css("display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 56px 12px; text-align: center")}>
      <span style={css("display: flex; align-items: center; justify-content: center; width: 52px; height: 52px; border: 1px dashed #3A3A40; border-radius: 14px")}>
        <svg width="27" height="20" viewBox="10 14 324 241" aria-hidden="true">
          <path d="M94 16H238C291 16 331 60 331 113C331 166 291 206 240 206H213L219 200C247 195 267 176 267 153C267 126 247 104 221 104H94Z" fill="#8E8E96" opacity="0.55" />
          <path d="M137 146V252H12V214C12 176 42 146 80 146Z" fill="#9052F9" opacity="0.55" />
        </svg>
      </span>
      <span style={css("font-size: 15px; color: #B4B4BB")}>{text}</span>
    </div>
  );
}

/** Slots for the Ask home / Connect sidebars: a working search box and the saved chats (or the empty state). */
export function useChatHistorySlots(): Record<string, () => ReactNode> {
  const router = useRouter();
  const w = useWallet();
  const { convs, remove } = useChatHistory();
  const [search, setSearch] = useState("");
  const shown = filterConvs(convs, search);
  return {
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
    chatHistory: () =>
      convs.length === 0 ? (
        <Empty text={w.address ? "No chats yet" : "Connect to see your chats"} />
      ) : (
        <div style={css("display: flex; flex-direction: column; gap: 2px; padding-top: 4px")}>
          <span style={css("padding: 6px 12px; font-size: 12px; color: #8E8E96")}>Today</span>
          {shown.length === 0 ? <span style={css("padding: 6px 12px; font-size: 14px; color: #8E8E96")}>No chat matches “{search}”.</span> : null}
          {shown.map((c) => (
            <ConvRow
              key={c.id}
              cv={{ id: c.id, title: c.title, on: "false", bg: "transparent", fg: "#B4B4BB", pick: () => router.push(`/ask?c=${c.id}`), del: () => remove(c.id) }}
            />
          ))}
        </div>
      ),
  };
}
