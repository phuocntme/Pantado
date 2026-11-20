import { describe, expect, it } from "vitest";
import type { PublicClient } from "viem";
import { buySpends, previewBuy, previewSell, sellAmounts, type Deployment } from "@pantado/shared";
import { quoteDexLegs, type IndexState } from "../src/chain-state.js";

const DEX = "0x00000000000000000000000000000000000000d0";
const USDC = "0x00000000000000000000000000000000000000c0";
const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000b2";
const WAD = 10n ** 18n;

const dep = { contracts: { usdc: USDC, dexVenue: DEX } } as unknown as Deployment;
const state = (): IndexState => ({
  blockNumber: 77n,
  legs: [],
  state: {
    supply: 10n * WAD,
    tradeFeeBps: 50,
    deadUnits: 0n,
    startLevelUsd: 100n,
    usdcDecimals: 6,
    usdcVenueInventory: { "0xtoken": 10n ** 15n },
    legs: [
      { asset: A, decimals: 18, balance: 5n * WAD, targetBps: 5000, fresh: true, venue: DEX, market: { kind: "dex", decimals: 18, priceWad: 7n * WAD, buyOut: {}, sellOut: {} } },
      { asset: B, decimals: 18, balance: 35n * WAD, targetBps: 5000, fresh: true, venue: "0xtoken", market: { kind: "token", decimals: 18, spreadBps: 30, priceWad: WAD, inventoryOut: 10n ** 30n } },
    ],
  },
});

describe("DEX quotes for basket plans", () => {
  it("asks DexVenue.quote at the state's block for exactly the planned amounts, DEX legs only", async () => {
    const calls: { args: readonly unknown[]; blockNumber: bigint }[] = [];
    const client = {
      readContract: async ({ args, blockNumber }: { args: readonly unknown[]; blockNumber: bigint }) => {
        calls.push({ args, blockNumber });
        return 3n * WAD;
      },
    } as unknown as PublicClient;
    const st = state();
    const spends = buySpends(st.state, 100_000_000n);
    await quoteDexLegs(client, dep, st, spends, "buy");
    expect(calls).toEqual([{ args: [USDC, A, spends[0]], blockNumber: 77n }]);
    expect(previewBuy(st.state, 100_000_000n).outs[0]).toBe(3n * WAD);

    calls.length = 0;
    const amounts = sellAmounts(st.state, WAD);
    await quoteDexLegs(client, dep, st, amounts, "sell");
    expect(calls).toEqual([{ args: [A, USDC, amounts[0]], blockNumber: 77n }]);
    expect(previewSell(st.state, WAD).gross).toBeGreaterThan(3n * WAD);
  });

  it("no DEX venue in the deployment (test networks): nothing to ask", async () => {
    let n = 0;
    const client = { readContract: async () => (n++, 0n) } as unknown as PublicClient;
    await quoteDexLegs(client, { contracts: { usdc: USDC } } as unknown as Deployment, state(), [1n, 1n], "buy");
    expect(n).toBe(0);
  });
});
