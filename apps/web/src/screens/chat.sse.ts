/**
 * Client for the agent's Ask stream (PORTING.md › Agent): `POST {agentUrl}/ask` with
 * `{ message, mode, sessionId }` → Server-Sent Events `meta` · `token` · `card` · `done` · `error`.
 * Read with `fetch` + `ReadableStream` (EventSource cannot POST).
 */

export type CardKind = "asset" | "draft" | "index" | "compare";
export interface AgentCard {
  kind: CardKind;
  data: unknown;
}

export type AskEvent =
  | { type: "meta"; tools: number; ms: number }
  | { type: "token"; text: string }
  | { type: "card"; card: AgentCard }
  /** follow-up questions on the exchange just answered */
  | { type: "related"; questions: string[] }
  | { type: "done" }
  | { type: "error"; message: string };

export interface SseFrame {
  event: string;
  data: string;
}

/** Typed error with a UI message. */
export class AgentError extends Error {
  constructor(
    readonly code: "Network" | "Http" | "Stream" | "Agent",
    message: string,
  ) {
    super(message);
  }
}

/** Split a buffer into complete SSE frames; `rest` is the trailing partial frame. */
export function parseSse(buf: string): { frames: SseFrame[]; rest: string } {
  const norm = buf.replace(/\r\n?/g, "\n");
  const parts = norm.split("\n\n");
  const rest = parts.pop() ?? "";
  const frames: SseFrame[] = [];
  for (const block of parts) {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (!line || line.startsWith(":")) continue;
      const i = line.indexOf(":");
      const field = i < 0 ? line : line.slice(0, i);
      let value = i < 0 ? "" : line.slice(i + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    if (data.length || event !== "message") frames.push({ event, data: data.join("\n") });
  }
  return { frames, rest };
}

const CARD_KINDS = new Set<string>(["asset", "draft", "index", "compare"]);

/** Typed Ask event from one frame (unknown events and malformed JSON are ignored). */
export function toAskEvent(f: SseFrame): AskEvent | null {
  let d: unknown = {};
  if (f.data) {
    try {
      d = JSON.parse(f.data) as unknown;
    } catch {
      return null;
    }
  }
  const o = (d && typeof d === "object" ? d : {}) as Record<string, unknown>;
  switch (f.event) {
    case "meta":
      return { type: "meta", tools: Number(o.tools ?? 0), ms: Number(o.ms ?? 0) };
    case "token":
      return typeof o.text === "string" ? { type: "token", text: o.text } : null;
    case "card":
      return typeof o.kind === "string" && CARD_KINDS.has(o.kind) ? { type: "card", card: { kind: o.kind as CardKind, data: o.data } } : null;
    case "related":
      return Array.isArray(o.questions) ? { type: "related", questions: o.questions.filter((q): q is string => typeof q === "string").slice(0, 3) } : null;
    case "done":
      return { type: "done" };
    case "error":
      return { type: "error", message: typeof o.message === "string" ? o.message : "The agent could not answer." };
    default:
      return null;
  }
}

export interface AskBody {
  message: string;
  mode: "auto" | "deep";
  sessionId: string;
}

/** Stream one Ask turn. Resolves after `done` (or end of stream); throws AgentError with a UI message. */
export async function askStream(agentUrl: string, body: AskBody, onEvent: (e: AskEvent) => void, signal?: AbortSignal): Promise<void> {
  let r: Response;
  try {
    r = await fetch(`${agentUrl}/ask`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (signal?.aborted) return;
    void e;
    throw new AgentError("Network", "Cannot reach the Pantado agent.");
  }
  if (!r.ok || !r.body) {
    const j = (await r.json().catch(() => ({}))) as { error?: { message?: string } | string };
    const msg = typeof j.error === "string" ? j.error : j.error?.message;
    throw new AgentError("Http", msg ?? `The agent is unavailable (${r.status}).`);
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const { frames, rest } = parseSse(buf);
      buf = rest;
      for (const f of frames) {
        const ev = toAskEvent(f);
        if (!ev) continue;
        if (ev.type === "error") throw new AgentError("Agent", ev.message);
        onEvent(ev);
        if (ev.type === "done") return;
      }
    }
    const tail = parseSse(`${buf}\n\n`).frames.map(toAskEvent);
    for (const ev of tail) {
      if (ev?.type === "error") throw new AgentError("Agent", ev.message);
      if (ev) onEvent(ev);
    }
  } catch (e) {
    if (signal?.aborted) return;
    if (e instanceof AgentError) throw e;
    throw new AgentError("Stream", "The answer stream was interrupted.");
  } finally {
    reader.releaseLock();
  }
}
