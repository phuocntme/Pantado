/** Test-only: plain API-shaped fixtures for the Index / Private / Version / Redeem view-model tests. */
import type { AssetInfo, BoardAsset, Composition, Holder, IndexDetail, IndexEvent, Levels, Portfolio, Rebalances } from "./index.data";
import type { Me } from "../lib/chrome";

export const NOW = 1_763_200_000; // fixed clock (unix seconds)
export const ID = "0x1111111111111111111111111111111111111111";
export const CREATOR = "0x2c71000000000000000000000000000000AB90";
export const NVDA = "0xaaaa00000000000000000000000000000000000a";
export const AVAX = "0xbbbb00000000000000000000000000000000000b";
const E18 = 10n ** 18n;

export const me: Me = { gasS: "Paid in test AVAX", short: "0x2c71…ab90", balanceS: "$1,620", address: CREATOR };
export const stranger: Me = { gasS: "Paid in test AVAX", short: "0x9999…9999", balanceS: "—", address: "0x9999999999999999999999999999999999999999" };

export const detail = (over: Partial<IndexDetail> = {}): IndexDetail => ({
  id: ID,
  ticker: "TBB",
  name: "Tech + BTC Balanced",
  description: "",
  creator: CREATOR.toLowerCase(),
  isPublic: true,
  mode: 1,
  driftBps: 0,
  assets: [NVDA, AVAX],
  targetBps: [6000, 4000],
  version: 1,
  supply: (10n * E18).toString(),
  level: (107n * E18).toString(),
  value: (1070n * E18).toString(),
  volumeUsdc: "2400000000000", // 2.4M USDC
  createdAt: String(NOW - 40 * 86400),
  badge: "Traded on Fuji testnet",
  visibility: "public",
  plan: { mode: 1, version: 1, status: 0, startAt: "0", auctionLive: false, pendingMode: null, pendingAt: null },
  ...over,
});

export const comp = (over: Partial<Composition> = {}): Composition => ({
  level: (107n * E18).toString(),
  value: (1070n * E18).toString(),
  supply: (10n * E18).toString(),
  maxDriftBps: 180,
  allFresh: true,
  legs: [
    { asset: NVDA, id: "nvda", symbol: "NVDA", kind: "stock", balance: (4n * E18).toString(), priceWad: (160n * E18).toString(), fresh: true, valueUsdWad: (640n * E18).toString(), currentBps: 5981, targetBps: 6000, driftBps: 30 },
    { asset: AVAX, id: "avax", symbol: "AVAX", kind: "token", balance: (43n * E18).toString(), priceWad: (10n * E18).toString(), fresh: true, valueUsdWad: (430n * E18).toString(), currentBps: 4019, targetBps: 4000, driftBps: 48 },
  ],
  ...over,
});

export const assets: AssetInfo[] = [
  { id: "nvda", symbol: "NVDA", name: "NVIDIA", kind: "stock", decimals: 18, color: "#76B900", execution: { address: NVDA } },
  { id: "avax", symbol: "AVAX", name: "Avalanche", kind: "token", decimals: 18, color: "#E84142", execution: { address: AVAX } },
  { id: "usdc", symbol: "USDC", name: "USD Coin", kind: "quote", decimals: 6, color: "#2775CA", execution: { address: "0xcccc00000000000000000000000000000000000c" } },
];

export const board: BoardAsset[] = [
  { id: "nvda", kind: "stock", change24h: 0.031, change30d: 0.111 },
  { id: "avax", kind: "token", change24h: -0.004, change30d: null },
];

export const txs: IndexEvent[] = [
  { id: "1", kind: "buy", account: "0x4f2a00000000000000000000000000000000091c0", usdc: "1250000000", units: (1168n * E18 / 100n).toString(), data: { fee: "6250000" }, ts: String(NOW - 120), txHash: "0x01" },
  { id: "2", kind: "sell", account: "0xc03b0000000000000000000000000000000e4a1", usdc: "3385000000", units: (3179n * E18 / 100n).toString(), data: { gross: "3402180000" }, ts: String(NOW - 1860), txHash: "0x02" },
  { id: "3", kind: "version", account: null, usdc: null, units: null, data: null, ts: String(NOW - 3600), txHash: "0x03" },
];

export const holders: Holder[] = [
  { holder: CREATOR.toLowerCase(), units: (6n * E18).toString(), shareBps: 6000 },
  { holder: "0x9ab40000000000000000000000000000000000c3e", units: (4n * E18).toString(), shareBps: 4000 },
];

/** Daily levels from 100 → 107 over 40 days (one point per day). */
export const levels: Levels = {
  badge: "Traded on Fuji testnet",
  levels: Array.from({ length: 41 }, (_, i) => ({ block: String(1000 + i), ts: String(NOW - (40 - i) * 86400), level: String(BigInt(Math.round((100 + (7 * i) / 40) * 1e6)) * 10n ** 12n) })),
};

export const reb = (over: Partial<Rebalances> = {}): Rebalances => ({ plans: [], auctions: [], fills: [], versions: [], ...over });

export const portfolio = (units = 10n * E18): Portfolio => ({
  address: CREATOR,
  positions: [{ index: detail(), units: units.toString(), valueUsdWad: ((units * 107n * E18) / E18).toString(), costUsdc: "1000000000", pnlUsdWad: (70n * E18).toString(), unknownCostBasis: false, maxDriftBps: 180 }],
  yourIndexes: [detail(), detail({ id: "0x3333333333333333333333333333333333333333", name: "My basket", ticker: "MYBK", isPublic: false, visibility: "private" })],
  wallet: [
    { id: "usdc", symbol: "USDC", color: "#2775CA", amount: "1620400000", decimals: 6, valueUsd: 1620.4, shareBps: 7000 },
    { id: "avax", symbol: "AVAX", color: "#E84142", amount: (70n * E18).toString(), decimals: 18, valueUsd: 700, shareBps: 3000 },
  ],
  walletTotalUsd: 2320.4,
  creatorEarnings: { claimableUsdc: "142100000" },
});
