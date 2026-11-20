import type { AskReport } from "../src/harness.js";
import type { Card } from "../src/tools.js";
import { FORBIDDEN, type EvalCase } from "./cases.js";

export interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** USD for one answer's tokens at per-million rates. */
export function costOf(r: AskReport, p: Price | undefined): number | null {
  if (!p) return null;
  const u = r.usage;
  return (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) / 1e6;
}

const VI = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;

/** Why a case failed (empty = pass). */
export function score(c: EvalCase, r: AskReport, cards: Card[]): string[] {
  const fails: string[] = [];
  const called = new Set(r.tools);
  for (const t of c.must ?? []) if (!called.has(t)) fails.push(`missing tool ${t}`);
  if (c.anyOf && !c.anyOf.some((t) => called.has(t))) fails.push(`none of ${c.anyOf.join("/")}`);
  for (const t of c.mustNot ?? []) if (called.has(t)) fails.push(`called ${t}`);
  const kinds = new Set(cards.map((k) => k.kind));
  for (const k of c.cards ?? []) if (!kinds.has(k)) fails.push(`no ${k} card`);
  for (const re of c.expect ?? []) if (!re.test(r.answer)) fails.push(`text lacks ${re}`);
  for (const re of FORBIDDEN) if (re.test(r.answer)) fails.push(`forbidden ${re}`);
  if (c.vi && !VI.test(r.answer)) fails.push("not in Vietnamese");
  if (r.numbers.unverified.length) fails.push(`unverified numbers ${r.numbers.unverified.join(", ")}`);
  if (r.stoppedAtLimit) fails.push("step limit");
  if (!r.answer.trim()) fails.push("empty answer");
  return fails;
}

export const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length ? (s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2) : 0;
};
