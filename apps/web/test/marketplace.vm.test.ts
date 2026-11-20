import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { marketplaceVM, type BoardRow } from "../src/screens/marketplace.vm";

const me = { short: "", balanceS: "—", address: null };
const rows: BoardRow[] = [
  { id: "nvda", kind: "stock", symbol: "NVDA", name: "NVIDIA", change24h: 0.01, change7d: null, change30d: null, volume24hUsd: 1_250_000 },
  { id: "wavax", kind: "token", symbol: "AVAX", name: "Wrapped AVAX", change24h: -0.02, change7d: null, change30d: null, volume24hUsd: 9_800_000 },
  { id: "joe", kind: "token", symbol: "JOE", name: "JOE", change24h: 0, change7d: null, change30d: null, volume24hUsd: null },
  { id: "0xidx", kind: "index", symbol: "CSTK", name: "Crypto Stocks", level: 101, change24h: null, change7d: null, change30d: 0.02, volume24hUsd: 100 },
];
type Row = { name: string; volS: string; rank: number };

describe("marketplaceVM volume", () => {
  it("market volume for assets, app volume for indexes, unknown as — (never $0), sorted by volume", () => {
    const v = marketplaceVM(rows, "All", () => undefined, me, { marketUsd: 30_000_000, indexesUsd: 100 });
    const r = v.rows as Row[];
    expect(r.map((x) => [x.name, x.volS])).toEqual([
      ["AVAX", "$9.8M"],
      ["NVDA", "$1.3M"],
      ["Crypto Stocks", "$100"],
      ["JOE", "—"],
    ]);
    // the tile counts each market swap once (not the sum of rows) plus the app's index volume
    expect(v.totalVolS).toBe("$30.0M");
  });
  it("tile is — until the market volume is known", () => {
    expect(marketplaceVM(rows, "All", () => undefined, me, { marketUsd: null, indexesUsd: 100 }).totalVolS).toBe("—");
    expect(marketplaceVM(rows, "All", () => undefined, me).totalVolS).toBe("—");
  });
  it("no per-row data-source chip (the DATA column is not shown)", () => {
    const r = marketplaceVM(rows, "All", () => undefined, me).rows as Record<string, unknown>[];
    for (const x of r) expect(x).not.toHaveProperty("src");
    const gen = readFileSync(join(import.meta.dirname, "..", "src/screens/gen/Marketplace.gen.tsx"), "utf8");
    expect(gen).not.toContain('{"Data"}');
    expect(gen).not.toContain("r.srcDot");
  });
});
