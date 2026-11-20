/** Number formatting matching the reference UI. */
export const UP = "#3DD68C";
export const DOWN = "#FF6B6B";

export function money(usd: number | null | undefined, digits?: number): string {
  if (usd === null || usd === undefined || !Number.isFinite(usd)) return "—";
  const d = digits ?? (Math.abs(usd) >= 1000 ? 0 : 2);
  const body = Math.abs(usd).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  return `${usd < 0 ? "-" : ""}$${body}`;
}

/** Decimals that show 4 significant digits of a price below 0.01 (e.g. 0.00000008348 → 11). */
export function smallDp(v: number): number {
  return v > 0 && v < 0.01 ? Math.min(20, 3 - Math.floor(Math.log10(v))) : 6;
}

const SUB = "₀₁₂₃₄₅₆₇₈₉";

/**
 * A price below 0.0001 with its run of leading zeros counted in a subscript, so it fits a price cell:
 * 0.00000008475 → "0.0₇8475" (`sig` significant digits). Larger values: null (use the normal format).
 */
export function tinyNum(v: number, sig = 4): string | null {
  if (!(v > 0) || v >= 1e-4) return null;
  const zeros = -Math.floor(Math.log10(v)) - 1;
  let digits = Math.round(v * 10 ** (zeros + sig));
  let z = zeros;
  if (digits >= 10 ** sig) {
    // rounding carried into one more digit (0.000099999 → 0.0001)
    digits = Math.round(digits / 10);
    z -= 1;
  }
  const d = String(digits).replace(/0+$/, "") || "0";
  return `0.0${[...String(z)].map((c) => SUB[Number(c)]).join("")}${d}`;
}

/** Whole-token amounts: grouped up to a million, then compact ("5.88B"). */
export function bigAmount(n: number, dp: number): string {
  const a = Math.abs(n);
  // the unit is chosen after rounding: 999,999,999,999 → "1.00T", never "1000.00B"
  const r2 = (x: number): number => Number(x.toFixed(2));
  if (r2(a / 1e12) >= 1000) return n.toExponential(2); // never a 30-digit row
  if (r2(a / 1e9) >= 1000) return `${(n / 1e12).toFixed(2)}T`;
  if (r2(a / 1e6) >= 1000) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6 || r2(a) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** USD in a trade card: cents below a million, then compact ("$6.21M", "$1.20T"). */
export function usdAmount(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return Math.abs(n) >= 1e6 ? `${n < 0 ? "-" : ""}$${bigAmount(Math.abs(n), 2)}` : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Largest whole-unit amount a trade input takes (12 digits: below a trillion). */
export const MAX_INT_DIGITS = 12;

/**
 * Whether `v` is an acceptable amount while typing: empty, or digits with at most one point, ≤ 12 whole digits and
 * no more decimals than the token has. Inputs ignore anything else, so a pasted 60-digit number never reaches the
 * quote or the layout.
 */
export function amountInputOk(v: string, decimals: number): boolean {
  if (v === "") return true;
  const m = /^(\d*)(?:\.(\d*))?$/.exec(v);
  if (!m) return false;
  return (m[1] ?? "").replace(/^0+(?=\d)/, "").length <= MAX_INT_DIGITS && (m[2] ?? "").length <= decimals;
}

/** "+2.1%" from a fraction (0.021). */
export function pct(f: number | null | undefined, digits = 1): string {
  if (f === null || f === undefined || !Number.isFinite(f)) return "—";
  const v = f * 100;
  return `${v >= 0 ? "+" : "-"}${Math.abs(v).toFixed(digits)}%`;
}

export const pctCol = (s: string): string => (s.charAt(0) === "-" ? DOWN : UP);

/** "$84.2M" / "$620K" like the reference volume column. */
export function vol(usd: number | null | undefined): string {
  if (!usd || !Number.isFinite(usd)) return "$0";
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(1)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(1)}M`;
  if (usd >= 1e3) return `$${Math.round(usd / 1e3)}K`;
  return `$${usd.toFixed(0)}`;
}

/** Whole-token amount from base units with `dp` decimals shown. */
export function units(raw: string | bigint, decimals: number, dp = 2): string {
  const n = Number(BigInt(raw)) / 10 ** decimals;
  return n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function ago(tsSec: number, now = Date.now() / 1000): string {
  const s = Math.max(0, Math.floor(now - tsSec));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Two-letter initials used by the reference avatars (`ini2`), same walk as the reference. */
export function withInitials<T>(v: T): T {
  const ini = (s: string): string => s.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase();
  const walk = (o: unknown, d: number): void => {
    if (d > 4 || !o || typeof o !== "object") return;
    if (Array.isArray(o)) {
      o.forEach((x) => walk(x, d + 1));
      return;
    }
    const r = o as Record<string, unknown>;
    const k = r.sym ?? r.t ?? r.name;
    if (typeof k === "string" && r.ini2 === undefined) r.ini2 = ini(k);
    for (const x of Object.values(r)) if (x && typeof x === "object") walk(x, d + 1);
  };
  walk(v, 0);
  return v;
}
