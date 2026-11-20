import { describe, expect, it } from "vitest";
import { buySpends, previewBuy, previewSell, quoteSwap, sellAmounts, QuoteError, type BasketState, type DexMarket, type TokenMarket } from "../src/math/index.js";

const WAD = 10n ** 18n;
const token = (priceUsd: bigint, decimals = 18): TokenMarket => ({ kind: "token", decimals, spreadBps: 30, priceWad: priceUsd * WAD, inventoryOut: 10n ** 30n });
const dex = (priceUsd: bigint, decimals = 18): DexMarket => ({ kind: "dex", decimals, priceWad: priceUsd * WAD, buyOut: {}, sellOut: {} });
const basket = (markets: (TokenMarket | DexMarket)[], balances: bigint[], supply: bigint): BasketState => ({
  supply,
  tradeFeeBps: 50,
  deadUnits: 1000n,
  startLevelUsd: 100n,
  usdcDecimals: 6,
  usdcVenueInventory: { venue: 10n ** 15n },
  legs: markets.map((m, i) => ({ asset: `0x${i}`, decimals: 18, balance: balances[i] ?? 0n, targetBps: 5000, fresh: true, venue: "venue", market: m })),
});

describe("DEX venue quotes in the shared previews", () => {
  it("buySpends is the split previewBuy uses (first buy and later buys)", () => {
    for (const s of [basket([token(7n), token(65_000n)], [0n, 0n], 0n), basket([token(7n), token(65_000n)], [10n * WAD, WAD / 1000n], 5n * WAD)]) {
      expect(buySpends(s, 1_000_000_000n)).toEqual(previewBuy(s, 1_000_000_000n).spends);
    }
  });

  it("previewBuy / previewSell / quoteSwap read the amounts DexVenue.quote returned", () => {
    const m = dex(7n);
    const s = basket([m, dex(1n)], [10n * WAD, 70n * WAD], 5n * WAD);
    const spends = buySpends(s, 100_000_000n);
    // the quote service asks the chain for exactly these, then the preview reads them
    s.legs.forEach((l, i) => {
      if (l.market.kind === "dex") l.market.buyOut[(spends[i] ?? 0n).toString()] = 7n * WAD;
    });
    const q = previewBuy(s, 100_000_000n);
    expect(q.outs).toEqual([7n * WAD, 7n * WAD]);
    const amounts = sellAmounts(s, WAD);
    s.legs.forEach((l, i) => {
      if (l.market.kind === "dex") l.market.sellOut[(amounts[i] ?? 0n).toString()] = 13_000_000n;
    });
    expect(previewSell(s, WAD).gross).toBe(26_000_000n);
    m.sellOut["5"] = 33n;
    expect(quoteSwap(m, null, 5n, 10, 6).amountOut).toBe(33n);
  });

  it("an amount nobody quoted is an error, never a guess", () => {
    expect(() => quoteSwap(null, dex(7n), 1_000_000n, 10, 6)).toThrow(QuoteError);
  });
});
