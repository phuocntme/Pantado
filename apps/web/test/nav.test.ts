import { describe, expect, it } from "vitest";
import { nav } from "../src/lib/nav";
import { child } from "../src/lib/tpl";

describe("nav", () => {
  it("uses _href on a loop item, then the top-level scope, then the default route", () => {
    const v = { _href: { Portfolio: "/portfolio?x=1" }, rows: [] };
    const s = child(v, "p", { _href: { Redeem: "/redeem/0xabc" } }, 0);
    expect(nav("Redeem", s)).toBe("/redeem/0xabc");
    expect(nav("Portfolio", s)).toBe("/portfolio?x=1");
    expect(nav("Swap", s)).toBe("/swap");
  });
});
