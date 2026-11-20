import { describe, expect, it } from "vitest";
import { clampView, defaultView, MAX_VISIBLE, MIN_VISIBLE, panView, visible, zoomView } from "../src/lib/zoom";
import { mergePages } from "../src/lib/candles";
import { buildChart } from "../src/screens/asset.chart";
import { chartGeometry, levelCandles, SLOTS } from "../src/screens/index.chart";

describe("chart zoom", () => {
  it("starts on the newest candles", () => {
    expect(defaultView(500, 90)).toEqual({ count: 90, end: 500 });
    expect(defaultView(30, 90)).toEqual({ count: 30, end: 30 });
    expect(defaultView(0, 90)).toEqual({ count: 0, end: 0 });
  });

  it("zooms around the anchor and never past the data or below the minimum", () => {
    const v = { count: 100, end: 500 };
    const zin = zoomView(v, 500, 0.5, 1); // right edge stays
    expect(zin).toEqual({ count: 50, end: 500 });
    const mid = zoomView(v, 500, 0.5, 0.5); // centre candle stays
    expect(mid).toEqual({ count: 50, end: 475 });
    expect(zoomView(v, 500, 0.01, 0.5).count).toBe(MIN_VISIBLE);
    expect(zoomView(v, 500, 100, 0.5)).toEqual({ count: 500, end: 500 });
  });

  it("pans within the series", () => {
    const v = { count: 50, end: 500 };
    expect(panView(v, 500, 20)).toEqual({ count: 50, end: 480 }); // towards older data
    expect(panView(v, 500, -20)).toEqual({ count: 50, end: 500 }); // already at the newest
    expect(panView(v, 500, 10_000)).toEqual({ count: 50, end: 50 });
    expect(clampView({ count: 3, end: 2 }, 100)).toEqual({ count: MIN_VISIBLE, end: MIN_VISIBLE });
  });

  it("never draws more than MAX_VISIBLE candles of a long history", () => {
    const n = 20_000;
    expect(zoomView({ count: 900, end: n }, n, 10, 1)).toEqual({ count: MAX_VISIBLE, end: n });
    expect(defaultView(n, 5000).count).toBe(MAX_VISIBLE);
    expect(clampView({ count: n, end: n }, n).count).toBe(MAX_VISIBLE);
  });

  it("older pages go before the newest candles without duplicates", () => {
    const k = (t: number) => ({ t, o: t, h: t, l: t, c: t });
    expect(mergePages([k(1), k(2), k(3)], [k(3), k(4)]).map((c) => c.t)).toEqual([1, 2, 3, 4]);
    expect(mergePages([k(1)], []).map((c) => c.t)).toEqual([1]);
  });

  it("slices the visible candles", () => {
    const xs = Array.from({ length: 10 }, (_, i) => i);
    expect(visible(xs, { count: 3, end: 7 })).toEqual([0, 1, 2, 3, 4, 5, 6, 7]); // widened to MIN_VISIBLE, kept in range
    expect(visible(xs, { count: 8, end: 10 })).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("asset chart legend follows the hovered candle and draws a crosshair", () => {
    const cs = Array.from({ length: 30 }, (_, k) => ({ t: 1_754_006_400 + k * 3600, o: 100 + k, h: 102 + k, l: 99 + k, c: 101 + k }));
    const m = buildChart(cs, 1, 0.18, 5);
    expect(m.ohlc).toMatchObject({ o: "105.00", c: "106.00" });
    expect(m.focusX).not.toBeNull();
    expect(m.last?.label).toBe("130.00"); // the price tag stays on the newest candle
    expect(buildChart(cs).focusX).toBeNull();
    expect(buildChart(cs).xTicks.length).toBeGreaterThan(2); // hour labels on intraday data
  });
});

describe("index chart intervals", () => {
  const H = 3600;
  const t0 = 1_754_006_400; // a UTC midnight
  const levels = Array.from({ length: 48 }, (_, i) => ({ ts: String(t0 + i * H + 60), level: String(BigInt(100 + i) * 10n ** 18n), block: String(i) }));

  it("buckets levels by the picked interval", () => {
    expect(levelCandles(levels, [], 86400)).toHaveLength(2);
    expect(levelCandles(levels, [], 4 * H)).toHaveLength(12);
    const h = levelCandles(levels, [], H);
    expect(h).toHaveLength(48);
    expect(h[1]).toMatchObject({ t: t0 + H, o: 101, c: 101 });
  });

  it("keeps the reference geometry at 112 slots and widens bodies when zoomed in", () => {
    const c = levelCandles(levels, [], H);
    const ref = chartGeometry(c);
    expect(ref.candles[0]?.body.w).toBeCloseTo(5.6, 1);
    const zoomed = chartGeometry(c.slice(-20), 20, 3);
    expect(zoomed.candles[0]!.body.w).toBeGreaterThan(20);
    expect(zoomed.ohlc?.c).toBe((100 + 31).toFixed(2));
    expect(zoomed.focusX).not.toBeNull();
    expect(SLOTS).toBe(112);
  });
});

describe("micro prices", () => {
  it("show 4 significant digits, with the leading zeros counted in a subscript below 0.0001", async () => {
    const { priceS, amountS } = await import("../src/screens/asset.vm");
    const { priceText } = await import("../src/screens/marketplace.vm");
    const { pxNum, axisNum } = await import("../src/screens/asset.chart");
    const { tinyNum } = await import("../src/lib/fmt");
    expect(priceS(8.348e-8)).toBe("$0.0₇8348");
    expect(priceText(8.475e-8)).toBe("$0.0₇8475");
    expect(priceText(0.0002177)).toBe("$0.0002177");
    expect(pxNum(0.000002206)).toBe("0.0₅2206");
    expect(priceS(0.2134)).toBe("$0.2134");
    expect(tinyNum(0.0000999999)).toBe("0.0₃1"); // rounding carries to 0.0001
    expect(tinyNum(1.2e-12)).toBe("0.0₁₁12");
    expect(axisNum(8e-8, 1e-9)).toBe("0.0₇8"); // 0.000000080: the step needs 2 significant digits, trailing zero dropped
    expect(axisNum(8.5e-8, 5e-9)).toBe("0.0₇85");
    expect(amountS(5_875_566_123, 2)).toBe("5.88B");
    expect(amountS(1234.5, 2)).toBe("1,234.50");
  });
});
