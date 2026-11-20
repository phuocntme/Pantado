import { describe, expect, it } from "vitest";
import { assetColor, AVALANCHE_RED, formatUnitsExact, parseUnitsExact, toE18, decimalString } from "../src/index.js";

describe("decimal", () => {
  it("parses exactly", () => {
    expect(toE18("164.6")).toBe(164_600_000_000_000_000_000n);
    expect(toE18("0.01")).toBe(10n ** 16n);
    expect(parseUnitsExact("1.50", 6)).toBe(1_500_000n);
    expect(parseUnitsExact("74357", 8)).toBe(7_435_700_000_000n);
  });
  it("rejects precision loss and junk", () => {
    expect(() => parseUnitsExact("1.1234567", 6)).toThrow(RangeError);
    expect(() => parseUnitsExact("-1", 6)).toThrow(RangeError);
    expect(() => parseUnitsExact("1e5", 6)).toThrow(RangeError);
  });
  it("round-trips", () => {
    for (const v of ["0", "1", "0.000001", "14871.4", "5000000"])
      expect(formatUnitsExact(parseUnitsExact(v, 18), 18)).toBe(v);
  });
});

describe("assetColor", () => {
  it("reserves Avalanche red for AVAX", () => {
    expect(assetColor("wavax")).toBe(AVALANCHE_RED);
    for (const id of ["nvda", "btcb", "joe", "tsla", "mu"]) expect(assetColor(id)).not.toBe(AVALANCHE_RED);
  });
  it("is deterministic", () => expect(assetColor("nvda")).toBe(assetColor("nvda")));
});

describe("decimalString", () => {
  it("keeps significant digits of tiny and large prices without an exponent", () => {
    expect(decimalString(8.348e-8)).toBe("0.00000008348");
    expect(decimalString(1 / 3, 4)).toBe("0.3333");
    expect(decimalString(64858.123456789, 6)).toBe("64858.1");
    expect(decimalString(7.246)).toBe("7.246");
    expect(decimalString(0)).toBe("0");
    expect(parseUnitsExact(decimalString(2.206e-6), 18)).toBe(2_206_000_000_000n);
  });
});
