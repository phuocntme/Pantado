import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  findRepoRoot,
  level,
  previewBuy,
  previewRedeem,
  previewSell,
  quoteSwap,
  relativeDriftBps,
  valueOf,
  type BasketState,
  type Market,
} from "../src/index.js";

/** Fixtures written by contracts/test/e2e/GoldenFixtures.t.sol (`forge test --mt test_writeGolden`). */
const FILE = join(findRepoRoot(), "contracts/test/fixtures/golden.json");

interface LegJson {
  asset: string;
  decimals: number;
  balance: string;
  targetBps: number;
  priceWad: string;
  venue: string;
  kind: "stock" | "token";
  spreadBps: number;
  buysPaused?: boolean;
  sizeCapUsdWad?: string;
  oiCapUsdWad?: string;
  outstanding?: string;
  totalExposureUsdWad?: string;
  reserve?: string;
  reserveRatioBps?: number;
  inventoryOut?: string;
}
interface ScenarioJson {
  name: string;
  supply: string;
  tradeFeeBps: number;
  deadUnits: string;
  startLevelUsd: string;
  usdcDecimals: number;
  tokenVenue: string;
  tokenVenueUsdc: string;
  level: string;
  maxDriftBps: string;
  legs: LegJson[];
  buys: { usdcIn: string; units?: string; fee?: string; error?: string }[];
  sells: { units: string; usdcOut?: string; fee?: string; error?: string }[];
}
interface GoldenJson {
  usdc: string;
  tokenVenueUsdc: string;
  swapFeeBps: number;
  scenarios: ScenarioJson[];
  markets: LegJson[];
  swaps: { tokenIn: string; tokenOut: string; amountIn: string; amountOut: string; fee: string }[];
}

const B = (s: string | undefined): bigint => BigInt(s ?? "0");

function market(l: LegJson): Market {
  return l.kind === "stock"
    ? {
        kind: "stock",
        spreadBps: l.spreadBps,
        priceWad: B(l.priceWad),
        buysPaused: l.buysPaused ?? false,
        sizeCapUsdWad: B(l.sizeCapUsdWad),
        oiCapUsdWad: B(l.oiCapUsdWad),
        outstanding: B(l.outstanding),
        totalExposureUsdWad: B(l.totalExposureUsdWad),
        reserve: B(l.reserve),
        reserveRatioBps: l.reserveRatioBps ?? 15_000,
      }
    : { kind: "token", decimals: l.decimals, spreadBps: l.spreadBps, priceWad: B(l.priceWad), inventoryOut: B(l.inventoryOut) };
}

function state(s: ScenarioJson): BasketState {
  return {
    supply: B(s.supply),
    tradeFeeBps: s.tradeFeeBps,
    deadUnits: B(s.deadUnits),
    startLevelUsd: B(s.startLevelUsd),
    usdcDecimals: s.usdcDecimals,
    usdcVenueInventory: { [s.tokenVenue]: B(s.tokenVenueUsdc) },
    legs: s.legs.map((l) => ({
      asset: l.asset,
      decimals: l.decimals,
      balance: B(l.balance),
      targetBps: l.targetBps,
      fresh: true,
      venue: l.venue,
      market: market(l),
    })),
  };
}

const golden: GoldenJson | null = existsSync(FILE) ? (JSON.parse(readFileSync(FILE, "utf8")) as GoldenJson) : null;
const run = golden ? describe : describe.skip;

run("TS math == contracts (golden fixtures)", () => {
  const g = golden as GoldenJson;
  for (const sc of g.scenarios) {
    describe(sc.name, () => {
      const st = state(sc);
      it("level", () => {
        expect(
          level(
            st.legs.map((l) => l.balance),
            st.legs.map((l) => l.market.priceWad),
            st.legs.map((l) => l.decimals),
            st.supply,
          ),
        ).toBe(B(sc.level));
      });
      it("max drift", () => {
        const vals = st.legs.map((l) => valueOf(l.balance, l.market.priceWad, l.decimals));
        const total = vals.reduce((a, b) => a + b, 0n);
        const max = st.legs.reduce((m, l, i) => {
          const d = relativeDriftBps(vals[i] ?? 0n, total, l.targetBps);
          return d > m ? d : m;
        }, 0n);
        expect(max).toBe(B(sc.maxDriftBps));
      });
      it("previewBuy, exact to the wei", () => {
        for (const b of sc.buys) {
          if (b.error) {
            expect(() => previewBuy(st, B(b.usdcIn))).toThrow(expect.objectContaining({ code: b.error }));
            continue;
          }
          const q = previewBuy(st, B(b.usdcIn));
          expect({ units: q.units, fee: q.fee }).toEqual({ units: B(b.units), fee: B(b.fee) });
        }
      });
      it("previewSell, exact to the wei", () => {
        for (const s of sc.sells) {
          if (s.error) {
            expect(() => previewSell(st, B(s.units))).toThrow(expect.objectContaining({ code: s.error }));
            continue;
          }
          const q = previewSell(st, B(s.units));
          expect({ usdcOut: q.usdcOut, fee: q.fee }).toEqual({ usdcOut: B(s.usdcOut), fee: B(s.fee) });
        }
      });
      it("previewRedeem is pro rata", () => {
        const r = previewRedeem(st.legs.map((l) => l.balance), st.supply, st.supply / 3n);
        r.forEach((x, i) => expect(x).toBe(((st.legs[i]?.balance ?? 0n) * (st.supply / 3n)) / st.supply));
      });
    });
  }

  it("swap quotes", () => {
    const byAddr = new Map(g.markets.map((m) => [m.asset.toLowerCase(), market(m)]));
    const get = (a: string): Market | null => (a.toLowerCase() === g.usdc.toLowerCase() ? null : (byAddr.get(a.toLowerCase()) ?? null));
    for (const s of g.swaps) {
      const q = quoteSwap(get(s.tokenIn), get(s.tokenOut), B(s.amountIn), g.swapFeeBps, 6, B(g.tokenVenueUsdc));
      expect(q).toEqual({ amountOut: B(s.amountOut), fee: B(s.fee) });
    }
  });
});

describe("golden fixture file", () => {
  it("exists (run forge test --mt test_writeGolden)", () => {
    expect(golden, FILE).not.toBeNull();
  });
});
