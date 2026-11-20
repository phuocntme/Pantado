import { Registry } from "prom-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { erc20Abi } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { ANVIL_KEYS, hasFoundry, startAnvilWithDeployment, type AnvilEnv } from "@pantado/sdk/testing";
import { createChainContext, createLogger } from "@pantado/service-kit";
import { AutoFunder, createFundServer } from "../src/funder.js";
import { MemoryStore } from "../src/store.js";

const run = hasFoundry() ? describe : describe.skip;
const keeper = privateKeyToAccount(ANVIL_KEYS[2]);

run("auto-fund on Anvil", () => {
  let env: AnvilEnv;
  beforeAll(async () => {
    env = await startAnvilWithDeployment({ autoFund: keeper.address });
  }, 180_000);
  afterAll(() => env?.stop());

  it("funds a new wallet once, rejects bad auth", async () => {
    const ctx = createChainContext({ profile: "contest", rpcUrl: env.rpcUrl, deployment: env.deployment });
    const f = new AutoFunder(
      ctx,
      keeper,
      new MemoryStore(),
      { usdc: "10000", avax: "0.5", embeddedAvax: "0", secret: "s3cret", network: "anvil", minKeeperAvax: "0.5" },
      createLogger("test"),
      new Registry(),
    );
    const server = createFundServer(f);
    await new Promise<void>((r) => server.listen(0, r));
    const addr = server.address();
    const url = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/fund`;
    const user = privateKeyToAccount(generatePrivateKey()).address;
    const post = (auth: string, body: unknown) =>
      fetch(url, { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify(body) });

    expect((await post("Bearer wrong", { address: user })).status).toBe(401);
    expect((await post("Bearer s3cret", { address: "0x123" })).status).toBe(400);
    const r1 = await post("Bearer s3cret", { address: user });
    expect(r1.status).toBe(200);
    expect(await r1.json()).toMatchObject({ status: "funded" });
    const usdc = await ctx.publicClient.readContract({ address: env.deployment.contracts.usdc, abi: erc20Abi, functionName: "balanceOf", args: [user] });
    expect(usdc).toBe(10_000_000_000n);
    expect(await ctx.publicClient.getBalance({ address: user })).toBe(500_000_000_000_000_000n);
    const r2 = await post("Bearer s3cret", { address: user.toLowerCase() });
    expect(await r2.json()).toMatchObject({ status: "already-funded" });
    expect((await f.health()).ok).toBe(true);
    server.close();
  }, 120_000);

  it("with avax \"0\" mints test USDC only (gas comes from the public faucet)", async () => {
    const ctx = createChainContext({ profile: "contest", rpcUrl: env.rpcUrl, deployment: env.deployment });
    const f = new AutoFunder(ctx, keeper, new MemoryStore(), { usdc: "10000", avax: "0", embeddedAvax: "0.005", secret: "s3cret", network: "anvil", minKeeperAvax: "0.5" }, createLogger("test"), new Registry());
    const user = privateKeyToAccount(generatePrivateKey()).address;
    const r = await f.fund(user);
    expect(r).toMatchObject({ status: "funded", avaxTx: null });
    const usdc = await ctx.publicClient.readContract({ address: env.deployment.contracts.usdc, abi: erc20Abi, functionName: "balanceOf", args: [user] });
    expect(usdc).toBe(10_000_000_000n);
    expect(await ctx.publicClient.getBalance({ address: user })).toBe(0n);
  }, 120_000);

  it("gas AVAX only for a verified embedded-wallet user: once per user, once per wallet, even after its USDC", async () => {
    const ctx = createChainContext({ profile: "contest", rpcUrl: env.rpcUrl, deployment: env.deployment });
    const f = new AutoFunder(ctx, keeper, new MemoryStore(), { usdc: "10000", avax: "0", embeddedAvax: "0.005", secret: "s3cret", network: "anvil", minKeeperAvax: "0.5" }, createLogger("test"), new Registry());
    const [a, b] = [privateKeyToAccount(generatePrivateKey()).address, privateKeyToAccount(generatePrivateKey()).address];
    // signed in before gas existed: USDC only
    await f.fund(a);
    expect(await ctx.publicClient.getBalance({ address: a })).toBe(0n);
    // the same wallet, now with a verified Privy user: gas, no second USDC
    expect(await f.fund(a, "did:privy:u1")).toMatchObject({ status: "funded", usdcTx: null });
    expect(await ctx.publicClient.getBalance({ address: a })).toBe(5_000_000_000_000_000n);
    const usdc = await ctx.publicClient.readContract({ address: env.deployment.contracts.usdc, abi: erc20Abi, functionName: "balanceOf", args: [a] });
    expect(usdc).toBe(10_000_000_000n);
    expect(await f.fund(a, "did:privy:u1")).toMatchObject({ status: "already-funded" });
    // the same user with another address: USDC, no more gas
    await f.fund(b, "did:privy:u1");
    expect(await ctx.publicClient.getBalance({ address: b })).toBe(0n);
    // another user on an address that already had gas: none
    expect(await f.fund(a, "did:privy:u2")).toMatchObject({ status: "already-funded" });
  }, 120_000);
});
