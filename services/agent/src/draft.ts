import { z } from "zod";
import type { Asset } from "@pantado/shared";

/**
 * Draft index (spec §10.2): one sentence → a draft the user reviews and signs in Create. Validated against
 * the registry and the §5 limits; never signed by the agent.
 */
export const draftInputSchema = z.object({
  name: z.string(),
  ticker: z.string(),
  description: z.string().default(""),
  components: z.array(z.string()),
  weights: z.array(z.number()).optional(),
  preset: z.enum(["equal", "marketcap", "lowvol", "custom"]).default("custom"),
  mode: z.enum(["Off", "Manual", "Auto"]).default("Auto"),
  driftPct: z.number().optional(),
  rationale: z.string().default(""),
});
export type DraftInput = z.input<typeof draftInputSchema>;

export interface Draft {
  name: string;
  ticker: string;
  description: string;
  components: string[];
  weights: number[];
  preset: "equal" | "marketcap" | "lowvol" | "custom";
  mode: "Off" | "Manual" | "Auto";
  driftPct: number | null;
  rationale: string;
}

export type DraftResult = { ok: true; draft: Draft } | { ok: false; errors: string[] };

export interface DraftLimits {
  minAssets: number;
  maxAssets: number;
  minWeightPct: number;
  driftMinPct: number;
  driftMaxPct: number;
}

/** Map a symbol, display symbol or id ("BTC.b", "AVAX", "nvda") to a registry id. */
export function resolveAssetId(key: string, assets: Asset[]): string | null {
  const k = key.trim().toLowerCase().replace(/\./g, "");
  const hit = assets.find(
    (a) => a.kind !== "quote" && (a.id === k || a.symbol.toLowerCase().replace(/\./g, "") === k || (k === "avax" && a.id === "wavax")),
  );
  return hit?.id ?? null;
}

/** Validate and normalise. `weights` must already be set (presets are applied by the caller). */
export function validateDraft(raw: unknown, assets: Asset[], lim: DraftLimits): DraftResult {
  const p = draftInputSchema.safeParse(raw);
  if (!p.success) return { ok: false, errors: p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  const d = p.data;
  const errors: string[] = [];
  const name = d.name.trim();
  if (name.length < 1 || name.length > 64) errors.push("name must be 1–64 characters");
  const ticker = d.ticker.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,6}$/.test(ticker)) errors.push("ticker must be 2–6 characters, A–Z or 0–9");
  const ids: string[] = [];
  for (const c of d.components) {
    const id = resolveAssetId(c, assets);
    if (!id) errors.push(`${c} is not a listed asset`);
    else if (ids.includes(id)) errors.push(`${c} appears twice`);
    else ids.push(id);
  }
  if (ids.length < lim.minAssets || ids.length > lim.maxAssets) errors.push(`an index holds ${lim.minAssets} to ${lim.maxAssets} assets`);
  const w = d.weights ?? [];
  if (w.length !== d.components.length) errors.push("one weight per asset");
  if (w.some((x) => !Number.isInteger(x) || x < lim.minWeightPct)) errors.push(`weights are whole percents, each at least ${lim.minWeightPct}%`);
  if (w.reduce((a, b) => a + b, 0) !== 100) errors.push("weights must sum to 100");
  let driftPct: number | null = null;
  if (d.mode === "Auto") {
    driftPct = d.driftPct ?? 50;
    if (driftPct < lim.driftMinPct || driftPct > lim.driftMaxPct) errors.push(`drift threshold must be ${lim.driftMinPct}–${lim.driftMaxPct}%`);
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    draft: { name, ticker, description: d.description.trim(), components: ids, weights: w, preset: d.preset, mode: d.mode, driftPct, rationale: d.rationale.trim() },
  };
}

/** `/create?draft=` payload the web app reads. */
export function draftLink(d: Draft): string {
  return `/create?draft=${Buffer.from(JSON.stringify(d)).toString("base64url")}`;
}
