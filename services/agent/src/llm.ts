import Anthropic from "@anthropic-ai/sdk";

/**
 * Provider-agnostic LLM client (spec §10.1). The harness speaks one neutral turn format; each provider
 * adapts it. `AGENT_LLM_PROVIDER` selects the adapter; models come from AGENT_AUTO_MODEL / AGENT_DEEP_MODEL.
 */

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema (object). */
  inputSchema: Record<string, unknown>;
}

export type Block =
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; content: string; isError?: boolean }
  /** Provider-specific blocks that must be echoed back unchanged (e.g. thinking). */
  | { type: "opaque"; provider: string; raw: unknown };

export interface Turn {
  role: "user" | "assistant";
  content: Block[];
}

export interface TurnRequest {
  model: string;
  system: string;
  turns: Turn[];
  tools: ToolSpec[];
  effort: "low" | "medium" | "high";
  onText?: (delta: string) => void;
  signal?: AbortSignal;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface TurnResult {
  content: Block[];
  stop: "end" | "tool_use" | "max_tokens" | "refusal" | "other";
  usage?: Usage;
}

export interface LlmProvider {
  readonly name: string;
  turn(req: TurnRequest): Promise<TurnResult>;
}

export class LlmError extends Error {
  override readonly name = "LlmError";
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------- Anthropic adapter

/** Models that accept the server-side refusal fallback (`fallbacks: "default"`). */
const FALLBACK_MODELS = /^claude-(opus-5-5|opus-5|sonnet-5-5|fable-5-[12])$/;

function toAnthropic(turns: Turn[]): Anthropic.Beta.BetaMessageParam[] {
  return turns.map((t) => ({
    role: t.role,
    content: t.content.map((b): Anthropic.Beta.BetaContentBlockParam => {
      switch (b.type) {
        case "text":
          return { type: "text", text: b.text };
        case "tool_call":
          return { type: "tool_use", id: b.id, name: b.name, input: b.input };
        case "tool_result":
          return { type: "tool_result", tool_use_id: b.id, content: b.content, is_error: b.isError ?? false };
        case "opaque":
          return b.raw as Anthropic.Beta.BetaContentBlockParam;
      }
    }),
  }));
}

export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  private readonly client: Anthropic;

  constructor(apiKey?: string) {
    this.client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();
  }

  async turn(req: TurnRequest): Promise<TurnResult> {
    const tools: Anthropic.Beta.BetaToolUnion[] = req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
      eager_input_streaming: true,
    }));
    const useFallback = FALLBACK_MODELS.test(req.model);
    try {
      const stream = this.client.beta.messages.stream(
        {
          model: req.model,
          max_tokens: 16_000,
          system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
          messages: toAnthropic(req.turns),
          tools,
          tool_choice: { type: "auto" },
          output_config: { effort: req.effort },
          ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        },
        { signal: req.signal },
      );
      stream.on("text", (delta) => req.onText?.(delta));
      const msg = await stream.finalMessage();
      const content: Block[] = [];
      for (const b of msg.content) {
        if (b.type === "text") content.push({ type: "text", text: b.text });
        else if (b.type === "tool_use") content.push({ type: "tool_call", id: b.id, name: b.name, input: b.input });
        else content.push({ type: "opaque", provider: "anthropic", raw: b });
      }
      const stop =
        msg.stop_reason === "end_turn" ? "end"
        : msg.stop_reason === "tool_use" ? "tool_use"
        : msg.stop_reason === "max_tokens" ? "max_tokens"
        : msg.stop_reason === "refusal" ? "refusal"
        : "other";
      const u = msg.usage;
      const usage: Usage = { input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 };
      return { content, stop, usage };
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) throw new LlmError("The assistant is busy. Try again in a moment.", true);
      if (e instanceof Anthropic.AuthenticationError) throw new LlmError("The assistant is not configured (LLM credentials).", false);
      if (e instanceof Anthropic.BadRequestError) throw new LlmError(`LLM request rejected: ${e.message}`, false);
      // no HTTP status: the provider was not reached (network, DNS, timeout)
      if (e instanceof Anthropic.APIConnectionError) throw new LlmError("Cannot reach the AI provider. Try again in a moment.", true);
      if (e instanceof Anthropic.APIError) throw new LlmError(`The assistant failed (provider error ${String(e.status ?? "unknown")}).`, (e.status ?? 500) >= 500);
      throw e;
    }
  }
}

// ---------------------------------------------------------------- scripted adapter (tests, recorded fixtures)

/** Replays recorded turns in order; streams text blocks through `onText`. */
export class ScriptedProvider implements LlmProvider {
  readonly name = "scripted";
  readonly requests: TurnRequest[] = [];
  private i = 0;
  constructor(private readonly script: TurnResult[]) {}
  async turn(req: TurnRequest): Promise<TurnResult> {
    this.requests.push({ ...req, turns: structuredClone(req.turns) });
    const r = this.script[this.i++];
    if (!r) throw new LlmError("script exhausted", false);
    for (const b of r.content) if (b.type === "text") req.onText?.(b.text);
    return r;
  }
}

export function providerFromEnv(): LlmProvider {
  const p = process.env.AGENT_LLM_PROVIDER ?? "anthropic";
  if (p === "anthropic") return new AnthropicProvider(process.env.AGENT_LLM_API_KEY || undefined);
  throw new LlmError(`LLM provider "${p}" has no adapter yet`, false);
}
