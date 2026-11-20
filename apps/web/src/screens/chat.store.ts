/**
 * Ask chat history (spec §10.1): per wallet, or per anonymous session before connect. The anonymous session id
 * lives in localStorage with a 7-day expiry; its conversations expire with it and move to the wallet on connect.
 */
import type { AgentCard } from "./chat.sse";

export interface Turn {
  q: string;
  mode: "auto" | "deep";
  text: string;
  cards: AgentCard[];
  meta: { tools: number; ms: number } | null;
  status: "streaming" | "done" | "error";
  error?: string;
  /** follow-ups the agent suggested for this exchange */
  related?: string[];
}

export interface Conversation {
  id: string;
  title: string;
  created: number; // ms
  updated: number; // ms
  turns: Turn[];
}

export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export const SESSION_KEY = "pantado-ask-session";
export const TTL_MS = 7 * 86_400_000;
const MAX_CONVS = 50;
const convKey = (owner: string): string => `pantado-ask:${owner}`;

function read<T>(kv: KV, k: string): T | null {
  try {
    const s = kv.getItem(k);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}

function write(kv: KV, k: string, v: unknown): void {
  try {
    kv.setItem(k, JSON.stringify(v));
  } catch {
    /* storage full or unavailable: history is a convenience */
  }
}

export const newId = (): string =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/** Anonymous session id; a new one (and an empty history) after 7 days. */
export function anonSession(kv: KV, now: number, mkId: () => string = newId): string {
  const s = read<{ id: string; exp: number }>(kv, SESSION_KEY);
  if (s && typeof s.id === "string" && s.exp > now) return s.id;
  if (s?.id) kv.removeItem(convKey(`anon:${s.id}`));
  const id = mkId();
  write(kv, SESSION_KEY, { id, exp: now + TTL_MS });
  return id;
}

/** History owner: the connected wallet. Without a wallet nothing is listed or saved. */
export function ownerOf(address: string | null): string | null {
  return address ? `wallet:${address.toLowerCase()}` : null;
}

/** Conversations of an owner, newest first. Anonymous conversations older than 7 days are dropped. */
export function loadConvs(kv: KV, owner: string, now: number): Conversation[] {
  const xs = read<Conversation[]>(kv, convKey(owner));
  if (!Array.isArray(xs)) return [];
  return xs
    .filter((c) => c && typeof c.id === "string" && Array.isArray(c.turns))
    .filter((c) => !owner.startsWith("anon:") || c.updated > now - TTL_MS)
    .sort((a, b) => b.updated - a.updated);
}

export function saveConvs(kv: KV, owner: string, convs: Conversation[]): void {
  // a turn still streaming when saved is stored as interrupted
  const clean = convs.slice(0, MAX_CONVS).map((c) => ({
    ...c,
    turns: c.turns.map((t) => (t.status === "streaming" ? { ...t, status: "error" as const, error: t.error ?? "The answer was interrupted." } : t)),
  }));
  write(kv, convKey(owner), clean);
}

/**
 * The saved chats to show: the connected wallet's own, nothing without a wallet. Chats asked before connecting are
 * not saved and never move into a wallet; history an older build kept for the anonymous session is deleted.
 */
export function historyOf(kv: KV, address: string | null, now: number): Conversation[] {
  kv.removeItem(convKey(`anon:${anonSession(kv, now)}`));
  const owner = ownerOf(address);
  return owner ? loadConvs(kv, owner, now) : [];
}

/** Conversation title from the first question (sidebar list). */
export function titleOf(q: string): string {
  const s = q.trim().replace(/\s+/g, " ");
  return s.length > 40 ? `${s.slice(0, 39).trimEnd()}…` : s;
}

/** Conversations whose title or any question contains `search` (case-insensitive); all when empty. */
export function filterConvs(convs: Conversation[], search: string): Conversation[] {
  const s = search.trim().toLowerCase();
  return s ? convs.filter((c) => c.title.toLowerCase().includes(s) || c.turns.some((t) => t.q.toLowerCase().includes(s))) : convs;
}
