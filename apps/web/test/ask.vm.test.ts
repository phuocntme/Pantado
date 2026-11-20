import { describe, expect, it } from "vitest";
import { askHref, askVM, moveText, suggestions, type AskBoardRow } from "../src/screens/ask.vm";
import { logoFill } from "../src/lib/logos";

const me = { short: "", balanceS: "—", address: null };
const board: AskBoardRow[] = [
  { id: "nvda", kind: "stock", symbol: "NVDA", name: "NVIDIA", color: "#76B900", change24h: 0.031 },
  { id: "msft", kind: "stock", symbol: "MSFT", name: "Microsoft", color: "#00A4EF", change24h: -0.004 },
  { id: "wavax", kind: "token", symbol: "AVAX", name: "Avalanche", color: "#E84142", change24h: -0.052 },
  { id: "btcb", kind: "token", symbol: "BTC.b", name: "Bitcoin", color: "#F7931A", change24h: null },
  { id: "0xI1", kind: "index", symbol: "TBB", name: "Tech + BTC", stocksPct: 50, change24h: 0.01, volume24hUsd: 900 },
  { id: "0xI2", kind: "index", symbol: "ABC", name: "Blue Chips", stocksPct: 0, change24h: 0.02, volume24hUsd: 100 },
];

describe("ask suggestions", () => {
  it("Today: real index for the buy row and real 24h moves", () => {
    const rows = suggestions("Today", "Auto", board);
    expect(rows[0]).toMatchObject({ text: "Buy Tech + BTC for $50", buy: true, ask: false, weight: 600, _href: { IndexDetail: "/index/0xI1" } });
    expect(rows[1]).toMatchObject({ chip: true, sym: "AVAX", nm: "Avalanche", dot: "#E84142", text: "is down 5.2% today. What is moving it?" });
    expect(rows[1]?._href.AskChat).toBe(askHref("AVAX is down 5.2% today. What is moving it?", "Auto"));
    expect(rows[3]).toMatchObject({ sym: "NVDA", text: "is up 3.1% today. How volatile has it been over 90 days?" });
  });

  it("omits rows without data instead of inventing them", () => {
    const rows = suggestions("Today", "Deep", []);
    expect(rows.map((r) => r.text)).toEqual(["Which public index moved most over 30 days?", "Build a low-volatility basket of five assets."]);
    expect(rows[0]?._href.AskChat).toContain("mode=deep");
    expect(suggestions("Tokens", "Auto", board.filter((r) => r.kind !== "index")).some((r) => r.buy)).toBe(false);
  });

  it("Stocks and Tokens tabs pick matching indexes", () => {
    expect(suggestions("Stocks", "Auto", board)[0]?.text).toBe("Buy Tech + BTC for $50");
    expect(suggestions("Tokens", "Auto", board)[0]?.text).toBe("Buy Blue Chips for $50");
    expect(suggestions("Indexes", "Auto", board)[0]?.text).toBe("Buy Blue Chips for $50");
    expect(suggestions("Indexes", "Auto", board)[2]?.text).toBe("Compare Tech + BTC with holding AVAX.");
  });

  it("moveText", () => {
    expect(moveText(0.031)).toBe("is up 3.1% today");
    expect(moveText(-0.001)).toBe("is down 0.1% today");
  });
});

describe("askVM", () => {
  it("tabs, modes and the Send link like the reference", () => {
    let picked = "";
    const v = askVM({ tab: "Stocks", mode: "Deep", pickTab: (t) => (picked = t), pickMode: () => undefined, board, draft: "  hello world ", me });
    const tabs = v.tabs as { label: string; on: string; bg: string; pick: () => void }[];
    expect(tabs.map((t) => t.on)).toEqual(["false", "false", "true", "false"]);
    expect(tabs[2]?.bg).toBe("#F2F2F3");
    tabs[0]?.pick();
    expect(picked).toBe("Today");
    expect((v.modes as { label: string; on: string }[])[1]).toMatchObject({ label: "Deep", on: "true" });
    expect(v._href).toEqual({ AskChat: "/ask?q=hello%20world&mode=deep" });
    // NVDA has a logo: the chip avatar shows it instead of the initials
    expect((v.rows as { ini2?: string; avBg?: string }[])[1]).toMatchObject({ ini2: "", avBg: logoFill("nvda") });
    expect(askHref("   ", "Auto")).toBe("/ask");
  });

  it("the agent's questions of the day come after the buy row, chips for assets, topped up from the built-in rows", () => {
    const daily = {
      date: "2026-11-16",
      tabs: {
        Today: [
          { asset: "nvda", text: "is down 26.8% over 30 days. How volatile has it been?" },
          { asset: null, text: "Which token traded the most today?" },
          { asset: "zzz", text: "is not on the board" }, // dropped
        ],
      },
    };
    const rows = suggestions("Today", "Auto", board, daily);
    expect(rows[0]?.buy).toBe(true);
    expect(rows[1]).toMatchObject({ chip: true, sym: "NVDA", text: "is down 26.8% over 30 days. How volatile has it been?" });
    expect(rows[2]).toMatchObject({ chip: false, text: "Which token traded the most today?" });
    expect(rows).toHaveLength(5); // buy + 4: two of the day's, two built-in
    // a tab the agent left empty keeps its built-in rows
    expect(suggestions("Tokens", "Auto", board, daily)).toEqual(suggestions("Tokens", "Auto", board));
  });
});
