/**
 * Create pre-fill: `/create?draft=<base64url JSON>` (agent draft, PORTING.md › Agent) and
 * `/create?fork=<indexAddress>` (copy that index's assets and weights). Pure, unit-tested.
 */

export type Mode = "Off" | "Manual" | "Auto";
export type PresetKey = "equal" | "marketcap" | "lowvol";

export interface Prefill {
  name?: string;
  ticker?: string;
  description?: string;
  picked: string[];
  w: Record<string, number>;
  mode?: Mode;
  preset?: PresetKey;
}

const MODES: Record<string, Mode> = { off: "Off", manual: "Manual", auto: "Auto", "0": "Off", "1": "Manual", "2": "Auto" };
const PRESETS: Record<string, PresetKey> = { equal: "equal", marketcap: "marketcap", "market cap": "marketcap", lowvol: "lowvol", "low volatility": "lowvol" };

export const cleanTicker = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);

function b64urlDecode(s: string): string {
  const b = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b.length % 4 ? "=".repeat(4 - (b.length % 4)) : "";
  const bin = atob(b + pad);
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeDraft(d: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(d));
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const str = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

/** Parse an agent draft; unknown asset ids are dropped (registry only). Returns null when unreadable. */
export function parseDraft(raw: string, known: Set<string>): Prefill | null {
  let d: unknown;
  try {
    d = JSON.parse(b64urlDecode(raw));
  } catch {
    return null;
  }
  if (!d || typeof d !== "object") return null;
  const o = d as Record<string, unknown>;
  const comps = Array.isArray(o.components) ? o.components.filter((x): x is string => typeof x === "string").map((x) => x.toLowerCase()) : [];
  const ws = Array.isArray(o.weights) ? o.weights : [];
  const picked: string[] = [];
  const w: Record<string, number> = {};
  comps.forEach((id, i) => {
    if (!known.has(id) || picked.includes(id) || picked.length >= 20) return;
    picked.push(id);
    const x = Number(ws[i]);
    w[id] = Number.isFinite(x) ? Math.max(0, Math.min(100, Math.round(x))) : 0;
  });
  const ticker = typeof o.ticker === "string" ? cleanTicker(o.ticker) : undefined;
  return {
    name: str(o.name, 64),
    ticker: ticker || undefined,
    description: str(o.description, 280),
    picked,
    w,
    mode: typeof o.mode === "string" || typeof o.mode === "number" ? MODES[String(o.mode).toLowerCase()] : undefined,
    preset: typeof o.preset === "string" ? PRESETS[o.preset.toLowerCase()] : undefined,
  };
}

/** Integer percents summing to 100 from basis points (largest remainder, each ≥ 1). */
export function bpsToPercents(bps: number[]): number[] {
  const total = bps.reduce((s, x) => s + x, 0) || 1;
  const exact = bps.map((x) => (x / total) * 100);
  const out = exact.map((x) => Math.max(1, Math.floor(x)));
  let left = 100 - out.reduce((s, x) => s + x, 0);
  const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r);
  for (let k = 0; left > 0 && order.length; k = (k + 1) % order.length, left--) out[order[k]!.i]! += 1;
  for (let k = 0; left < 0; k = (k + 1) % out.length) {
    const j = out.indexOf(Math.max(...out));
    if (out[j]! > 1) {
      out[j]! -= 1;
      left++;
    }
  }
  return out;
}

/** Fork prefill from an index's execution addresses and target weights. */
export function forkPrefill(assets: string[], targetBps: number[], idByAddr: Map<string, string>): Prefill {
  const ids = assets.map((a) => idByAddr.get(a.toLowerCase()) ?? null);
  const keep = ids.map((id, i) => ({ id, bps: targetBps[i] ?? 0 })).filter((x): x is { id: string; bps: number } => x.id !== null);
  const pcts = bpsToPercents(keep.map((x) => x.bps));
  const w: Record<string, number> = {};
  keep.forEach((x, i) => (w[x.id] = pcts[i]!));
  return { picked: keep.map((x) => x.id), w };
}
