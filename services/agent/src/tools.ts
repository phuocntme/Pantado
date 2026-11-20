import { formatUnits, parseUnits } from "viem";
import { z } from "zod";
import type { Asset } from "@pantado/shared";
import { backtest, periodStart, summarize, type Candle } from "./analytics.js";
import type { PantadoApi } from "./api-client.js";
import { draftLink, resolveAssetId, validateDraft, type DraftLimits } from "./draft.js";
import type { ToolSpec } from "./llm.js";

/** Card shown in the Ask conversation (PORTING.md agent contract). */
export interface Card {
  kind: "asset" | "draft" | "index" | "compare";
  data: unknown;
}

export interface ToolOutput {
  result: unknown;
  card?: Card;
}

export interface ToolCtx {
  api: PantadoApi;
  assets: Asset[];
  limits: DraftLimits;
  /** Connected wallet of this conversation (from its session), null when anonymous. Read-only use. */
  wallet?: string | null;
  /** Start of the price history (unix seconds, `marketData.history.since`). */
  historySince?: number;
  /** Asset id the backtest compares against (`agent.benchmark`). */
  benchmark?: string;
  now?: () => number;
}

const PERIODS = ["7d", "30d", "90d", "180d", "1y", "ytd", "all"] as const;
const nowOf = (ctx: ToolCtx): number => (ctx.now ?? (() => Math.floor(Date.now() / 1000)))();
const idOf = (key: string, ctx: ToolCtx): string => resolveAssetId(key, ctx.assets) ?? key.trim().toLowerCase().replace(/\./g, "");
const fail = (e: unknown): { error: string } => ({ error: e instanceof Error ? e.message : String(e) });

async function daily(ctx: ToolCtx, id: string, from: number): Promise<{ source: string | null; candles: Candle[] }> {
  const days = Math.min(5000, Math.ceil((nowOf(ctx) - from) / 86_400) + 2);
  return ctx.api.get<{ source: string | null; candles: Candle[] }>(`/assets/${encodeURIComponent(id)}/candles?interval=1d&limit=${days}`);
}

interface ApiAsset {
  id: string;
  symbol: string;
  kind: string;
  decimals: number;
  execution: { address: string } | null;
}

interface ToolDef<S extends z.ZodType> {
  spec: ToolSpec;
  schema: S;
  run(input: z.output<S>, ctx: ToolCtx): Promise<ToolOutput>;
}

const def = <S extends z.ZodType>(name: string, description: string, schema: S, run: ToolDef<S>["run"]): ToolDef<S> => ({
  spec: { name, description, inputSchema: { ...(z.toJSONSchema(schema) as Record<string, unknown>), additionalProperties: false } },
  schema,
  run,
});

/** Plain-language explanations; numbers come from contract parameters (spec §5, §13). */
const GLOSSARY: Record<string, string> = {
  level: "An index level is the USD value of one index unit: basket value divided by units outstanding. Every index starts at 100.00.",
  drift: "Drift is how far an asset's current weight is from its target, relative to the target: |current − target| / target. Auto indexes rebalance when the largest drift reaches their threshold θ (10–200 %, default 50 %) or every 30 days.",
  rebalancing:
    "Rebalancing moves the basket back to its target weights through public Dutch auctions: overweight assets are sold for underweight ones, in lots of at most 1 % of the index value, after a 48 h public notice, with at most 5 % of the value traded per 24 h and a loss budget of 1 % per plan. Plans end after 14 days at most.",
  redeem: "Redeem in-kind returns your share of every asset in the basket. It is always open, has no fee, needs no price and cannot be paused.",
  fees: "Buying or selling an index costs 0.50 % (0.30 % protocol, 0.20 % creator; private indexes send all of it to the protocol). Creating an index costs 5 USDC. Single-asset swaps cost 0.10 %. The stock venue spread is 0.15 %. Redeem is free.",
  modes: "Off: no trades, weights drift. Manual: the creator publishes new versions of the target weights with a reason. Auto: fixed targets, rebalanced on drift or every 30 days. Mode changes take effect after 48 h; Auto → Manual goes through Off.",
  stocks:
    "Stocks trade on Fuji as pTokens through the Pantado stock venue, 24/7, at the reference price ± 0.15 %. Prices come from the reference market on Robinhood Chain. The stock venue is pluggable and will point to permissionless stock pools on Avalanche once they are released.",
};

export function buildTools(): ToolDef<z.ZodType>[] {
  const tools = [
    def(
      "search_assets",
      "Find listed assets by ticker, name or contract address. Call it first when the user names an asset you are not sure is listed, or when a ticker could match several assets; then use the returned id with the other tools. Not needed for well-known listed tickers (AVAX, BTC.b, NVDA).",
      z.object({ query: z.string().min(1).describe("ticker, name or 0x contract address") }),
      async ({ query }, ctx) => ({ result: await ctx.api.get<unknown>(`/assets/search?q=${encodeURIComponent(query)}`) }),
    ),
    def(
      "get_asset",
      "Current price (with its timestamp and source), 24h/7d/30d change, trading venue state and limits of ONE listed asset. Shows the asset card. For changes over other periods, highs/lows or volatility use price_history; for 2–4 assets use compare_assets.",
      z.object({ asset: z.string().describe("ticker, name or id, e.g. NVDA, BTC.b, avax") }),
      async ({ asset }, ctx) => {
        const a = await ctx.api.get<Record<string, unknown>>(`/assets/${encodeURIComponent(idOf(asset, ctx))}`);
        const board = await ctx.api.get<{ id: string }[]>("/board");
        const row = board.find((r) => r.id === a.id) ?? null;
        const data = { ...a, board: row };
        return { result: data, card: { kind: "asset", data } };
      },
    ),
    def(
      "compare_assets",
      "Compare 2–4 listed assets side by side: price, 24h/7d/30d change, kind. For longer periods add price_history per asset.",
      z.object({ assets: z.array(z.string()).min(2).max(4) }),
      async ({ assets }, ctx) => {
        const board = await ctx.api.get<{ id: string; symbol: string }[]>("/board");
        const rows = assets.map((k) => {
          const id = idOf(k, ctx);
          return board.find((r) => r.id === id) ?? { id, missing: true };
        });
        return { result: rows, card: { kind: "compare", data: rows } };
      },
    ),
    def(
      "price_history",
      "Price history summary of ONE asset over a period, from daily candles of its reference market: open, close, return %, highest and lowest price with dates, annualised volatility %, max drawdown %. Use for 'how did X do in March / this year / since …' and for risk questions. History starts 2025-01-01 (stocks: when their reference market opened); coverage 'partial' means the data starts later than asked — say so.",
      z.object({
        asset: z.string(),
        period: z.enum(PERIODS).optional().describe("named period ending today; ignored when from is given"),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("start date YYYY-MM-DD"),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("end date YYYY-MM-DD, default today"),
      }),
      async ({ asset, period, from, to }, ctx) => {
        const id = idOf(asset, ctx);
        const now = nowOf(ctx);
        const since = ctx.historySince ?? 0;
        const f = from ? Date.parse(`${from}T00:00:00Z`) / 1000 : periodStart(period ?? "30d", now, since);
        const t = to ? Date.parse(`${to}T00:00:00Z`) / 1000 + 86_399 : now;
        if (!(f < t)) return { result: { error: "from must be before to" } };
        try {
          const h = await daily(ctx, id, Math.max(f, since));
          const sum = summarize(h.candles, Math.max(f, since), t);
          if (!sum) return { result: { asset: id, coverage: "none", error: "no price history for this period" } };
          return { result: { asset: id, source: h.source, ...sum, ...(f < since ? { coverage: "partial" as const } : {}) } };
        } catch (e) {
          return { result: fail(e) };
        }
      },
    ),
    def(
      "get_board",
      "Market board: listed stocks, tokens and public indexes with price and 24h/7d/30d changes (top 40). Use for 'what moved most', 'best tokens this week' or to pick candidates for a theme.",
      z.object({ kind: z.enum(["all", "stocks", "tokens", "indexes"]).default("all") }),
      async ({ kind }, ctx) => {
        const rows = await ctx.api.get<unknown[]>(`/board?kind=${kind}`);
        return { result: rows.slice(0, 40) };
      },
    ),
    def(
      "get_index",
      "One public index by ticker or address: composition with current vs target weights, level (starts at 100), mode, version, rebalances. Shows the index card (with its Buy / View links). Use before answering anything about an existing index.",
      z.object({ index: z.string().describe("ticker (e.g. CSTK) or 0x address") }),
      async ({ index }, ctx) => {
        let addr = index;
        if (!/^0x[0-9a-fA-F]{40}$/.test(index)) {
          const list = await ctx.api.get<{ id: string; ticker: string }[]>("/indexes");
          const hit = list.find((i) => i.ticker.toLowerCase() === index.toLowerCase().replace(/^idx-/, ""));
          if (!hit) return { result: { error: `No public index with ticker ${index}` } };
          addr = hit.id;
        }
        const [detail, comp] = await Promise.all([ctx.api.get<unknown>(`/indexes/${addr}`), ctx.api.get<unknown>(`/indexes/${addr}/composition`)]);
        const data = { detail, composition: comp };
        return { result: data, card: { kind: "index", data } };
      },
    ),
    def(
      "get_presets",
      "Deterministic weights for 2–20 assets: equal, marketcap (∝ market cap, 40 % cap per asset, excess redistributed) or lowvol (∝ 1 / 90-day volatility). Never invent weights for these presets — call this, or pass the preset to draft_index.",
      z.object({ assets: z.array(z.string()).min(2).max(20), preset: z.enum(["equal", "marketcap", "lowvol"]) }),
      async ({ assets, preset }, ctx) => {
        try {
          return { result: await ctx.api.get<unknown>(`/presets?assets=${assets.map((a) => idOf(a, ctx)).join(",")}&preset=${preset}`) };
        } catch (e) {
          return { result: fail(e) };
        }
      },
    ),
    def(
      "run_backtest",
      "Hypothetical past performance of a basket (2–20 listed assets, whole-percent weights summing to 100) over a period: return %, annualised volatility %, max drawdown %, against a benchmark, held or reset monthly. Call it before recommending an index; report it as hypothetical (no fees, not a forecast). Coverage 'partial' means the common history starts later than asked — say from when.",
      z.object({
        assets: z.array(z.string()).min(2).max(20),
        weights: z.array(z.number().int().min(1).max(100)).describe("whole percents in the order of assets, sum 100"),
        period: z.enum(PERIODS).default("1y"),
        rebalance: z.enum(["none", "monthly"]).default("monthly").describe("monthly ≈ Auto mode's 30-day reset"),
      }),
      async ({ assets, weights, period, rebalance }, ctx) => {
        if (weights.length !== assets.length) return { result: { error: "one weight per asset" } };
        if (weights.reduce((a, b) => a + b, 0) !== 100) return { result: { error: "weights must sum to 100" } };
        const ids = assets.map((a) => idOf(a, ctx));
        if (new Set(ids).size !== ids.length) return { result: { error: "each asset once" } };
        const now = nowOf(ctx);
        const since = ctx.historySince ?? 0;
        const from = Math.max(periodStart(period, now, since), since);
        try {
          const bid = ctx.benchmark ?? null;
          const [hist, bench] = await Promise.all([Promise.all(ids.map((id) => daily(ctx, id, from))), bid ? daily(ctx, bid, from) : Promise.resolve(null)]);
          const series = new Map(ids.map((id, i) => [id, hist[i]?.candles ?? []]));
          const w = new Map(ids.map((id, i) => [id, (weights[i] as number) / 100]));
          const r = backtest(series, w, from, now, rebalance, bid && bench ? { id: bid, candles: bench.candles } : null);
          return { result: { assets: ids, weights, ...r } };
        } catch (e) {
          return { result: fail(e) };
        }
      },
    ),
    def(
      "draft_index",
      "Create a draft index the user reviews and signs in Create (shows the draft card with 'Create from this'). Listed assets only, within the protocol limits; weights are whole percents summing to 100, each ≥ 1. With a preset, pass preset and omit weights. The user signs; you never send transactions.",
      z.object({
        name: z.string(),
        ticker: z.string(),
        description: z.string().default(""),
        components: z.array(z.string()),
        weights: z.array(z.number().int()).optional(),
        preset: z.enum(["equal", "marketcap", "lowvol", "custom"]).default("custom"),
        mode: z.enum(["Off", "Manual", "Auto"]).default("Auto"),
        driftPct: z.number().optional(),
        rationale: z.string(),
      }),
      async (input, ctx) => {
        let weights = input.weights;
        if (!weights && input.preset !== "custom") {
          try {
            const p = await ctx.api.get<{ weights: number[] }>(`/presets?assets=${input.components.map((a) => idOf(a, ctx)).join(",")}&preset=${input.preset}`);
            weights = p.weights;
          } catch (e) {
            return { result: { error: `preset unavailable: ${fail(e).error}` } };
          }
        }
        const r = validateDraft({ ...input, weights }, ctx.assets, ctx.limits);
        if (!r.ok) return { result: { error: "draft invalid", details: r.errors } };
        const data = { ...r.draft, link: draftLink(r.draft) };
        return { result: data, card: { kind: "draft", data } };
      },
    ),
    def(
      "get_portfolio",
      "The connected wallet's index positions (value, cost, P&L), indexes it created and token balances, on Fuji testnet. Only for questions about the user's own holdings. Returns an error when no wallet is connected — then ask the user to connect.",
      z.object({}),
      async (_i, ctx) => {
        if (!ctx.wallet) return { result: { error: "No wallet connected. Connect a wallet to see your portfolio." } };
        try {
          return { result: await ctx.api.get<unknown>(`/portfolio/${ctx.wallet}`) };
        } catch (e) {
          return { result: fail(e) };
        }
      },
    ),
    def(
      "get_quote",
      "Prepare a quote (no transaction): what a swap or an index buy/sell would give right now on Fuji, with fees and minimum after 0.5 % slippage. Use when the user asks 'how much would I get' or wants to trade; then point them to the card's Trade / Buy button — they review and sign in their wallet. kind=swap needs from, to (tickers, USDC allowed) and amount of `from`; kind=index_buy needs index and amount in USDC; kind=index_sell needs index and amount in index units.",
      z.object({
        kind: z.enum(["swap", "index_buy", "index_sell"]),
        amount: z.string().regex(/^\d+(\.\d+)?$/).describe("human amount, e.g. \"100\" or \"0.25\""),
        from: z.string().optional(),
        to: z.string().optional(),
        index: z.string().optional().describe("index ticker or 0x address"),
      }),
      async (q, ctx) => {
        try {
          if (q.kind === "swap") {
            if (!q.from || !q.to) return { result: { error: "swap needs from and to" } };
            const key = (k: string): string => (k.trim().toLowerCase() === "usdc" ? "usdc" : idOf(k, ctx));
            const [a, b] = await Promise.all([ctx.api.get<ApiAsset>(`/assets/${key(q.from)}`), ctx.api.get<ApiAsset>(`/assets/${key(q.to)}`)]);
            if (!a.execution || !b.execution) return { result: { error: "asset not tradable on Fuji" } };
            const r = await ctx.api.post<{ amountOut: string; fee: string; minOut: string; blockNumber: string }>("/quote/swap", {
              tokenIn: a.execution.address,
              tokenOut: b.execution.address,
              amountIn: parseUnits(q.amount, a.decimals).toString(),
            });
            const target = a.kind === "quote" ? b : a;
            const data = await ctx.api.get<Record<string, unknown>>(`/assets/${target.id}`);
            return {
              result: {
                kind: "swap",
                network: "Fuji testnet",
                pay: `${q.amount} ${a.symbol}`,
                receive: `${formatUnits(BigInt(r.amountOut), b.decimals)} ${b.symbol}`,
                minReceive: `${formatUnits(BigInt(r.minOut), b.decimals)} ${b.symbol}`,
                feeUsdc: formatUnits(BigInt(r.fee), 6),
                block: r.blockNumber,
                next: `Open ${target.symbol} and press Trade to review and sign.`,
              },
              card: { kind: "asset", data: { ...data, board: null } },
            };
          }
          if (!q.index) return { result: { error: `${q.kind} needs index` } };
          let addr = q.index;
          if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
            const list = await ctx.api.get<{ id: string; ticker: string }[]>("/indexes");
            const hit = list.find((i) => i.ticker.toLowerCase() === addr.toLowerCase().replace(/^idx-/, ""));
            if (!hit) return { result: { error: `No public index with ticker ${q.index}` } };
            addr = hit.id;
          }
          const side = q.kind === "index_buy" ? "buy" : "sell";
          const r = await ctx.api.post<Record<string, string>>("/quote/basket", { index: addr, side, amount: parseUnits(q.amount, side === "buy" ? 6 : 18).toString() });
          const result =
            side === "buy"
              ? { kind: q.kind, network: "Fuji testnet", payUsdc: q.amount, feeUsdc: formatUnits(BigInt(r.fee ?? "0"), 6), units: formatUnits(BigInt(r.units ?? "0"), 18), minUnits: formatUnits(BigInt(r.minUnits ?? "0"), 18) }
              : { kind: q.kind, network: "Fuji testnet", units: q.amount, feeUsdc: formatUnits(BigInt(r.fee ?? "0"), 6), receiveUsdc: formatUnits(BigInt(r.usdcOut ?? "0"), 6), minReceiveUsdc: formatUnits(BigInt(r.minOut ?? "0"), 6) };
          const [detail, comp] = await Promise.all([ctx.api.get<unknown>(`/indexes/${addr}`), ctx.api.get<unknown>(`/indexes/${addr}/composition`)]);
          return { result: { ...result, next: "Open the index and press Buy / Sell to review and sign." }, card: { kind: "index", data: { detail, composition: comp } } };
        } catch (e) {
          return { result: fail(e) };
        }
      },
    ),
    def(
      "explain",
      "Explain a Pantado concept with the protocol's real parameters (fees, limits, timings). Use instead of answering protocol questions from memory.",
      z.object({ topic: z.enum(["level", "drift", "rebalancing", "redeem", "fees", "modes", "stocks"]) }),
      async ({ topic }) => ({ result: { topic, text: GLOSSARY[topic] } }),
    ),
  ];
  return tools as unknown as ToolDef<z.ZodType>[];
}

/** Run a tool call, validating its input; failures come back as error results, never thrown. */
export async function runTool(tools: ToolDef<z.ZodType>[], name: string, input: unknown, ctx: ToolCtx): Promise<ToolOutput & { isError: boolean }> {
  const t = tools.find((x) => x.spec.name === name);
  if (!t) return { result: { error: `unknown tool ${name}` }, isError: true };
  const parsed = t.schema.safeParse(input);
  if (!parsed.success) return { result: { error: "INVALID_INPUT", issues: parsed.error.issues.map((i) => i.message) }, isError: true };
  try {
    const out = await t.run(parsed.data, ctx);
    const isError = typeof out.result === "object" && out.result !== null && "error" in out.result;
    return { ...out, isError };
  } catch (e) {
    return { result: { error: e instanceof Error ? e.message : String(e) }, isError: true };
  }
}
