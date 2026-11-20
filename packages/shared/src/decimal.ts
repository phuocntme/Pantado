/** Exact decimal-string ↔ fixed-point conversion (no floating point). */

const DECIMAL_RE = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/;

/** "164.6" with 18 decimals → 164600000000000000000n. Throws if precision would be lost. */
export function parseUnitsExact(value: string, decimals: number): bigint {
  const m = DECIMAL_RE.exec(value);
  if (!m) throw new RangeError(`not a decimal string: ${value}`);
  const whole = m[1] ?? "0";
  const frac = (m[2] ?? "").replace(/0+$/, "");
  if (frac.length > decimals)
    throw new RangeError(`${value} has more than ${decimals} decimals`);
  return BigInt(whole + frac.padEnd(decimals, "0"));
}

/** 164600000000000000000n with 18 decimals → "164.6". */
export function formatUnitsExact(value: bigint, decimals: number): string {
  const neg = value < 0n;
  const s = (neg ? -value : value).toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

export const E18 = 10n ** 18n;
export const toE18 = (value: string): bigint => parseUnitsExact(value, 18);

/**
 * A positive number as a plain decimal string with `sig` significant digits (no exponent, no trailing zeros):
 * 8.348e-8 → "0.00000008348". Prices of micro-priced tokens keep their precision.
 */
export function decimalString(v: number, sig = 12): string {
  if (!Number.isFinite(v) || v === 0) return "0";
  const digits = Math.min(100, Math.max(0, sig - 1 - Math.floor(Math.log10(Math.abs(v)))));
  const s = v.toFixed(digits);
  const t = s.includes(".") ? s.replace(/\.?0+$/, "") : s;
  return t === "-0" ? "0" : t;
}
