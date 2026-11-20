import { describe, expect, it } from "vitest";
import { amountText, driftCell, modeText, portfolioVM, signedMoney, type PortfolioInputs, type PortfolioResp } from "../src/screens/portfolio.vm";
import { logoFill } from "../src/lib/logos";

const E18 = 10n ** 18n;
const me = { short: "0xabcd…1234", balanceS: "$0", address: "0xabcd000000000000000000000000000000001234" };
const ix = (id: string, name: string, ticker: string, isPublic: boolean, mode: number, driftBps = 5000) => ({
  id,
  ticker,
  name,
  creator: me.address,
  isPublic,
  mode,
  driftBps,
  supply: String(100n * E18),
  level: String(110n * E18),
  createdAt: "1786000000",
});

const pf: PortfolioResp = {
  address: me.address,
  positions: [
    { index: ix("0xA", "Tech Mix", "TMX", true, 2), units: String(10n * E18), valueUsdWad: String(1100n * E18), costUsdc: "1000000000", pnlUsdWad: String(100n * E18), unknownCostBasis: false, maxDriftBps: "180" },
    { index: ix("0xB", "Old Basket", "OLD", true, 1), units: String(2n * E18), valueUsdWad: String(200n * E18), costUsdc: "0", pnlUsdWad: null, unknownCostBasis: true, maxDriftBps: "640" },
  ],
  yourIndexes: [ix("0xA", "Tech Mix", "TMX", true, 2), ix("0xC", "My basket", "MYBK", false, 1)],
  wallet: [
    { id: "usdc", symbol: "USDC", color: "#2775CA", amount: "600000000", decimals: 6, valueUsd: 600, shareBps: 6000 },
    { id: "wavax", symbol: "AVAX", color: "#E84142", amount: String(40n * E18), decimals: 18, valueUsd: 400, shareBps: 4000 },
  ],
  walletTotalUsd: 1000,
  creatorEarnings: { claimableUsdc: "142100000" },
};

const base = (o: Partial<PortfolioInputs> = {}): PortfolioInputs => ({
  connected: true,
  loading: false,
  pf,
  assets: [
    { id: "usdc", kind: "quote", name: "USD Coin", price: { usd: 1 } },
    { id: "wavax", kind: "token", name: "Avalanche", price: { usd: 10 } },
  ],
  board: [{ id: "wavax", change24h: 0.25 }],
  planStatus: { "0xa": 0, "0xb": 1 },
  holders: { "0xa": 12 },
  composition: {
    "0xa": { supply: String(100n * E18), legs: [{ kind: "stock", valueUsdWad: String(5500n * E18) }, { kind: "token", valueUsdWad: String(5500n * E18) }] },
    "0xb": { supply: String(100n * E18), legs: [{ kind: "token", valueUsdWad: String(10000n * E18) }] },
  },
  claiming: false,
  claim: () => undefined,
  me,
  ...o,
});

describe("portfolioVM", () => {
  it("builds totals, earnings and the claim label from the API", () => {
    const v = portfolioVM(base());
    expect(v.totalS).toBe("$2,300.00");
    expect(v.earnS).toBe("$142.10");
    expect(v.claimLabel).toBe("Claim 142.10 USDC");
    expect(v.canClaim).toBe(true);
    expect(v.pnl30S).toBe("—");
    expect(v.me).toBe(me);
  });

  it("positions: value, PnL, unknown cost basis flagged, drift pill and links", () => {
    const v = portfolioVM(base());
    const pos = v.pos as Record<string, unknown>[];
    expect(pos[0]).toMatchObject({ name: "Tech Mix", units: "10 TMX", value: "$1,100.00", pnl: "+$100.00", pnlCol: "#3DD68C", drift: "1.8% drift", needs: false });
    expect(pos[0]?._href).toEqual({ IndexDetail: "/index/0xA", Redeem: "/redeem/0xA" });
    expect(pos[1]).toMatchObject({ pnl: "Cost basis unknown", pnlUnknown: true, pnlCol: "#8E8E96", drift: "6.4% drift · rebalance scheduled", needs: true, pillFg: "#F5B14C" });
  });

  it("your indexes: public and private, mode, holders, New version only for Manual", () => {
    const mine = portfolioVM(base()).mine as Record<string, unknown>[];
    expect(mine[0]).toMatchObject({ status: "Public", mode: "Auto · 50% drift", holders: "12", earned: "—", manual: false, href: "IndexDetail.dc.html", units: "You hold 10 TMX" });
    expect(mine[1]).toMatchObject({ status: "Private", holders: "Only you", manual: true, href: "IndexPrivate.dc.html", units: "You hold 0 MYBK", pillBg: "#221637" });
    expect(mine[1]?._href).toEqual({ IndexDetail: "/index/0xC", IndexPrivate: "/index/0xC", Version: "/version/0xC" });
  });

  it("wallet: index tokens count with the assets held directly; donut and table follow the reference math", () => {
    const v = portfolioVM(base({ board: [{ id: "wavax", change24h: 0.25 }, { id: "0xa", change24h: 0.1 }, { id: "0xb", change24h: 0 }] }));
    const a = v.assets as Record<string, string>[];
    // 2,300 in all: TMX 1,100 · OLD 200 · USDC 600 · AVAX 400
    expect(a.map((r) => r.sym)).toEqual(["TMX", "OLD", "USDC", "AVAX"]);
    expect(a[0]).toMatchObject({ kind: "Index", amt: "10", value: "$1,100.00", d: "+10.0%", dot: "#9052F9", pct: "47.8%", dash: "47.83 52.17", off: "0.00" });
    expect(a[1]).toMatchObject({ kind: "Index", value: "$200.00", d: "0.0%", dCol: "#8E8E96", pct: "8.7%", off: "52.17" });
    expect(a[2]).toMatchObject({ sym: "USDC", kind: "Cash", amt: "600.00", value: "$600.00", d: "0.0%", dCol: "#8E8E96", pct: "26.1%", ini2: "", avBg: logoFill("usdc") });
    expect(a[3]).toMatchObject({ sym: "AVAX", kind: "Token", amt: "40", d: "+25.0%", pct: "17.4%" });
    expect(v.walletTotal).toBe("$2,300.00"); // = the account total
    expect(v.walletTotal).toBe(v.totalS);
    expect(v.walletDay).toBe("+$180.00"); // 400 × 0.25 / 1.25 + 1,100 × 0.1 / 1.1
    expect(v.walletDayCol).toBe("#3DD68C");
    expect(v.walletSub).toBe("Everything this wallet holds, index tokens included");
    expect(v.split).toEqual([
      { label: "Indexes", col: "#9052F9", pct: "56.5%" },
      { label: "Stocks", col: "#76B900", pct: "0.0%" },
      { label: "Tokens", col: "#E84142", pct: "17.4%" },
      { label: "Cash", col: "#2775CA", pct: "26.1%" },
    ]);
    // a loss reads red
    const down = portfolioVM(base({ board: [{ id: "wavax", change24h: -0.2 }, { id: "0xa", change24h: 0 }, { id: "0xb", change24h: 0 }] }));
    expect(down.walletDay).toBe("-$100.00");
    expect(down.walletDayCol).toBe("#FF6B6B");
  });

  it("allocation looks through index legs", () => {
    const al = portfolioVM(base()).alloc as Record<string, unknown>;
    // stocks 550, tokens 400 + 550 + 200 = 1150, usdc 600 → 2300
    expect(al).toMatchObject({ known: true, stocksL: "Stocks 24%", tokensL: "Tokens 50%", usdcL: "USDC 26%" });
  });

  it("unknown data renders —", () => {
    const v = portfolioVM(base({ board: [], composition: {}, holders: {}, assets: [{ id: "usdc", kind: "quote", name: "USD Coin", price: { usd: 1 } }, { id: "wavax", kind: "token", name: "Avalanche", price: null }] }));
    expect(v.walletDay).toBe("—");
    expect((v.assets as Record<string, string>[]).find((r) => r.sym === "AVAX")?.value).toBe("—");
    expect((v.alloc as Record<string, unknown>).stocksL).toBe("Stocks —");
    expect((v.mine as Record<string, string>[])[0]?.holders).toBe("—");
  });

  it("empty and not-connected states", () => {
    const empty = portfolioVM(base({ pf: { ...pf, positions: [], yourIndexes: [], wallet: [], walletTotalUsd: 0, creatorEarnings: { claimableUsdc: "0" } } }));
    expect(empty.empty).toBe(true);
    expect(empty.canClaim).toBe(false);
    const out = portfolioVM(base({ connected: false, pf: null }));
    expect(out).toMatchObject({ empty: true, totalS: "—", earnS: "—", walletTotal: "—", walletDay: "—" });
    const loading = portfolioVM(base({ loading: true, pf: null }));
    expect(loading.loading).toBe(true);
    expect(loading.empty).toBe(false);
  });
});

describe("portfolio helpers", () => {
  it("formats like the reference", () => {
    expect(signedMoney(-22.31)).toBe("-$22.31");
    expect(signedMoney(null)).toBe("—");
    expect(amountText(182.5)).toBe("182.5");
    expect(amountText(0.00712)).toBe("0.0071");
    expect(amountText(1620.4, true)).toBe("1,620.40");
    expect(driftCell(50, null).drift).toBe("On target");
    expect(modeText({ ...ix("0x", "", "", true, 0) })).toBe("Off");
    expect(modeText({ ...ix("0x", "", "", true, 2, 0) })).toBe("Auto");
  });
});
