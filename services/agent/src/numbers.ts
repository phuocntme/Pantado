/**
 * Answer check: every figure in the model's text should come from a tool result of the same turn (or the user's
 * question). Lenient by design — rounding, % ↔ fraction, k/M/B suffixes, dates and small counts pass — so it
 * flags invented numbers without rejecting honest ones. Used for logs/metrics live and as a hard check in evals.
 */

/** Numbers a text states, with k/M/B/T applied ("$1.2B" → 1.2e9). Dates (2025-01-31) and times are skipped. */
export function numbersIn(text: string): number[] {
  const clean = text
    .replace(/\b\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+Z?)?\b/g, " ") // ISO dates / times
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, " ") // clock times
    .replace(/\b0x[0-9a-fA-F]+\b/g, " "); // addresses, hashes
  const out: number[] = [];
  const re = /(?<![\w.])[-−]?\d[\d,]*(?:\.\d+)?(?:\s?([kKmMbBtT])(?![a-zA-Z]))?/g;
  for (const m of clean.matchAll(re)) {
    const raw = m[0].replace(/[−]/g, "-").replace(/\s?[kKmMbBtT]$/, "").replace(/,/g, "");
    let v = Number(raw);
    if (!Number.isFinite(v)) continue;
    const suf = m[1]?.toLowerCase();
    if (suf === "k") v *= 1e3;
    else if (suf === "m") v *= 1e6;
    else if (suf === "b") v *= 1e9;
    else if (suf === "t") v *= 1e12;
    out.push(v);
  }
  return out;
}

/** Every number anywhere in a JSON value (numbers and numeric strings, e.g. wei amounts and "+3.1%"). */
export function numbersOf(value: unknown, out: number[] = []): number[] {
  if (typeof value === "number") out.push(value);
  else if (typeof value === "string") out.push(...numbersIn(value));
  else if (Array.isArray(value)) for (const v of value) numbersOf(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) numbersOf(v, out);
  return out;
}

/** Same figure up to display rounding: relative 0.6 %, or equal at the stated number's own precision. */
function close(stated: number, known: number): boolean {
  const a = Math.abs(stated);
  const b = Math.abs(known);
  if (a === b) return true;
  if (b > 0 && Math.abs(a - b) / b <= 0.006) return true;
  // "12" for 12.4, "0.07" for 0.0712: equal once the known value is rounded like the stated one
  const s = String(a);
  const dp = s.includes(".") ? (s.split(".")[1] as string).length : 0;
  return Number(b.toFixed(dp)) === a || Math.round(b) === a;
}

export interface NumberCheck {
  stated: number;
  unverified: number[];
}

/**
 * Figures in `answer` not backed by `known` (tool results, the question). Small whole counts (≤ 31: "3 assets",
 * "30 days") and calendar years are ignored. Fractions in tool data also match as percents (0.067 ↔ 6.7 %).
 */
export function checkNumbers(answer: string, known: unknown[]): NumberCheck {
  const pool: number[] = [];
  for (const k of known) for (const n of numbersOf(k)) pool.push(n, n * 100, n / 100, n / 1e18, n / 1e6);
  const stated = numbersIn(answer);
  const unverified = stated.filter((n) => {
    const a = Math.abs(n);
    if (Number.isInteger(a) && a <= 31) return false;
    if (Number.isInteger(a) && a >= 1900 && a <= 2100) return false;
    return !pool.some((k) => close(n, k));
  });
  return { stated: stated.length, unverified: [...new Set(unverified)] };
}
