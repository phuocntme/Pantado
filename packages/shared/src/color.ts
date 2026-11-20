/**
 * Two-letter avatar color for an asset without a logo (spec §12). Deterministic per id.
 * Avalanche red is reserved for AVAX and never picked for other assets.
 */
export const AVALANCHE_RED = "#E84142";

const PALETTE = [
  "#4C8DF6", "#2FB8A6", "#F5A524", "#7C6CF2", "#3FB950", "#E06BC4",
  "#56B6F0", "#C9A227", "#5AC8A8", "#8B7CF6", "#F08A4B", "#6E9BD1",
] as const;

/** Avatar colors used by the approved reference UI (apps/web/reference). Others fall back to the palette. */
const REFERENCE_COLORS: Record<string, string> = {
  usdc: "#2775CA", btcb: "#F7931A", wethe: "#8C8CF7", savax: "#B3292A", joe: "#F2716A",
  nvda: "#76B900", msft: "#00A4EF", aapl: "#A3AAAE", amd: "#B4B4BB", tsla: "#CC0000", avgo: "#CC092F",
  tsm: "#B3262B", meta: "#1877F2", googl: "#4285F4", amzn: "#FF9900", mu: "#2B55A8", mstr: "#D9822B",
  coin: "#1652F0", pltr: "#8E8E96", crcl: "#3A6FF7",
};

export function assetColor(id: string): string {
  if (id === "wavax" || id === "avax") return AVALANCHE_RED;
  const ref = REFERENCE_COLORS[id];
  if (ref) return ref;
  let h = 2166136261;
  for (const ch of id) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return PALETTE[h % PALETTE.length] ?? PALETTE[0];
}

/** Display symbol: WAVAX is shown as AVAX (spec §4). */
export function displaySymbol(symbol: string): string {
  return symbol === "WAVAX" ? "AVAX" : symbol;
}
