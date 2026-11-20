import type { Account, Address, Hex, PublicClient } from "viem";
import { toPantadoError, tx, type PantadoReader } from "@pantado/sdk";
import type { LlmProvider, Turn } from "./llm.js";

/**
 * Agent-manager (spec §10.4): a dedicated testnet EOA that owns the "Pantado Agent" indexes. In Manual mode it
 * may publish a new version (new target weights + rationale) on ITS OWN indexes only; the Rebalancer applies
 * the notice, daily cap, loss budget and max duration to the resulting plan like any other. It has no other
 * on-chain permission and never signs user transactions.
 */

export interface ManagerConfig {
  tickers: string[]; // from services.json agent.managerIndexes (idx-cstk → CSTK)
  model: string;
  minIntervalSec: number;
  minChangePct: number;
  dryRun: boolean;
}

export interface Proposal {
  weights: number[]; // whole percents, same order as the index assets
  rationale: string;
}

export type ManagerOutcome =
  | { index: Address; ticker: string; action: "skipped"; reason: string }
  | { index: Address; ticker: string; action: "proposed"; proposal: Proposal; dryRun: true; simulated: "ok" | string }
  | { index: Address; ticker: string; action: "published"; proposal: Proposal; tx: Hex };

export interface ManagerDeps {
  reader: PantadoReader;
  client: PublicClient;
  account: Account;
  send(req: { to: Address; data: Hex }): Promise<Hex>;
  llm: LlmProvider;
  rebalancer: Address;
  now(): number;
}

const MANUAL = 1;
const BUSY = new Set([1, 2]); // Scheduled, Active

export function validateProposal(p: unknown, n: number): Proposal | string {
  if (!p || typeof p !== "object") return "no proposal";
  const { weights, rationale } = p as { weights?: unknown; rationale?: unknown };
  if (!Array.isArray(weights) || weights.length !== n) return `need ${n} weights`;
  if (!weights.every((w) => Number.isInteger(w) && (w as number) >= 1)) return "weights must be whole percents ≥ 1";
  if ((weights as number[]).reduce((a, b) => a + b, 0) !== 100) return "weights must sum to 100";
  if (typeof rationale !== "string" || rationale.trim().length < 10) return "rationale required";
  return { weights: weights as number[], rationale: rationale.trim().slice(0, 500) };
}

const PROPOSE_TOOL = {
  name: "propose_version",
  description: "Propose new target weights (whole percents, same assets and order, each ≥ 1, sum 100) with a one-paragraph rationale.",
  inputSchema: {
    type: "object",
    properties: { weights: { type: "array", items: { type: "integer" } }, rationale: { type: "string" } },
    required: ["weights", "rationale"],
    additionalProperties: false,
  },
};

async function propose(llm: LlmProvider, model: string, ctx: string): Promise<unknown> {
  const turns: Turn[] = [{ role: "user", content: [{ type: "text", text: ctx }] }];
  const r = await llm.turn({
    model,
    system:
      "You manage a public Pantado index in Manual mode. Decide whether its target weights should change and, if so, call propose_version once. Keep every current asset. Base the change on the data given; if no change is warranted, reply without calling the tool.",
    turns,
    tools: [PROPOSE_TOOL],
    effort: "high",
  });
  const call = r.content.find((b) => b.type === "tool_call" && b.name === "propose_version");
  return r.stop === "tool_use" && call && call.type === "tool_call" ? call.input : null;
}

export async function runManagerOnce(d: ManagerDeps, cfg: ManagerConfig): Promise<ManagerOutcome[]> {
  const out: ManagerOutcome[] = [];
  for (const ticker of cfg.tickers) {
    const index = await d.reader.indexByTicker(ticker);
    const skip = (reason: string): void => void out.push({ index, ticker, action: "skipped", reason });
    if (/^0x0{40}$/.test(index)) {
      skip("index not created yet");
      continue;
    }
    const ix = await d.reader.index(index);
    // own indexes only
    if (ix.creator.toLowerCase() !== d.account.address.toLowerCase()) {
      skip("not owned by the agent-manager");
      continue;
    }
    const ps = await d.reader.planState(index);
    if (ps.mode !== MANUAL) {
      skip("not in Manual mode");
      continue;
    }
    if (BUSY.has(ps.plan.status)) {
      skip("a plan is already scheduled or running");
      continue;
    }
    const last = Number(ps.plan.startAt);
    if (last > 0 && d.now() - last < cfg.minIntervalSec) {
      skip("last version is too recent");
      continue;
    }
    const k = await d.reader.basket(index);
    const target = k.targetBps.map((b) => b / 100);
    const ctx = JSON.stringify({
      ticker,
      assets: k.assets,
      targetPct: target,
      currentPct: k.currentBps.map((b) => Number(b) / 100),
      maxDriftBps: Number(k.maxDriftBps),
      allPricesFresh: k.allFresh,
    });
    const raw = await propose(d.llm, cfg.model, `Index state:\n${ctx}`);
    if (raw === null) {
      skip("no change proposed");
      continue;
    }
    const p = validateProposal(raw, k.assets.length);
    if (typeof p === "string") {
      skip(`invalid proposal: ${p}`);
      continue;
    }
    const maxChange = Math.max(...p.weights.map((w, i) => Math.abs(w - (target[i] ?? 0))));
    if (maxChange < cfg.minChangePct) {
      skip(`change ${maxChange}% below ${cfg.minChangePct}%`);
      continue;
    }
    const req = tx.publishVersion(d.rebalancer, index, p.weights.map((w) => w * 100), p.rationale);
    if (cfg.dryRun) {
      let simulated: "ok" | string = "ok";
      try {
        await d.client.call({ account: d.account, to: req.to, data: req.data });
      } catch (e) {
        simulated = toPantadoError(e).code;
      }
      out.push({ index, ticker, action: "proposed", proposal: p, dryRun: true, simulated });
      continue;
    }
    await d.client.call({ account: d.account, to: req.to, data: req.data }); // typed revert before sending
    const hash = await d.send(req);
    out.push({ index, ticker, action: "published", proposal: p, tx: hash });
  }
  return out;
}
