import { describe, expect, it } from "vitest";
import { edgeBps, fillDecision, payFor, type AuctionView } from "../src/logic.js";

const E = 10n ** 18n;
// sell 18-dp asset at $200, receive 8-dp asset at $50 000 → fair = 0.004 j per i
const a = (price: bigint, o: Partial<AuctionView> = {}): AuctionView => ({
  lot: 10n * E,
  filled: 0n,
  price,
  priceI: 200n * E,
  priceJ: 50_000n * E,
  decI: 18,
  decJ: 8,
  ...o,
});
const fair = (200n * E * E) / (50_000n * E);

describe("filler logic", () => {
  it("edge is positive below fair", () => {
    expect(edgeBps(a(fair))).toBe(0);
    expect(edgeBps(a((fair * 9950n) / 10_000n))).toBe(50);
    expect(edgeBps(a((fair * 10_050n) / 10_000n))).toBe(-50);
  });
  it("fills only at the minimum edge, capped by USD", () => {
    const cfg = { minEdgeBps: 0, maxFillUsdE18: 1000n * E };
    expect(fillDecision(a((fair * 10_050n) / 10_000n), cfg)).toBeNull();
    const d = fillDecision(a(fair), cfg);
    expect(d?.amountOut).toBe(5n * E); // $1000 / $200
    expect(fillDecision(a(fair, { filled: 10n * E }), cfg)).toBeNull();
  });
  it("pays like the contract (round up)", () => {
    expect(payFor(a(fair), 5n * E)).toBe(2_000_000n); // 0.02 BTC in 8 dp
  });
});
