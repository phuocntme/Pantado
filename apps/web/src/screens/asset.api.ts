/** API response shapes used by the Asset, Swap, Create and Review screens (services/api/src/server.ts). */

export interface PriceView {
  usd: number;
  ts: number;
  source: string;
  fresh: boolean;
}

export interface AssetView {
  id: string;
  symbol: string;
  displaySymbol: string;
  name: string;
  kind: "stock" | "token" | "quote";
  tier: number | null;
  decimals: number;
  color: string;
  logoURI: string | null;
  badge: string | null;
  dataSource: string;
  display: { chain: string; address: string | null };
  execution: { network: string; address: string | null; symbol: string };
  price: PriceView | null;
  risk: { sizeCapUsd?: number; oiCapUsd?: number; spreadBps: number } | null;
}

export type VenueView =
  | { kind: "stock-venue"; buysPaused: boolean; outstanding: string; sizeCapUsd: number | null; oiCapUsdWad: string; fresh: boolean }
  | { kind: "token-venue"; inventory: string; fresh: boolean };

export interface AssetDetail extends AssetView {
  venue: VenueView | null;
}

export interface CandlesView {
  source: string | null;
  candles: { t: number; o: number; h: number; l: number; c: number }[];
}

export interface PoolView {
  kind: "route" | "reference";
  name?: string;
  venue?: string | null;
  spreadBps?: number;
  sizeCapUsd?: number;
  network?: string;
  chain?: "robinhood" | "avalanche";
  address?: string;
  dex?: string | null;
  badge?: string;
}

export interface TradeView {
  id: string;
  source: string;
  side: "buy" | "sell";
  amount: string;
  usdc: string;
  account: string;
  ts: string;
  txHash: string;
}

export interface BoardRowView {
  id: string;
  kind: "stock" | "token" | "index";
  symbol: string;
  name: string;
  change24h: number | null;
  change7d: number | null;
  change30d: number | null;
  /** reference market's 24h volume (stocks, tokens); null until market-data has read a full day */
  volume24hUsd?: number | null;
}

export interface IndexView {
  id: string;
  ticker: string;
  name: string;
  description: string;
  creator: string;
  isPublic: boolean;
  mode: number;
  driftBps: number;
  assets: string[];
  targetBps: number[];
  version: number;
  supply: string;
  level: string;
  value: string;
  volumeUsdc: string;
  createdAt: string;
  badge: string | null;
}

export interface SwapQuote {
  blockNumber: string;
  amountIn: string;
  amountOut: string;
  fee: string;
  minOut: string;
}

export interface CreateQuote {
  blockNumber: string;
  usdcIn: string;
  creationFee: string;
  tradeFee: string;
  totalUsdc: string;
  units: string;
  minUnits: string;
  levelUsd: string;
  note: string;
}

export interface PresetView {
  preset: string;
  weights: number[];
}
