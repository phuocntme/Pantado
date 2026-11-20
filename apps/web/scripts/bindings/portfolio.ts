import type { Binding } from "../bindings.js";

/** Portfolio: totals, creator earnings + claim, allocation, positions head (loading / empty states). */
export const binding: Binding = {
  text: {
    "$12,480.22": "totalS",
    "$142.10": "earnS",
    "Stocks 46%": "alloc.stocksL",
    "Tokens 41%": "alloc.tokensL",
    "USDC 13%": "alloc.usdcL",
    // the wallet includes index tokens
    "Assets held directly, outside indexes": "walletSub",
  },
  slots: [
    { tag: "div", attrs: { "style~": "font-size: 30px; font-weight: 600; letter-spacing: -0.02em; color: #3DD68C" }, name: "pnlTotal" },
    { tag: "button", attrs: { "style~": "margin-top: 10px; min-height: 40px" }, name: "claimButton" },
    { tag: "div", attrs: { "aria-hidden": "true", "style~": "display: flex; height: 8px; gap: 2px" }, name: "allocBar" },
    { tag: "h2", attrs: { style: "margin: 0; padding: 16px 20px 10px; font-size: 16px; font-weight: 600" }, name: "positionsHead" },
    // the day change takes its sign's colour (the reference painted it green)
    { tag: "span", attrs: { style: "font-size: 13px; color: #3DD68C" }, name: "walletDay" },
  ],
};
