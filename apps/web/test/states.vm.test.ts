import { describe, expect, it } from "vitest";
import { statesVM } from "../src/screens/states.vm";

describe("statesVM", () => {
  it("only carries the account chrome", () => {
    const me = { short: "0x2c71…ab90", balanceS: "$1,620", address: "0x2c71" };
    expect(statesVM(me)).toEqual({ me });
  });
});
