import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { dailySuggestions } from "./suggestions.js";
import { collectDefaultMetrics, Counter, Histogram, Registry } from "prom-client";
import { createClient } from "redis";
import { z } from "zod";
import type { Asset } from "@pantado/shared";
import type { PantadoApi } from "./api-client.js";
import { assess, type AssessmentInput } from "./assessment.js";
import type { DraftLimits } from "./draft.js";
import { ask, type AskReport, type HarnessConfig } from "./harness.js";
import { LlmError, type LlmProvider, type Turn } from "./llm.js";
import type { Card } from "./tools.js";

/** Chat history per wallet / anonymous session, 7-day expiry (spec §10.1, D13). */
export interface SessionStore {
  get(id: string): Promise<Turn[]>;
  set(id: string, turns: Turn[]): Promise<void>;
}

const TTL_SEC = 7 * 86400;
const MAX_TURNS = 40;

export function memorySessions(): SessionStore {
  const m = new Map<string, { exp: number; turns: Turn[] }>();
  return {
    async get(id) {
      const s = m.get(id);
      return s && s.exp > Date.now() ? s.turns : [];
    },
    async set(id, turns) {
      m.set(id, { exp: Date.now() + TTL_SEC * 1000, turns: turns.slice(-MAX_TURNS) });
    },
  };
}

export async function redisSessions(url: string): Promise<SessionStore> {
  const c = createClient({ url });
  await c.connect();
  return {
    async get(id) {
      const v = await c.get(`agent:session:${id}`);
      return v ? (JSON.parse(v) as Turn[]) : [];
    },
    async set(id, turns) {
      await c.set(`agent:session:${id}`, JSON.stringify(turns.slice(-MAX_TURNS)), { EX: TTL_SEC });
    },
  };
}

/**
 * Completed answers are kept without their reasoning blocks. A thinking block's signature is bound to everything that
 * preceded it, so once the stored history is trimmed (MAX_TURNS) or otherwise differs, a replayed block is rejected
 * ("bound to a different conversation"). Prior turns may omit them; they only matter inside one tool loop, which
 * the harness keeps in memory.
 */
export function withoutReasoning(turns: Turn[]): Turn[] {
  const isReasoning = (b: Turn["content"][number]): boolean => {
    if (b.type !== "opaque") return false;
    const t = (b.raw as { type?: unknown } | null)?.type;
    return t === "thinking" || t === "redacted_thinking";
  };
  return turns
    .map((t) => (t.role === "assistant" ? { ...t, content: t.content.filter((b) => !isReasoning(b)) } : t))
    .filter((t) => t.content.length > 0);
}

/** History must start with a plain user message (no orphan tool results after trimming). */
function trimHistory(turns: Turn[]): Turn[] {
  let i = 0;
  while (i < turns.length) {
    const t = turns[i];
    if (t && t.role === "user" && t.content.some((b) => b.type === "text")) break;
    i++;
  }
  return turns.slice(i);
}

export interface AgentDeps {
  llm: LlmProvider;
  api: PantadoApi;
  assets: Asset[];
  limits: DraftLimits;
  harness: HarnessConfig;
  sessions: SessionStore;
  /** contracts/config/params.json vault.tradeFeeBps */
  tradeFeeBps: number;
  /** services.json marketData.history.since as unix seconds (price_history, run_backtest) */
  historySince?: number;
  /** services.json agent.benchmark (run_backtest) */
  benchmark?: string;
  /** one structured line per answer (question, tools, latency, tokens, number check) */
  onReport?: (r: AskReport & { sessionKind: "wallet" | "anon"; question: string }) => void;
}

/** `wallet:0x…:<conversation>` → the wallet (read-only tools); anything else is anonymous. */
export function walletOf(sessionId: string): string | null {
  const m = /^wallet:(0x[0-9a-fA-F]{40}):/.exec(sessionId);
  return m ? (m[1] as string).toLowerCase() : null;
}

export function buildAgentServer(d: AgentDeps, registry = new Registry()): FastifyInstance {
  const app = Fastify({ logger: false });
  void app.register(cors, { origin: true });
  collectDefaultMetrics({ register: registry });
  const asks = new Counter({ name: "agent_asks_total", help: "ask requests", labelNames: ["mode", "result"], registers: [registry] });
  const dur = new Histogram({ name: "agent_ask_duration_seconds", help: "ask duration", labelNames: ["mode"], buckets: [1, 2, 5, 10, 20, 40, 80], registers: [registry] });
  const unverified = new Counter({ name: "agent_unverified_numbers_total", help: "figures in answers not found in tool results", labelNames: ["mode"], registers: [registry] });
  const tokens = new Counter({ name: "agent_llm_tokens_total", help: "LLM tokens", labelNames: ["mode", "kind"], registers: [registry] });
  const ctx = { api: d.api, assets: d.assets, limits: d.limits, historySince: d.historySince, benchmark: d.benchmark, wallet: null };

  app.get("/health", async () => ({ ok: true, service: "agent", provider: d.llm.name }));
  app.get("/metrics", async (_r, reply) => {
    void reply.header("content-type", registry.contentType);
    return registry.metrics();
  });

  const askBody = z.object({
    message: z.string().min(1).max(2000),
    mode: z.enum(["auto", "deep"]).default("auto"),
    // `wallet:0x<40>:<uuid>` is 86 characters
    sessionId: z.string().regex(/^[A-Za-z0-9_:-]{8,128}$/),
  });

  app.post("/ask", async (req, reply) => {
    const p = askBody.safeParse(req.body);
    if (!p.success) return reply.status(400).send({ error: { code: "BadRequest", message: "message, mode and sessionId required" } });
    const { message, mode, sessionId } = p.data;
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "access-control-allow-origin": "*",
    });
    const send = (event: string, data: unknown): void => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const abort = new AbortController();
    // stop the model only when the client goes away mid-answer: the request's own "close" fires as soon as its
    // body has been read, so it would abort every answer before the first token
    res.on("close", () => {
      if (!res.writableFinished) abort.abort();
    });
    const end = dur.startTimer({ mode });
    try {
      const history = trimHistory(withoutReasoning(await d.sessions.get(sessionId)));
      const turns = await ask(d.llm, d.harness, { ...ctx, wallet: walletOf(sessionId) }, history, message, mode, {
        meta: (m) => send("meta", m),
        token: (text) => send("token", { text }),
        card: (c: Card) => send("card", c),
        related: (questions) => send("related", { questions }),
        report: (r) => {
          unverified.inc({ mode }, r.numbers.unverified.length);
          for (const k of ["input", "output", "cacheRead", "cacheWrite"] as const) tokens.inc({ mode, kind: k }, r.usage[k]);
          d.onReport?.({ ...r, sessionKind: walletOf(sessionId) ? "wallet" : "anon", question: message });
        },
      }, abort.signal);
      await d.sessions.set(sessionId, withoutReasoning(turns));
      send("done", {});
      asks.inc({ mode, result: "ok" });
    } catch (e) {
      send("error", { message: e instanceof LlmError ? e.message : "The assistant failed to answer. Try again." });
      asks.inc({ mode, result: "error" });
    } finally {
      end();
      res.end();
    }
  });

  // Ask home: four questions per tab, rewritten once a UTC day from the live board; an empty tab = app fallback
  const suggestions = dailySuggestions({ api: d.api, llm: d.llm, model: d.harness.autoModel, assets: d.assets });
  app.get("/suggestions", async (_req, reply) => {
    try {
      return await suggestions();
    } catch (e) {
      return reply.status(503).send({ error: { code: "Unavailable", message: e instanceof Error ? e.message : String(e) } });
    }
  });

  app.post("/draft", async (req, reply) => {
    const p = z.object({ prompt: z.string().min(3).max(1000) }).safeParse(req.body);
    if (!p.success) return reply.status(400).send({ error: { code: "BadRequest", message: "prompt required" } });
    let draft: unknown = null;
    try {
      await ask(d.llm, d.harness, ctx, [], `Draft an index for this request and call draft_index once: ${p.data.prompt}`, "auto", {
        meta: () => undefined,
        token: () => undefined,
        card: (c) => {
          if (c.kind === "draft") draft = c.data;
        },
      });
    } catch (e) {
      return reply.status(502).send({ error: { code: "LlmError", message: e instanceof Error ? e.message : String(e) } });
    }
    if (!draft) return reply.status(422).send({ error: { code: "NoDraft", message: "Could not build a valid index from that request." } });
    return draft;
  });

  const assessments = new Map<string, { key: string; value: unknown }>();
  app.get<{ Params: { index: string } }>("/assessment/:index", async (req, reply) => {
    const index = req.params.index.toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(index)) return reply.status(400).send({ error: { code: "BadRequest", message: "index address required" } });
    const [comp, lv, reb, detail] = await Promise.all([
      d.api.get<{ legs: { id: string | null; symbol: string | null; kind: string | null; currentBps: string; targetBps: number }[] }>(`/indexes/${index}/composition`),
      d.api.get<{ levels: { ts: string; level: string }[] }>(`/indexes/${index}/levels?limit=1000`),
      d.api.get<{ plans: { status: string; loss: string | null; value: string | null }[] }>(`/indexes/${index}/rebalances`),
      d.api.get<{ version: number; targetBps: number[] }>(`/indexes/${index}`),
    ]);
    // regenerated on composition change (spec §10.3)
    const key = JSON.stringify([detail.version, detail.targetBps, reb.plans.length]);
    const hit = assessments.get(index);
    if (hit && hit.key === key) return hit.value;
    const input: AssessmentInput = {
      legs: comp.legs.map((l) => ({ id: l.id, symbol: l.symbol, kind: l.kind, currentBps: Number(l.currentBps), targetBps: l.targetBps })),
      levels: lv.levels.map((p) => ({ ts: Number(p.ts), level: Number(p.level) / 1e18 })),
      sizeCapUsd: Object.fromEntries(d.assets.map((a) => [a.id, a.kind === "stock" ? a.risk.sizeCapUsd : null])),
      plans: reb.plans.map((p) => ({ status: p.status, loss: p.loss === null ? null : Number(p.loss) / 1e18, value: p.value === null ? null : Number(p.value) / 1e18 })),
      tradeFeeBps: d.tradeFeeBps,
      spreadBps: Object.fromEntries(d.assets.map((a) => [a.id, a.kind === "quote" ? 0 : a.risk.spreadBps])),
    };
    const value = { index, ...assess(input) };
    assessments.set(index, { key, value });
    return value;
  });

  return app;
}
