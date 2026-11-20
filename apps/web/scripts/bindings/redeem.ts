import type { Binding } from "../bindings.js";

/** Redeem modal over Portfolio: bound to src/screens/redeem.vm.ts. */
export const binding: Binding = {
  text: {
    "$12,480.22": "bg.totalS",
    "+$812.40": "bg.pnl30S",
    "$142.10": "bg.earnedS",
    "142.10": "bg.claimS",
    "Stocks 46%": "bg.stocksL",
    "Tokens 41%": "bg.tokensL",
    "USDC 13%": "bg.cashL",
    "10.00 TBB": "amountS",
    "$1,070.20": "valueS",
    "10 TBB": "unitsL",
    "5 tokens": "doneTokens",
    "Tech + BTC Balanced": "name",
    "0x3b9d…e017": "txShort",
  },
  slots: [
    { tag: "div", attrs: { "style~": "height: 8px; gap: 2px; border-radius: 4px" }, name: "allocBar" },
    { tag: "div", attrs: { style: "display: flex; flex-direction: column" }, name: "legs" },
    { tag: "button", attrs: { onclick: "{{toDone}}" }, name: "confirm" },
  ],
};
