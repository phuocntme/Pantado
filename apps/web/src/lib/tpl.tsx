"use client";
/**
 * Runtime for screens generated from reference/pantado-app.html (scripts/port-reference.ts).
 * Same semantics as the reference template engine: `{{ path }}` lookups through a scope chain,
 * `sc-for` child scopes with `$index`, `sc-if` truthiness, inline style strings.
 */
import type { CSSProperties } from "react";

export type Scope = Record<string, unknown>;

export function lookup(path: string, scope: Scope): unknown {
  if (path === "true") return true;
  if (path === "false") return false;
  let v: unknown = scope;
  for (const k of path.split(".")) {
    if (v === null || v === undefined) return undefined;
    v = (v as Record<string, unknown>)[k];
  }
  return v;
}

const HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;

/** Interpolate `{{ … }}` holes (null/undefined → ""). */
export function interp(s: string, scope: Scope): string {
  return s.replace(HOLE, (_m, p: string) => {
    // `{{a|b|#hex}}`: the first path with a value, else a literal color (avatar fills, port-reference.ts)
    for (const alt of p.split("|")) {
      const k = alt.trim();
      if (k.startsWith("#")) return k;
      const v = lookup(k, scope);
      if (v !== null && v !== undefined && v !== "") return String(v);
    }
    return "";
  });
}

/** Text value of a whole-hole expression. */
export const T = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

export const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Child scope for `sc-for` (prototype chain like the reference). */
export function child(parent: Scope, as: string, item: unknown, index: number): Scope {
  const s = Object.create(parent) as Scope;
  s[as] = item;
  s.$index = index;
  return s;
}

export type Handler = (e: { target: { value: string; checked?: boolean } }) => void;
export const H = (v: unknown): (() => void) | undefined => (typeof v === "function" ? (v as () => void) : undefined);
export const HI =
  (v: unknown) =>
  (e: { target: { value: string; checked?: boolean } }): void => {
    if (typeof v === "function") (v as Handler)(e);
  };

const cache = new Map<string, CSSProperties>();
const camel = (p: string): string => (p.startsWith("--") ? p : p.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase()));

/** Inline CSS string → React style object (memoized). */
export function css(s: string): CSSProperties {
  const hit = cache.get(s);
  if (hit) return hit;
  const out: Record<string, string> = {};
  for (const decl of s.split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const k = decl.slice(0, i).trim();
    const v = decl.slice(i + 1).trim();
    if (k) out[camel(k)] = v;
  }
  if (cache.size > 20_000) cache.clear();
  cache.set(s, out as CSSProperties);
  return out as CSSProperties;
}

/** Boolean-ish attribute: "false", "", null and undefined are off. */
export const bool = (v: unknown): boolean => !(v === false || v === "false" || v === "" || v === null || v === undefined || v === 0);

/** Reference link targets (`Name.dc.html`). Pages may override per scope via `_href.Name`. */
export type LinkTarget =
  | "Main"
  | "AskChat"
  | "Marketplace"
  | "IndexDetail"
  | "Asset"
  | "Create"
  | "Portfolio"
  | "Creator"
  | "Connect"
  | "Review"
  | "Redeem"
  | "Version"
  | "Swap"
  | "IndexPrivate"
  | "States";

/** Attribute value: null/undefined → omitted, everything else as a string (like setAttribute). */
export const A = (v: unknown): string | undefined => (v === null || v === undefined ? undefined : String(v));

/** Dynamic attributes as a plain record (values computed at render, like the reference engine). */
export const P = (o: Record<string, string | undefined>): Record<string, string | undefined> => o;
