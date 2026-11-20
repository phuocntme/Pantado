import { defineChain } from "viem";
import { CONFIG } from "./config";

/** The execution chain of the active profile (Fuji in `contest`). */
export const chain = defineChain({
  id: CONFIG.chainId,
  name: CONFIG.network,
  nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 },
  rpcUrls: { default: { http: [CONFIG.rpc] } },
  blockExplorers: CONFIG.explorer ? { default: { name: "Explorer", url: CONFIG.explorer } } : undefined,
});
