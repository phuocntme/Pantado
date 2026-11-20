import { describe, expect, it } from "vitest";
import { loadAssets } from "@pantado/shared";
import { fakeApi } from "../src/api-client.js";
import { ScriptedProvider } from "../src/llm.js";
import { buildAgentServer, memorySessions } from "../src/server.js";
import { dailySuggestions, snapshotOf, validate } from "../src/suggestions.js";

const assets = loadAssets();
const board = [
  { id: "coq", kind: "token" as const, symbol: "COQ", name: "COQINU", change24h: -0.052, change7d: -0.182, change30d: 0.1, volume24hUsd: 13_211 },
  { id: "nvda", kind: "stock" as const, symbol: "NVDA", name: "NVIDIA", change24h: -0.024, change7d: 0.01, change30d: -0.268, volume24hUsd: 9_000_000 },
  { id: "0xi", kind: "index" as const, symbol: "CSTK", name: "Crypto Stocks + BTC", change24h: null, change7d: null, change30d: 0.012, level: 100.01, stocksPct: 75, volume24hUsd: 100 },
];
const snap = snapshotOf(board);

describe("daily Ask-home suggestions", () => {
  it("keeps on-topic suggestions whose figures come from the snapshot; drops invented numbers, wrong tabs and unlisted assets", () => {
    const out = validate(
      {
        Today: [
          { asset: "coq", text: "fell 18.2% this week. How volatile has it been over 90 days?" },
          { asset: null, text: "Which stock fell 40% today?" }, // 40 is not in the snapshot
        ],
        Stocks: [
          { asset: "nvda", text: "is down 26.8% over 30 days. Compare it with AMD." },
          { asset: "coq", text: "is a token, not a stock" }, // wrong tab
        ],
        Tokens: [{ asset: "doge", text: "is not listed here at all" }],
        Indexes: [{ asset: null, text: "What is in CSTK (75% stocks), and how has it moved over 30 days?" }],
      },
      snap,
      assets,
    );
    expect(out.Today).toEqual([{ asset: "coq", text: "fell 18.2% this week. How volatile has it been over 90 days?" }]);
    expect(out.Stocks.map((s) => s.asset)).toEqual(["nvda"]);
    expect(out.Tokens).toEqual([]);
    expect(out.Indexes).toHaveLength(1);
    expect(validate("not json", snap, assets).Today).toEqual([]);
  });

  it("one set per UTC day: cached all day, rewritten the next day", async () => {
    let day = new Date("2026-11-16T08:00:00Z");
    const reply = (t: string) => ({ stop: "end" as const, content: [{ type: "text" as const, text: JSON.stringify({ Today: [{ asset: null, text: t }] }) }] });
    const llm = new ScriptedProvider([reply("Which token moved most today, and by how much?"), reply("What moved most on the second day?")]);
    const get = dailySuggestions({ api: fakeApi({ "/board": board }), llm, model: "fast", assets, now: () => day });
    const [a, b] = await Promise.all([get(), get()]);
    expect(a).toBe(b);
    expect(llm.requests).toHaveLength(1);
    expect(llm.requests[0]?.model).toBe("fast");
    expect(JSON.stringify(llm.requests[0]?.turns)).toContain("COQ");
    day = new Date("2026-11-16T23:59:00Z");
    expect((await get()).tabs.Today[0]?.text).toBe("Which token moved most today, and by how much?");
    day = new Date("2026-11-17T00:01:00Z");
    expect((await get()).date).toBe("2026-11-17");
    expect(llm.requests).toHaveLength(2);
  });

  it("GET /suggestions serves the day's set", async () => {
    const llm = new ScriptedProvider([{ stop: "end", content: [{ type: "text", text: '{"Tokens":[{"asset":"coq","text":"fell 18.2% this week. What is its 30-day range?"}]}' }] }]);
    const app = buildAgentServer({
      llm,
      api: fakeApi({ "/board": board }),
      assets,
      limits: { minAssets: 2, maxAssets: 20, minWeightPct: 1, driftMinPct: 10, driftMaxPct: 200 },
      harness: { autoModel: "fast", deepModel: "deep", autoMaxSteps: 4, deepMaxSteps: 12 },
      sessions: memorySessions(),
      tradeFeeBps: 50,
    });
    const r = await app.inject({ method: "GET", url: "/suggestions" });
    expect(r.json()).toMatchObject({ tabs: { Tokens: [{ asset: "coq" }] } });
    await app.close();
  });
});
