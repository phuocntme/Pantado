import { describe, expect, it } from "vitest";
import { privateVM, showPrivate } from "../src/screens/private.vm";
import type { IndexInput } from "../src/screens/index.vm";
import { assets, board, comp, detail, holders, levels, me, NOW, reb, stranger, txs } from "../src/screens/index.fixtures";

const noop = { setTab: () => undefined, setSide: () => undefined, setAmt: () => undefined };
const priv = detail({ name: "My basket", ticker: "MYBK", isPublic: false, visibility: "private" });
const input = (over: Partial<IndexInput> = {}): IndexInput => ({
  detail: priv,
  comp: comp(),
  txs,
  reb: reb(),
  holders,
  levels,
  assets,
  board,
  quote: null,
  quoteError: null,
  assess: null,
  now: NOW,
  me,
  ...over,
});

describe("private index", () => {
  it("shows the private screen only to the creator of a private index", () => {
    expect(showPrivate(priv, me.address)).toBe(true);
    expect(showPrivate(priv, me.address?.toUpperCase().replace("0X", "0x") ?? null)).toBe(true);
    expect(showPrivate(priv, stranger.address)).toBe(false);
    expect(showPrivate(priv, null)).toBe(false);
    expect(showPrivate(detail(), me.address)).toBe(false);
    expect(showPrivate(null, me.address)).toBe(false);
  });

  it("adds Make public to the index view model", () => {
    let called = 0;
    const st = { tab: "Composition" as const, side: "Buy" as const, amt: "1000" };
    const v = privateVM(input(), st, noop, "private", () => called++);
    expect(v.name).toBe("My basket");
    expect(v.ticker).toBe("MYBK");
    expect(v.pubLabel).toBe("Make public");
    expect(v._href).toEqual({ Version: `/version/${priv.id}` });
    v.makePublic();
    expect(called).toBe(1);
    expect(privateVM(input(), st, noop, "pending", () => called++).pubLabel).toBe("Confirm in your wallet");
    const done = privateVM(input(), st, noop, "public", () => called++);
    expect(done.pubLabel).toBe("Public · in Marketplace");
    done.makePublic();
    expect(called).toBe(1);
  });
});
