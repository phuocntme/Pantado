import type { Binding } from "../bindings.js";

/**
 * Review purchase (reference route `review`): the index page behind the "Review purchase" modal. Mock index
 * literals → view model; chart, version banner, sign-in-wallet button and colored stats → slots.
 */
export const binding: Binding = {
  text: {
    "Tech + BTC Balanced · tx 0x8f3e…a91c": "doneSub",
    "1 TBB = $107.02, backed by the 5 assets held in the index vault": "note",
    "One signature mints 9.30 TBB.": "signText",
    "You own 9.30 TBB": "ownText",
    "9.30 · $995.00": "heldS",
    "→ 9.30 TBB": "unitsArrow",
    "9.25 TBB": "minS",
    "0.20% · $2.00": "creatorFeeS",
    "$1,000.00": "payS",
    "$5.00": "feeS",
    "Tech + BTC Balanced": "ix.name",
    TBB: "ix.ticker",
    "by @handle": "ix.byS",
    "107.02": "ix.levelS",
    "1,204": "ix.holdersS",
    "$2.4M": "ix.boughtS",
    "27%": "ix.volS",
    "Stocks 50%": "mix.stocksS",
    "Tokens 50%": "mix.tokensS",
    "Stocks and crypto offset each other here. NVDA and MSFT move together, so the stock half is less diverse than it looks.": "assess.text",
    "Deep liquidity": "assess.tag1",
    "Tech-heavy": "assess.tag2",
  },
  slots: [
    // chart header: the 15m · 1h · 4h · 1D · 1W group drives the chart
    { tag: "div", attrs: { role: "group", "aria-label": "Interval" }, name: "interval" },
    { tag: "a", attrs: { href: "Version.dc.html", "style~": "background: #1E1A12" }, name: "banner" },
    { tag: "div", attrs: { "aria-label~": "candlestick chart" }, name: "chart" },
    { tag: "div", attrs: { style: "margin-top: 4px; font-family: 'Inter Tight', sans-serif; font-size: 24px; font-weight: 600; color: #3DD68C" }, name: "chg24" },
    { tag: "div", attrs: { "style~": "grid-template-columns: repeat(4, minmax(0, 1fr)); background: #0B0B0D" }, name: "perf" },
    { tag: "div", attrs: { "style~": "height: 6px; gap: 2px; border-radius: 3px" }, name: "mixBar" },
    { tag: "button", attrs: { "style~": "width: 100%; min-height: 52px; background: #1A1A1D" }, name: "signing" },
  ],
};
