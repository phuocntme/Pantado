import type { Binding } from "../bindings.js";

/**
 * Marketplace. The reference's DATA column (price-source chip per row) is not shown: its header, cells
 * and column width are slots the screen leaves empty. Each asset page still names its source.
 */
export const binding: Binding = {
  slots: [
    { tag: "col", attrs: { style: "width: 14%" }, name: "dataCol" },
    { tag: "th", attrs: {}, text: "Data", name: "dataHead" },
    { tag: "td", attrs: { style: "padding: 5px 12px; text-align: left; white-space: nowrap" }, name: "dataCell" },
  ],
  text: {
    "Crypto Beta": "top.index.name",
    "+8.9%": "top.index.chg",
    NVDA: "top.stock.name",
    "+3.1%": "top.stock.chg",
    AVAX: "top.token.name",
    "+2.1%": "top.token.chg",
    "$186.4M": "totalVolS",
  },
};
