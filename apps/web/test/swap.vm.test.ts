import { describe, expect, it, vi } from "vitest";
import { lookup, type Scope } from "../src/lib/tpl";
import { logoFill } from "../src/lib/logos";
import type { AssetView } from "../src/screens/asset.api";
import { recvFmt, swapVM, type SwapInput } from "../src/screens/swap.vm";

const L = (v: Scope, p: string): unknown => lookup(p, v);
const LA = (v: Scope, p: string): Record<string, unknown>[] => lookup(p, v) as Record<string, unknown>[];
const F = (v: Scope, p: string): (() => void) => lookup(p, v) as () => void;
const NOW = 1_763_000_000;

const asset = (id: string, sym: string, name: string, kind: AssetView["kind"], usd: number | null, decimals: number, addr: string, fresh = true): AssetView => ({
  id,
  symbol: sym,
  displaySymbol: sym,
  name,
  kind,
  tier: null,
  decimals,
  color: "#123456",
  logoURI: null,
  badge: null,
  dataSource: "",
  display: { chain: "avalanche", address: null },
  execution: { network: "fuji", address: addr, symbol: kind === "stock" ? `p${sym}` : sym },
  price: usd === null ? null : { usd, ts: NOW - 400, source: "x", fresh },
  risk: null,
});
const USDC = asset("usdc", "USDC", "USD Coin", "quote", null, 6, "0x5425000000000000000000000000000000001965");
const NVDA = asset("nvda", "NVDA", "NVIDIA", "stock", 169.95, 18, "0x8a1f00000000000000000000000000000000c210");
const BTC = asset("btcb", "BTC.b", "Bitcoin", "token", 74357, 8, "0x152b00000000000000000000000000000000f3c4");

function input(over: Partial<SwapInput> = {}): SwapInput {
  return {
    assets: [USDC, NVDA, BTC],
    search: { data: null, error: null },
    ui: { from: "usdc", to: "nvda", amt: "1000", pick: null, q: "" },
    quote: { data: null, error: null },
    tx: { status: "idle" },
    wallet: { connected: true, chainOk: true },
    env: { network: "fuji", explorer: "", nowSec: NOW, deployed: true, swapFeeBps: 10 },
    actions: { setAmt: vi.fn(), setQ: vi.fn(), open: vi.fn(), close: vi.fn(), choose: vi.fn(), flip: vi.fn(), submit: vi.fn(), connect: vi.fn(), switchChain: vi.fn() },
    me: { short: "", balanceS: "—", address: null },
    ...over,
  };
}

describe("swapVM", () => {
  it("swap card from registry data and quote", () => {
    const q = { blockNumber: "1", amountIn: "1000000000", amountOut: "5866000000000000000", fee: "1000000", minOut: "1" };
    const v = swapVM(input({ quote: { data: q, error: null } }));
    expect(L(v, "swapping")).toBe(true);
    // both have logos: the avatars show them instead of the initials
    expect(L(v, "from")).toMatchObject({ sym: "USDC", ini: "", avBg: logoFill("usdc") });
    expect(L(v, "to")).toMatchObject({ sym: "NVDA", ini: "", avBg: logoFill("nvda") });
    expect(L(v, "fromUsd")).toBe("$1,000.00");
    expect(L(v, "recv")).toBe("5.8660");
    expect(L(v, "fee")).toBe("$1.00");
    expect(L(v, "route")).toBe("Pantado stock venue");
    expect(L(v, "rate")).toBe("1 NVDA = 170.4739 USDC");
    const submit = vi.fn();
    F(swapVM(input({ quote: { data: q, error: null }, actions: { ...input().actions, submit } })), "go")();
    expect(submit).toHaveBeenCalled();
  });

  it("no quote yet → instant estimate on screen, but go does nothing (nothing signs on an estimate)", () => {
    const submit = vi.fn();
    const v = swapVM(input({ actions: { ...input().actions, submit } }));
    // 1000 USDC − 0.10 % fee at $169.95 (no spread in this fixture)
    expect(Number(String(L(v, "recv")).replace(/,/g, ""))).toBeCloseTo(999 / 169.95, 3);
    expect(L(v, "fee")).toBe("$1.00");
    F(v, "go")();
    expect(submit).not.toHaveBeenCalled();
    // no price for an asset → no estimate
    const unpriced = swapVM(input({ assets: [USDC, { ...NVDA, price: null }] }));
    expect(L(unpriced, "recv")).toBe("—");
  });

  it("picker lists registry assets except the other side", () => {
    const v = swapVM(input({ ui: { from: "usdc", to: "nvda", amt: "1", pick: "to", q: "" } }));
    expect(L(v, "picking")).toBe(true);
    expect(L(v, "pickTitle")).toBe("You receive");
    expect(LA(v, "results").map((r) => r.sym)).toEqual(["NVDA", "BTC.b"]);
    expect(LA(v, "results")[1]).toMatchObject({ name: "Bitcoin", addr: "0x152b…f3c4", px: "$74,357" });
  });

  it("search by text uses the API result; unknown contract address shows the registry message", () => {
    const hit = swapVM(input({ ui: { from: "usdc", to: "nvda", amt: "1", pick: "to", q: "bit" }, search: { data: [BTC], error: null } }));
    expect(LA(hit, "results").map((r) => r.sym)).toEqual(["BTC.b"]);
    const addr = swapVM(input({ ui: { from: "usdc", to: "nvda", amt: "1", pick: "to", q: "0xdead" }, search: { data: null, error: { code: "NotListed", message: "No listed asset at this contract address" } } }));
    expect(L(addr, "none")).toBe(true);
    expect(L(addr, "noneText")).toBe("No listed asset at this contract address. Pantado only trades assets in its registry.");
    const txt = swapVM(input({ ui: { from: "usdc", to: "nvda", amt: "1", pick: "to", q: "zzz" }, search: { data: [], error: null } }));
    expect(L(txt, "noneText")).toBe("No stock or token matches “zzz”.");
    const loading = swapVM(input({ ui: { from: "usdc", to: "nvda", amt: "1", pick: "to", q: "zzz" } }));
    expect(L(loading, "none")).toBe(false);
  });

  it("stale price and tx states", () => {
    const stale = swapVM(input({ assets: [USDC, { ...NVDA, price: { ...NVDA.price!, fresh: false } }, BTC] }));
    expect(L(stale, "done")).toBe(true);
    expect(LA(stale, "notices")[0]).toMatchObject({ tone: "amber", title: "NVDA price is 6 minutes old." });
    const fromQuote = swapVM(input({ quote: { data: null, error: { code: "PriceStale", message: "stale" } } }));
    expect(LA(fromQuote, "notices")[0]!.tone).toBe("amber");
    const failed = swapVM(input({ tx: { status: "failed", error: { code: "Slippage", message: "The price moved beyond your limit." } } }));
    expect(L(failed, "status")).toMatchObject({ title: "Swap failed", sub: "The price moved beyond your limit." });
  });

  it("wrong network → switch", () => {
    const switchChain = vi.fn();
    const v = swapVM(input({ wallet: { connected: true, chainOk: false }, actions: { ...input().actions, switchChain } }));
    F(v, "go")();
    expect(switchChain).toHaveBeenCalled();
    expect(LA(v, "notices")[0]!.title).toBe("Your wallet is on another network.");
  });

  it("recvFmt like the reference", () => {
    expect(recvFmt(1234.567)).toBe("1,234.57");
    expect(recvFmt(5.86601)).toBe("5.8660");
    expect(recvFmt(0.0123456)).toBe("0.012346");
  });
});
