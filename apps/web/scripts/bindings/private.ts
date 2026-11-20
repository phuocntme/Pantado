import type { Binding } from "../bindings.js";

/** Index (private) page: same live view model as the public page plus Make public (src/screens/private.vm.ts). */
export const binding: Binding = {
  text: {
    "My basket": "name",
    MYBK: "ticker",
    "Traded on Fuji testnet": "badge",
    "Manual · creator publishes versions": "modeLabel",
    "1,204": "holdersS",
    "$2.4M": "boughtS",
    "27%": "volS",
    "Stocks and crypto offset each other here. NVDA and MSFT move together, so the stock half is less diverse than it looks.":
      "assess.text",
  },
  slots: [
    // chart header: the 15m · 1h · 4h · 1D · 1W group drives the chart
    { tag: "div", attrs: { role: "group", "aria-label": "Interval" }, name: "interval" },
    { tag: "div", attrs: { role: "img", "aria-label~": "candlestick" }, name: "levelChart" },
    { tag: "div", attrs: { style: "display: flex; flex-direction: column; gap: 12px; padding: 16px 20px" }, name: "planStatus" },
    { tag: "div", attrs: { "style~": "grid-template-columns: repeat(2, minmax(0, 1fr))" }, name: "statsTop" },
    { tag: "div", attrs: { "style~": "grid-template-columns: repeat(4, minmax(0, 1fr))" }, name: "changes" },
    { tag: "div", attrs: { "style~": "gap: 6px; padding: 4px 2px" }, name: "split" },
    { tag: "div", attrs: { style: "display: flex; flex-wrap: wrap; gap: 6px" }, name: "assessTags" },
    // Fork removed; one "Ask agent" that opens Ask with a question about this index
    { tag: "div", attrs: { style: "display: grid; grid-template-columns: 1fr 1fr; gap: 8px" }, name: "agentActions" },
    { tag: "a", attrs: { href: "{{cta.href}}" }, name: "cta" },
  ],
};
