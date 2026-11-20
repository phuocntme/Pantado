import { describe, expect, it } from "vitest";
import { setField, sig4 } from "../refresh-seeds.js";

describe("refresh-seeds", () => {
  it("rounds to 4 significant digits without exponents", () => {
    expect(sig4(64789.3049)).toBe("64789");
    expect(sig4(7.2221069)).toBe("7.222");
    expect(sig4(0.022033905)).toBe("0.02203");
    expect(sig4(1107.4651)).toBe("1107");
    expect(sig4(25.5)).toBe("25.5");
    expect(sig4(74350)).toBe("74350");
  });

  it("edits only the field inside the named asset", () => {
    const text = `[\n  { "id": "a", "price": { "seedUsd": "1" } },\n  { "id": "b", "price": { "seedUsd": "2" } }\n]`;
    const out = setField(text, "b", "seedUsd", "3");
    expect(out).toContain(`"id": "a", "price": { "seedUsd": "1" }`);
    expect(out).toContain(`"id": "b", "price": { "seedUsd": "3" }`);
  });
});
