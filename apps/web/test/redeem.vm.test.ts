import { describe, expect, it } from "vitest";
import { redeemUnits, redeemVM, sig, type RedeemInput, type RedeemState } from "../src/screens/redeem.vm";
import { assets, AVAX, board, comp, detail, ID, me, portfolio } from "../src/screens/index.fixtures";

const E18 = 10n ** 18n;
const input = (over: Partial<RedeemInput> = {}): RedeemInput => ({ id: ID, detail: detail(), comp: comp(), portfolio: portfolio(), assets, board, unitsParam: null, me, ...over });
const st = (over: Partial<RedeemState> = {}): RedeemState => ({ forfeit: [], step: "review", txHash: null, pending: false, ...over });
const h = { toggle: () => undefined, redeem: () => undefined };

describe("redeemVM", () => {
  it("redeems the whole position pro rata, no fee, no price", () => {
    const v = redeemVM(input({ portfolio: portfolio(5n * E18) }), st(), h);
    expect(v.amountS).toBe("5.00 TBB");
    expect(v.unitsL).toBe("5 TBB");
    // half the supply → half of each vault balance
    expect(v.legs.map((l) => [l.sym, l.amt, l.usd, l.checked])).toEqual([
      ["NVDA", "2", "$320.00", true],
      ["AVAX", "21.5", "$215.00", true],
    ]);
    expect(v.valueS).toBe("$535.00");
    expect(v.doneTokens).toBe("2 tokens");
    expect(v.isReview).toBe(true);
    expect(v.canRedeem).toBe(true);
  });

  it("caps a URL amount at the position and passes forfeited assets", () => {
    expect(redeemUnits(portfolio(5n * E18), ID, 2n * E18)).toEqual({ held: 5n * E18, units: 2n * E18 });
    expect(redeemUnits(portfolio(5n * E18), ID, 9n * E18).units).toBe(5n * E18);
    let call: [bigint, string[]] | null = null;
    const skip = [AVAX.toLowerCase()];
    const v = redeemVM(input({ unitsParam: 2n * E18 }), st({ forfeit: skip }), { toggle: () => undefined, redeem: (u, f) => (call = [u, f]) });
    expect(v.legs[1]?.checked).toBe(false);
    expect(v.doneTokens).toBe("1 token");
    v.toDone();
    expect(call).toEqual([2n * E18, skip]);
  });

  it("cannot redeem with no position", () => {
    const p = portfolio();
    p.positions = [];
    let called = false;
    const v = redeemVM(input({ portfolio: p }), st(), { toggle: () => undefined, redeem: () => (called = true) });
    expect(v.empty).toBe(true);
    expect(v.canRedeem).toBe(false);
    v.toDone();
    expect(called).toBe(false);
  });

  it("fills the Portfolio behind the modal from /portfolio", () => {
    const v = redeemVM(input(), st(), h);
    expect(v.bg.totalS).toBe("$3,390.40");
    expect(v.bg.earnedS).toBe("$142.10");
    expect(v.bg.claimS).toBe("142.10");
    expect(v.bg.pnl30S).toBe("—");
    expect(v.bg.stocksL).toBe("Stocks 19%");
    expect(v.bg.cashL).toBe("USDC 48%");
    expect(v.pos[0]).toMatchObject({ name: "Tech + BTC Balanced", units: "10.0 TBB", value: "$1,070.00", pnl: "+$70.00", drift: "1.8% drift" });
    expect(v.pos[0]?._href).toEqual({ IndexDetail: `/index/${ID}`, Redeem: `/redeem/${ID}` });
    expect(v.mine.map((m) => [m.name, m.status, m.holders])).toEqual([
      ["Tech + BTC Balanced", "Public", "—"],
      ["My basket", "Private", "Only you"],
    ]);
    expect(v.assets.map((a) => [a.sym, a.kind, a.d])).toEqual([
      ["USDC", "Cash", "—"],
      ["AVAX", "Token", "-0.4%"],
    ]);
    expect(v.walletTotal).toBe("$2,320.40");
    expect(v.walletDay).toBe("—");
  });

  it("shows the done step with the tx", () => {
    const v = redeemVM(input(), st({ step: "done", txHash: "0x3b9d000000000000000000000000000000000000000000000000000000e017" }), h);
    expect(v.isDone).toBe(true);
    expect(v.txShort).toBe("0x3b9d…e017");
    expect(sig(0.0035982)).toBe("0.003598");
  });
});
