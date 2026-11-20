/**
 * Run the Ask eval suite against a live API with the real LLM (costs tokens).
 *
 *   API_URL=http://127.0.0.1:3101 AGENT_LLM_API_KEY=… AGENT_AUTO_MODEL=… AGENT_DEEP_MODEL=… pnpm eval
 *   EVAL_ONLY=a1,r1   run some cases          EVAL_MODE=auto|deep   only that mode
 *   EVAL_WALLET=0x…   wallet for portfolio cases (default: the local stack's dev wallet)
 *
 * Prints one line per case and, per mode, pass rate, median latency, tokens and cost per answer; writes the
 * full results to eval/results/<time>.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { ANVIL_KEYS } from "@pantado/sdk/testing";
import { loadAssets, loadParams, loadServices } from "@pantado/shared";
import { requireEnv } from "@pantado/service-kit";
import { httpApi } from "../src/api-client.js";
import { ask, type AskReport } from "../src/harness.js";
import { providerFromEnv } from "../src/llm.js";
import type { Card, ToolCtx } from "../src/tools.js";
import { CASES } from "./cases.js";
import { costOf, median, score, type Price } from "./score.js";

const dir = import.meta.dirname;
const pricing = JSON.parse(readFileSync(join(dir, "pricing.json"), "utf8")) as Record<string, Price>;

async function main(): Promise<void> {
  const svc = loadServices();
  const params = loadParams();
  const harness = {
    autoModel: requireEnv(svc.agent.autoModelEnv),
    deepModel: requireEnv(svc.agent.deepModelEnv),
    autoMaxSteps: svc.agent.autoMaxSteps,
    deepMaxSteps: svc.agent.deepMaxSteps,
  };
  const llm = providerFromEnv();
  const ctx: ToolCtx = {
    api: httpApi(requireEnv("API_URL"), 15_000),
    assets: loadAssets(),
    limits: {
      minAssets: params.factory.minAssets,
      maxAssets: params.factory.maxAssets,
      minWeightPct: params.factory.minWeightBps / 100,
      driftMinPct: params.rebalancer.driftMinBps / 100,
      driftMaxPct: params.rebalancer.driftMaxBps / 100,
    },
    historySince: Date.parse(`${svc.marketData.history.since}T00:00:00Z`) / 1000,
    benchmark: svc.agent.benchmark,
  };
  const wallet = (process.env.EVAL_WALLET ?? privateKeyToAccount(ANVIL_KEYS[1]).address).toLowerCase();
  const only = process.env.EVAL_ONLY?.split(",").map((s) => s.trim());
  const mode = process.env.EVAL_MODE;
  const cases = CASES.filter((c) => (!only || only.includes(c.id)) && (!mode || c.mode === mode));

  const rows: { id: string; mode: string; pass: boolean; fails: string[]; ms: number; tokens: number; cost: number | null; tools: string[]; answer: string }[] = [];
  for (const c of cases) {
    const cards: Card[] = [];
    let rep: AskReport | null = null;
    let error: string | null = null;
    try {
      await ask(llm, harness, { ...ctx, wallet: c.wallet ? wallet : null }, [], c.question, c.mode, {
        meta: () => undefined,
        token: () => undefined,
        card: (k) => cards.push(k),
        report: (r) => (rep = r),
      });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const r = rep as AskReport | null;
    const fails = r ? score(c, r, cards) : [`error: ${error ?? "no report"}`];
    const row = {
      id: c.id,
      mode: c.mode,
      pass: fails.length === 0,
      fails,
      ms: r?.ms ?? 0,
      tokens: r ? r.usage.input + r.usage.output + r.usage.cacheRead + r.usage.cacheWrite : 0,
      cost: r ? costOf(r, pricing[r.model]) : null,
      tools: r?.tools ?? [],
      answer: r?.answer ?? "",
    };
    rows.push(row);
    console.log(`${row.pass ? "PASS" : "FAIL"} ${c.id.padEnd(3)} ${c.mode.padEnd(4)} ${(row.ms / 1000).toFixed(1).padStart(5)}s  ${row.tools.join(",") || "-"}${row.pass ? "" : `  ← ${fails.join("; ")}`}`);
  }

  console.log("");
  for (const m of ["auto", "deep"]) {
    const xs = rows.filter((r) => r.mode === m);
    if (!xs.length) continue;
    const pass = xs.filter((r) => r.pass).length;
    const costs = xs.map((r) => r.cost).filter((v): v is number => v !== null);
    const avgCost = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null;
    console.log(
      `${m}: ${pass}/${xs.length} pass (${Math.round((pass / xs.length) * 100)} %) · median ${(median(xs.map((r) => r.ms)) / 1000).toFixed(1)} s · ${Math.round(xs.reduce((a, r) => a + r.tokens, 0) / xs.length)} tokens/answer · ${avgCost === null ? "cost n/a (model not in pricing.json)" : `$${avgCost.toFixed(4)}/answer`}`,
    );
  }
  const out = join(dir, "results");
  mkdirSync(out, { recursive: true });
  const file = join(out, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify({ harness, rows }, null, 2));
  console.log(`\nresults: ${file}`);
  if (rows.some((r) => !r.pass)) process.exitCode = 1;
}

void main();
