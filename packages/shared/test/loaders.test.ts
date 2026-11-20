import { describe, expect, it } from "vitest";
import {
  ConfigError,
  loadAssets,
  loadDemoIndexes,
  loadParams,
  loadProfile,
  loadServices,
  profileName,
} from "../src/index.js";
import { getAt, ROOT, setAt, tempRoot } from "./helpers.js";

/** Position of NVDA in config/assets.json (the bad-config cases edit a stock). */
const NVDA = loadAssets({ root: ROOT }).findIndex((a) => a.id === "nvda");

describe("loaders on the real config", () => {
  it("loads assets.json: 25 stocks, 35 tokens (spec §4's five first, B69), 1 quote", () => {
    const assets = loadAssets({ root: ROOT });
    expect(assets.filter((a) => a.kind === "stock")).toHaveLength(25);
    expect(assets.filter((a) => a.kind === "token").map((a) => a.id)).toEqual([
      "wavax", "btcb", "wethe", "savax", "joe",
      "usdt", "eurc", "phar", "ausd", "usde", "wbtce", "super", "coq", "black", "aavee",
      "xava", "qi", "png", "arena", "frax", "daie", "gohm", "mim", "beam", "linke",
      "spcm", "nya", "peak", "p33", "nochill", "kimbo", "folks", "mqt", "solvbtc", "xaut0",
    ]);
    // every token is priced from a confirmed mainnet address
    for (const a of assets) if (a.kind === "token") expect(a.display.confirmed && a.display.chain === "avalanche").toBe(true);
    expect(assets.filter((a) => a.kind === "quote").map((a) => a.id)).toEqual(["usdc"]);
  });

  it("stock tiers carry the caps from spec §6", () => {
    for (const a of loadAssets({ root: ROOT })) {
      if (a.kind !== "stock") continue;
      expect(a.risk).toEqual(
        a.tier === 1
          ? { sizeCapUsd: 25_000, oiCapUsd: 250_000, spreadBps: 15 }
          : { sizeCapUsd: 5_000, oiCapUsd: 50_000, spreadBps: 15 },
      );
      expect(a.display.badge).toBe("Reference market: Robinhood Chain (on-chain)");
    }
  });

  it("loads both profiles", () => {
    expect(loadProfile("contest", { root: ROOT }).execution.chainId).toBe(43113);
    expect(loadProfile("production", { root: ROOT }).execution.chainId).toBe(43114);
  });

  it("profile defaults to PANTADO_PROFILE then contest", () => {
    const prev = process.env.PANTADO_PROFILE;
    delete process.env.PANTADO_PROFILE;
    expect(profileName()).toBe("contest");
    process.env.PANTADO_PROFILE = "production";
    expect(profileName()).toBe("production");
    process.env.PANTADO_PROFILE = "mainnet";
    expect(() => profileName()).toThrow(ConfigError);
    if (prev === undefined) delete process.env.PANTADO_PROFILE;
    else process.env.PANTADO_PROFILE = prev;
  });

  it("loads services.json and params.json", () => {
    expect(loadServices({ root: ROOT }).marketData.deviationBps).toBe(200);
    const p = loadParams({ root: ROOT });
    expect(p.vault.tradeFeeBps).toBe(50);
    expect(p.fees).toEqual({ protocolBps: 30, creatorBps: 20 });
    expect(p.rebalancer.noticeSec).toBe(172_800);
  });

  it("loads demo indexes and checks them against the registry", () => {
    const ix = loadDemoIndexes({ root: ROOT }).indexes;
    expect(ix.map((i) => i.ticker)).toEqual(["TBB", "CHIP", "MAG7", "CSTK", "MYBK", "AVDEX", "AVBLU", "AVMEME", "DEFI", "HEDGE", "WSAVX"]);
    // the community indexes: each by its own demo wallet, with a description the factory accepts
    const community = ix.slice(5);
    expect(new Set(community.map((i) => i.owner)).size).toBe(community.length);
    for (const i of community) {
      expect(i.owner).toMatch(/^demo-[1-9]$/);
      expect(new TextEncoder().encode(i.description ?? "").length).toBeGreaterThan(0);
      expect(new TextEncoder().encode(i.description ?? "").length).toBeLessThanOrEqual(1024);
      for (const b of i.buys ?? []) expect(b.by).not.toBe(i.owner);
    }
  });
});

describe("loaders reject bad config with a typed error", () => {
  const expectIssue = (fn: () => unknown, needle: string): void => {
    try {
      fn();
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as ConfigError).issues.join("\n")).toContain(needle);
      return;
    }
    throw new Error("expected ConfigError");
  };

  it("duplicate asset id", () => {
    const root = tempRoot();
    setAt(root, "config/assets.json", "assets.31", getAt(root, "config/assets.json", "assets.1"));
    expectIssue(() => loadAssets({ root }), "duplicate id wavax");
  });

  it("id that does not match the symbol", () => {
    const root = tempRoot();
    setAt(root, "config/assets.json", "assets.2.id", "btc");
    expectIssue(() => loadAssets({ root }), "must be btcb");
  });

  it("demo index description longer than the factory takes, or an unknown owner", () => {
    const root = tempRoot();
    setAt(root, "config/indexes.contest.json", "indexes.5.description", "🔥".repeat(257)); // 1028 bytes
    expectIssue(() => loadDemoIndexes({ root }), "at most 1024 bytes");
    const root2 = tempRoot();
    setAt(root2, "config/indexes.contest.json", "indexes.5.owner", "someone");
    expectIssue(() => loadDemoIndexes({ root: root2 }), "owner");
  });

  it("seed price outside the band", () => {
    const root = tempRoot();
    setAt(root, "config/assets.json", `assets.${NVDA}.price.seedUsd`, "9999");
    expectIssue(() => loadAssets({ root }), "inside the band");
  });

  it("wrong pToken symbol", () => {
    const root = tempRoot();
    setAt(root, "config/assets.json", `assets.${NVDA}.execution.fuji.pToken`, "pXYZ");
    expectIssue(() => loadAssets({ root }), "pToken must be pNVDA");
  });

  it("unknown key in a profile", () => {
    const root = tempRoot();
    setAt(root, "config/networks/contest.json", "flags.extra", true);
    expectIssue(() => loadProfile("contest", { root }), "flags");
  });

  it("fee split that does not add up", () => {
    const root = tempRoot();
    setAt(root, "contracts/config/params.json", "fees.creatorBps", 25);
    expectIssue(() => loadParams({ root }), "must equal vault.tradeFeeBps");
  });

  it("demo index with unknown asset or bad weights", () => {
    const root = tempRoot();
    setAt(root, "config/indexes.contest.json", "indexes.0.components", { nvda: 5000, zzz: 5000 });
    expectIssue(() => loadDemoIndexes({ root }), "unknown asset zzz");
    setAt(root, "config/indexes.contest.json", "indexes.0.components", { nvda: 5000, aapl: 4000 });
    expectIssue(() => loadDemoIndexes({ root }), "sum to 10000");
  });

  it("malformed JSON", () => {
    expectIssue(() => loadServices({ root: "/nonexistent" }), "ENOENT");
  });
});
