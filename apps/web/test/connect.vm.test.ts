import { describe, expect, it } from "vitest";
import { connectVM } from "../src/screens/connect.vm";

describe("connectVM", () => {
  it("renders the live Ask home behind the dialog", () => {
    const me = { short: "", balanceS: "—", address: null };
    const v = connectVM({ tab: "Today", mode: "Auto", pickTab: () => undefined, pickMode: () => undefined, board: [], draft: "", me });
    expect(v.me).toBe(me);
    expect((v.tabs as unknown[]).length).toBe(4);
    expect((v.rows as { buy: boolean }[]).every((r) => !r.buy)).toBe(true);
  });
});
