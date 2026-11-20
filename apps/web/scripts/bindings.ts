/**
 * Per-screen bindings applied by port-reference.ts before code generation:
 *  - `text`: literal mock text in the reference → view-model path. Replaced in text nodes and attribute
 *    values as a `{{ path }}` hole (whole-word match, longest literal first).
 *  - `slots`: subtrees replaced by a live component slot (charts drawn as static shapes in the reference).
 *    A node matches when every given attribute equals the given value (or, for keys ending in "~", contains it).
 * Layout, copy, type scale and colors stay exactly as in the reference.
 */
export interface SlotMatch {
  tag?: string;
  attrs: Record<string, string>;
  /** the node's only child is this text (tells apart siblings with the same attributes, e.g. table headers) */
  text?: string;
  /** a direct child element's only text is this (a row known by its label, e.g. `<dt>Route</dt>`) */
  childText?: string;
  name: string;
}
export interface Binding {
  text?: Record<string, string>;
  slots?: SlotMatch[];
}

import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** One file per screen: scripts/bindings/<route>.ts exporting `binding`. */
export async function loadBindings(): Promise<Record<string, Binding>> {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "bindings");
  const out: Record<string, Binding> = {};
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
    const mod = (await import(join(dir, f))) as { binding: Binding };
    out[f.replace(/\.ts$/, "")] = mod.binding;
  }
  const common = out._common ?? {};
  delete out._common;
  const merged: Record<string, Binding> = {};
  for (const route of new Set([...Object.keys(out), "ask", "chat", "marketplace", "index", "asset", "create", "portfolio", "creator", "connect", "review", "redeem", "version", "swap", "private", "states"])) {
    const b = out[route] ?? {};
    merged[route] = { text: { ...common.text, ...b.text }, slots: [...(common.slots ?? []), ...(b.slots ?? [])] };
  }
  return merged;
}
