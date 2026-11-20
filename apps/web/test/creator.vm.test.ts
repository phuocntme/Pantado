import { describe, expect, it } from "vitest";
import { creatorVM, monthYear, xText, type CreatorInputs } from "../src/screens/creator.vm";

const me = { short: "0x2c71…ab90", balanceS: "$0", address: null };
const W = "0x2C7100000000000000000000000000000000Ab90";
const ix = (id: string, name: string, createdAt: string, isPublic = true) => ({
  id,
  ticker: "T",
  name,
  creator: W,
  isPublic,
  mode: 2,
  driftBps: 5000,
  supply: "0",
  level: "121400000000000000000",
  createdAt,
});
const base = (o: Partial<CreatorInputs> = {}): CreatorInputs => ({
  creator: { handle: W, wallet: W, x: null, indexes: [ix("0xA", "Blue Chips", "1785542400"), ix("0xB", "Crypto Beta", "1788220800"), ix("0xC", "Hidden", "1788220800", false)] },
  address: W,
  board: [
    { id: "0xa", kind: "index", stocksPct: 0, change30d: 0.067 },
    { id: "0xb", kind: "index", stocksPct: 35, change30d: -0.02 },
  ],
  holders: { "0xa": 150, "0xb": 200 },
  copied: false,
  copy: () => undefined,
  me,
  ...o,
});

describe("creatorVM", () => {
  it("lists public indexes with level, mix, 30d, holders and created month", () => {
    const v = creatorVM(base());
    const list = v.list as Record<string, unknown>[];
    expect(list.map((r) => r.name)).toEqual(["Crypto Beta", "Blue Chips"]);
    expect(list[1]).toMatchObject({ level: "121.40", stocks: 0, mixLabel: "0 percent stocks, 100 percent tokens", m: "+6.7%", mCol: "#3DD68C", holders: "150", created: "Aug 2026" });
    expect(list[0]).toMatchObject({ stocks: 35, m: "-2.0%", mCol: "#FF6B6B", holders: "200+", created: "Sep 2026" });
    expect(list[0]?._href).toEqual({ IndexDetail: "/index/0xB" });
    expect(v.countLabel).toBe("Indexes · 2");
  });

  it("handle = wallet until profiles exist; X link only when known", () => {
    const v = creatorVM(base());
    expect(v).toMatchObject({ handle: "0x2C71…Ab90", walletShort: "0x2C71…Ab90", avatar: "2C", x: null, copyLabel: "Copy" });
    const withX = creatorVM(base({ copied: true, creator: { handle: W, wallet: W, x: "@pantado", indexes: [] } }));
    expect(withX.x).toEqual({ href: "https://x.com/pantado", label: "x.com/pantado" });
    expect(withX.copyLabel).toBe("Copied");
    expect(withX.countLabel).toBe("Indexes · 0");
  });

  it("not connected / not loaded shows —", () => {
    const v = creatorVM(base({ creator: null, address: null }));
    expect(v).toMatchObject({ handle: "—", walletShort: "—", list: [] });
  });

  it("helpers", () => {
    expect(monthYear("0")).toBe("—");
    expect(xText("https://twitter.com/abc/")).toEqual({ href: "https://x.com/abc", label: "x.com/abc" });
  });
});
