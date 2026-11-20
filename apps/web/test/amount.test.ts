import { describe, expect, it, vi } from "vitest";
import { amountInputOk, bigAmount, usdAmount } from "../src/lib/fmt";
import { recvFmt } from "../src/screens/swap.vm";

describe("trade amounts", () => {
  it("inputs take ≤ 12 whole digits and no more decimals than the token", () => {
    for (const ok of ["", "0", "7", "7.", "0.5", "999999999999", "000000000000001", "1.123456"]) expect(amountInputOk(ok, 6), ok).toBe(true);
    for (const bad of ["1000000000000", "62149184698712935000000000000", "1.1234567", "1e9", "-5", "1.2.3", "abc"]) expect(amountInputOk(bad, 6), bad).toBe(false);
    expect(amountInputOk("0.000000000000000001", 18)).toBe(true);
  });
  it("big numbers stay short: compact USD, M/B/T, then exponent", () => {
    expect(usdAmount(7)).toBe("$7.00");
    expect(usdAmount(999_999.5)).toBe("$999,999.50");
    expect(usdAmount(6_214_918.47)).toBe("$6.21M");
    expect(usdAmount(6.2e12)).toBe("$6.20T");
    expect(bigAmount(8.72e59, 2)).toBe("8.72e+59");
    expect(recvFmt(872_237_211_214)).toBe("872.24B");
    expect(recvFmt(0.987948)).toBe("0.987948");
    // unit after rounding
    expect(usdAmount(999_999_999_999)).toBe("$1.00T");
    expect(usdAmount(999_999_999.999)).toBe("$1.00B");
    expect(bigAmount(1_000_000, 2)).toBe("1.00M");
  });
});

describe("amount inputs ignore what they cannot take", () => {
  it("swap: a 30-digit paste leaves the amount unchanged", async () => {
    const { swapVM } = await import("../src/screens/swap.vm");
    const setAmt = vi.fn();
    const usdc = { id: "usdc", symbol: "USDC", displaySymbol: "USDC", name: "USD Coin", kind: "quote" as const, tier: null, decimals: 6, color: "#2775CA", logoURI: null, badge: null, dataSource: "", display: { chain: "avalanche", address: null }, execution: { network: "fuji", address: "0x01", symbol: "USDC" }, price: null, risk: null };
    const v = swapVM({
      assets: [usdc],
      search: { data: null, error: null },
      ui: { from: "usdc", to: "usdc", amt: "7", pick: null, q: "" },
      quote: { data: null, error: null },
      tx: { status: "idle" },
      wallet: { connected: false, chainOk: true },
      env: { network: "fuji", explorer: "", nowSec: 0, deployed: true },
      actions: { setAmt, setQ: vi.fn(), open: vi.fn(), close: vi.fn(), choose: vi.fn(), flip: vi.fn(), submit: vi.fn(), connect: vi.fn(), switchChain: vi.fn() },
      me: { gasS: "", short: "", balanceS: "", address: null },
    });
    const onAmt = v.onAmt as (e: { target: { value: string } }) => void;
    onAmt({ target: { value: "621491846987129350000000000000" } });
    onAmt({ target: { value: "7.1234567" } }); // 7 decimals on USDC
    expect(setAmt).not.toHaveBeenCalled();
    onAmt({ target: { value: "25.5" } });
    expect(setAmt).toHaveBeenCalledWith("25.5");
  });
});
