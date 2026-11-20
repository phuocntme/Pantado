import { Counter } from "prom-client";
import { describe, expect, it } from "vitest";
import { createLogger, runLoop, startHealthServer, testnetAccount, EnvError } from "../src/index.js";

describe("health server", () => {
  it("serves /health and /metrics", async () => {
    let ok = true;
    const hs = await startHealthServer({ service: "t", port: 0, health: () => ({ ok, lastTick: 1n }) });
    const c = new Counter({ name: "t_ticks_total", help: "ticks", registers: [hs.registry] });
    c.inc();
    const h = await fetch(`http://127.0.0.1:${hs.port}/health`);
    expect(h.status).toBe(200);
    expect(await h.json()).toMatchObject({ service: "t", ok: true, lastTick: "1" });
    ok = false;
    expect((await fetch(`http://127.0.0.1:${hs.port}/health`)).status).toBe(503);
    const m = await (await fetch(`http://127.0.0.1:${hs.port}/metrics`)).text();
    expect(m).toContain("t_ticks_total");
    await hs.close();
  });
});

describe("loop", () => {
  it("ticks and survives errors", async () => {
    let n = 0;
    const loop = runLoop("x", 5, async () => {
      n += 1;
      if (n === 2) throw new Error("boom");
    }, createLogger("t"));
    await new Promise((r) => setTimeout(r, 60));
    await loop.stop();
    expect(n).toBeGreaterThan(3);
  });
});

describe("testnet keys", () => {
  it("refuses mainnet", () => {
    process.env.T_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
    expect(() => testnetAccount("T_KEY", 43114)).toThrow(EnvError);
    expect(testnetAccount("T_KEY", 43113).address).toMatch(/^0x/);
  });
});
