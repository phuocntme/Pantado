import { decodeFunctionData, encodeErrorResult, getAddress, type Address } from "viem";
import { describe, expect, it } from "vitest";
import { decodeRevert, indexFactoryAbi, indexVaultAbi, priceOracleAbi, stockVenueAbi, tx, RebalanceMode } from "../src/index.js";

const A = (n: number): Address => getAddress(`0x${n.toString(16).padStart(40, "0")}`);

describe("tx builders", () => {
  it("createAndBuy encodes the create params", () => {
    const req = tx.createAndBuy(A(1), {
      name: "AI Chips",
      ticker: "CHIP",
      description: "",
      assets: [A(2), A(3)],
      weightsBps: [5000, 5000],
      mode: RebalanceMode.Auto,
      driftBps: 2000,
      isPublic: true,
      usdcIn: 100_000_000n,
      minUnits: 0n,
    });
    expect(req.to).toBe(A(1));
    const d = decodeFunctionData({ abi: indexFactoryAbi, data: req.data });
    expect(d.functionName).toBe("createAndBuy");
    const p = (d.args as readonly [{ ticker: string; mode: number; driftBps: number; usdcIn: bigint }])[0];
    expect(p).toMatchObject({ ticker: "CHIP", mode: 2, driftBps: 2000, usdcIn: 100_000_000n });
  });

  it("redeem passes forfeit list", () => {
    const req = tx.redeem(A(9), 5n, A(4), [A(7)]);
    const d = decodeFunctionData({ abi: indexVaultAbi, data: req.data });
    expect(d.functionName).toBe("redeem");
    expect(d.args).toEqual([5n, A(4), [A(7)]]);
  });
});

describe("errors", () => {
  it("maps PriceStale to the redeem hint", () => {
    const data = encodeErrorResult({ abi: priceOracleAbi, errorName: "PriceStale", args: [A(5), 1n, 3600n] });
    const e = decodeRevert(data);
    expect(e.code).toBe("PriceStale");
    expect(e.message).toContain("redeem from Portfolio");
  });

  it("maps SizeCapExceeded to the per-trade message", () => {
    const data = encodeErrorResult({ abi: stockVenueAbi, errorName: "SizeCapExceeded", args: [1n, 2n] });
    expect(decodeRevert(data).message).toBe("This trade is above the max per trade for this stock.");
  });

  it("unknown data falls back", () => {
    expect(decodeRevert("0xdeadbeef").code).toBe("Unknown");
  });
});
