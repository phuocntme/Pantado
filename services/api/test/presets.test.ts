import { describe, expect, it } from "vitest";
import { equalWeights, largestRemainder, lowVolWeights, marketCapWeights, PresetError } from "../src/presets.js";
import { fifo } from "../src/pnl.js";

const sum = (a: number[]): number => a.reduce((x, y) => x + y, 0);

describe("presets", () => {
  it("equal: sums to 100, largest remainder", () => {
    expect(equalWeights(3)).toEqual([34, 33, 33]);
    expect(equalWeights(7)).toEqual([15, 15, 14, 14, 14, 14, 14]);
    expect(sum(equalWeights(20))).toBe(100);
  });
  it("every weight ≥ 1", () => {
    const w = largestRemainder([1000, 1, 0.0001]);
    expect(sum(w)).toBe(100);
    expect(Math.min(...w)).toBeGreaterThanOrEqual(1);
  });
  it("market cap: 40 % cap with excess redistributed", () => {
    const w = marketCapWeights([4000, 1000, 500, 500]);
    expect(sum(w)).toBe(100);
    expect(w[0]).toBe(40);
    expect(w[1]).toBe(30); // 1000/2000 of the remaining 60
  });
  it("market cap: cap rises to 100/n when n × 40 < 100", () => {
    expect(marketCapWeights([10, 1])).toEqual([50, 50]);
  });
  it("market cap: missing cap is an error", () => {
    expect(() => marketCapWeights([1, 0])).toThrow(PresetError);
  });
  it("low vol: ∝ 1/σ", () => {
    const calm = Array.from({ length: 91 }, (_, i) => 100 * (1 + 0.001 * Math.sin(i)));
    const wild = Array.from({ length: 91 }, (_, i) => 100 * (1 + 0.004 * Math.sin(i)));
    const w = lowVolWeights([calm, wild]);
    expect(w).toEqual([80, 20]);
    expect(() => lowVolWeights([[1], [2, 3]])).toThrow(PresetError);
  });
});

describe("fifo", () => {
  it("consumes oldest lots first", () => {
    const p = fifo(
      [
        { units: 10n, costUsdc: 1000n, ts: 1 },
        { units: 10n, costUsdc: 2000n, ts: 2 },
      ],
      [{ units: 15n, ts: 3 }],
      5n,
    );
    expect(p).toEqual({ units: 5n, costUsdc: 1000n, realizedCostUsdc: 2000n, unknownBasisUnits: 0n });
  });
  it("flags units without a lot", () => {
    expect(fifo([], [], 7n).unknownBasisUnits).toBe(7n);
  });
});
