import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appAssetsFileSchema,
  contractAssetsFileSchema,
  findRepoRoot,
  indexerWhitelistsSchema,
  loadAssets,
  loadProfile,
} from "@pantado/shared";
import { dexRoutesFile, generateAll, OUTPUT } from "../lib/gen.js";

const ROOT = findRepoRoot();
const files = generateAll(ROOT);
const parse = (rel: string): unknown => JSON.parse(files.get(rel) ?? "null");

describe("gen-config", () => {
  it("emits one contract file per execution network, the mainnet DEX routes, and the indexer and app lists", () => {
    expect([...files.keys()].sort()).toEqual(
      [
        OUTPUT.appAssets,
        OUTPUT.contractAssets("avalanche"),
        OUTPUT.contractAssets("fuji"),
        OUTPUT.dexRoutes("avalanche"),
        OUTPUT.indexerWhitelists,
      ].sort(),
    );
  });

  it("DEX routes chain each token to USDC through confirmed v2 / liquidity-book pools; others are refused", () => {
    const routes = parse(OUTPUT.dexRoutes("avalanche")) as { routes: { asset: string; pools: string[]; kinds: number[]; fees: number[] }[] };
    expect(routes.routes.length).toBe(30);
    for (const r of routes.routes) {
      expect(r.pools.length).toBe(r.kinds.length);
      expect(r.kinds.every((k) => k === 0 || k === 1 || k === 2)).toBe(true);
      r.kinds.forEach((k, i) => expect(k === 0 ? (r.fees[i] ?? 0) > 0 : r.fees[i] === 0).toBe(true));
    }
    // tokens only on concentrated-liquidity pools have no on-chain view quote: not routed
    for (const id of ["usde", "nya", "peak", "mqt", "xaut0"]) expect(routes.routes.some((r) => r.asset === id)).toBe(false);
    const profile = loadProfile("production", { root: ROOT });
    const bad = (dexRoutes: Record<string, `0x${string}`[]>) => () =>
      dexRoutesFile(loadAssets({ root: ROOT }), { ...profile, execution: { ...profile.execution, dexRoutes } });
    const joeWavax = "0x454E67025631C065d3cFAD6d71E6892f74487a15"; // joe/wavax v2, no `amm` → no venue math
    expect(bad({ joe: ["0x3bc40d4307cD946157447CD55d70ee7495bA6140", "0xf4003F4efBE8691B60249E6afbD307aBE7758adb"] })).toThrow(/ends in wavax, not usdc/);
    expect(bad({ joe: [joeWavax] })).toThrow(/no on-chain quote|ends in wavax/);
    expect(bad({ nya: ["0x0000000000000000000000000000000000000001"] })).toThrow(/not a confirmed data pool/);
  });

  it("checked-in generated files are up to date", () => {
    for (const [rel, text] of files) {
      const path = join(ROOT, rel);
      expect(existsSync(path), rel).toBe(true);
      expect(readFileSync(path, "utf8"), rel).toBe(text);
    }
  });

  it("fuji contract assets validate and keep alphabetical keys for vm.parseJson", () => {
    const f = contractAssetsFileSchema.parse(parse(OUTPUT.contractAssets("fuji")));
    expect(f.chainId).toBe(43113);
    expect(f.assets).toHaveLength(loadAssets({ root: ROOT }).length);
    expect(f.assets[0]?.id).toBe("usdc");
    for (const a of f.assets) {
      const keys = Object.keys(a);
      expect(keys).toEqual([...keys].sort());
    }
    const nvda = f.assets.find((a) => a.id === "nvda");
    expect(nvda).toMatchObject({
      addr: "deploy",
      symbol: "pNVDA",
      pTokenName: "Pantado NVIDIA",
      // seedUsd × 1e18 (seeds follow the market via refresh:seeds, so read it from the config)
      priceE18: (BigInt(Math.round(Number(loadAssets({ root: ROOT }).find((a) => a.id === "nvda")?.price.seedUsd) * 1e6)) * 10n ** 12n).toString(),
      sizeCapUsd: 25000,
      oiCapUsd: 250000,
      spreadBps: 15,
      venue: "stock-venue",
      tier: 1,
    });
    const btcb = f.assets.find((a) => a.id === "btcb");
    expect(btcb).toMatchObject({ mock: true, decimals: 8, venue: "token-venue", spreadBps: 30 });
  });

  it("avalanche contract assets never carry an unconfirmed address", () => {
    const f = contractAssetsFileSchema.parse(parse(OUTPUT.contractAssets("avalanche")));
    const raw = loadAssets({ root: ROOT });
    for (const a of f.assets) {
      if (a.kind === "stock") continue;
      const src = raw.find((r) => r.id === a.id);
      const confirmed = src?.execution.avalanche.confirmed === true;
      if (!confirmed) expect(a.addr).toBe("TODO");
      expect(a.mock).toBe(false);
    }
    expect(f.assets.find((a) => a.id === "btcb")?.venue).toBe("dex-venue");
  });

  it("indexer whitelists hold only confirmed addresses", () => {
    const w = indexerWhitelistsSchema.parse(parse(OUTPUT.indexerWhitelists));
    const total = w.avalanche.tokens.length + w.avalanche.pending.length;
    expect(total).toBe(36); // 35 tokens + USDC
    expect(w.avalanche.pending).toEqual([]); // every token address is confirmed
    expect(w.robinhood.stocks.length + w.robinhood.pending.length).toBe(25);
    expect(w.execution.find((e) => e.id === "nvda")?.symbol).toBe("pNVDA");
  });

  it("app list shows WAVAX as AVAX and stocks with the reference badge", () => {
    const f = appAssetsFileSchema.parse(parse(OUTPUT.appAssets));
    expect(f.assets.find((a) => a.id === "wavax")?.displaySymbol).toBe("AVAX");
    for (const a of f.assets.filter((x) => x.kind === "stock"))
      expect(a.badge).toBe("Reference market: Robinhood Chain (on-chain)");
  });
});
