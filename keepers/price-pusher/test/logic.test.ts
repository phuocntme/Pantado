import { describe, expect, it } from "vitest";
import type { CanonicalPrice } from "@pantado/shared";
import { decide, moveBpsE18, type OnchainAsset } from "../src/logic.js";

const E = 10n ** 18n;
const asset = (over: Partial<OnchainAsset> = {}): OnchainAsset => ({
  id: "nvda",
  address: "0x0000000000000000000000000000000000000001",
  lastPriceE18: 100n * E,
  lastPushedAt: 1000,
  bandMinE18: 20n * E,
  bandMaxE18: 500n * E,
  maxAgeSec: 3600,
  ...over,
});
const price = (usd: string, cross: string | null = usd, ts = 1000): CanonicalPrice => ({
  id: "nvda",
  canonical: { usd, ts, source: "robinhood" },
  crossCheck: cross === null ? null : { usd: cross, ts, source: "stock-api" },
});
const cfg = { pushIntervalSec: 30, moveBps: 25, deviationBps: 200 };

describe("decide", () => {
  it("pushes on interval", () => {
    expect(decide([asset()], [price("100")], 1029, cfg).pushes).toHaveLength(0);
    const d = decide([asset()], [price("100")], 1030, cfg);
    expect(d.pushes).toEqual([{ id: "nvda", address: asset().address, priceE18: 100n * E, reason: "interval" }]);
  });

  it("pushes on a move > 25 bps before the interval", () => {
    expect(decide([asset()], [price("100.25")], 1001, cfg).pushes).toHaveLength(0);
    expect(decide([asset()], [price("100.26")], 1001, cfg).pushes[0]?.reason).toBe("move");
  });

  it("skips and alerts when sources disagree by > 200 bps", () => {
    const d = decide([asset()], [price("100", "102.1")], 2000, cfg);
    expect(d.pushes).toHaveLength(0);
    expect(d.skips[0]).toMatchObject({ id: "nvda", reason: "deviation" });
    expect(decide([asset()], [price("100", "102")], 2000, cfg).pushes).toHaveLength(1);
  });

  it("pushes without a cross-check when none exists", () => {
    expect(decide([asset()], [price("100", null)], 2000, cfg).pushes).toHaveLength(1);
  });

  it("skips out-of-band, missing and stale-source prices", () => {
    expect(decide([asset()], [price("600")], 2000, cfg).skips[0]?.reason).toBe("band");
    expect(decide([asset()], [], 2000, cfg).skips[0]?.reason).toBe("missing");
    expect(decide([asset()], [price("100", "100", 1000)], 4601, cfg).skips[0]?.reason).toBe("source-stale");
  });

  it("keeps 18 decimals exactly", () => {
    expect(decide([asset()], [price("164.6")], 2000, cfg).pushes[0]?.priceE18).toBe(1646n * 10n ** 17n);
  });

  it("moveBpsE18", () => {
    expect(moveBpsE18(10025n, 10000n)).toBe(25);
    expect(moveBpsE18(9975n, 10000n)).toBe(25);
  });
});
