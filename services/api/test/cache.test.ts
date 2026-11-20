import { describe, expect, it } from "vitest";
import { memoryCache, singleFlight } from "../src/deps.js";

describe("API cache", () => {
  it("concurrent misses of one key share a single computation (no pile-up behind a slow upstream)", async () => {
    const c = memoryCache();
    let runs = 0;
    let release = (): void => undefined;
    const slow = (): Promise<number> =>
      new Promise((r) => {
        runs++;
        release = () => r(42);
      });
    const calls = Array.from({ length: 20 }, () => c.wrap("board", 3, slow));
    await new Promise((r) => setTimeout(r, 10));
    release();
    expect(await Promise.all(calls)).toEqual(Array(20).fill(42));
    expect(runs).toBe(1);
    expect(await c.wrap("board", 3, slow)).toBe(42); // cached
    expect(runs).toBe(1);
  });
  it("a failed computation is not shared with the next caller", async () => {
    let n = 0;
    await expect(singleFlight("k", async () => { n++; throw new Error("rpc 429"); })).rejects.toThrow("rpc 429");
    expect(await singleFlight("k", async () => ++n)).toBe(2);
  });
});
