import { createPublicClient, createWalletClient, encodeFunctionData, http, parseUnits, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createReader, indexFactoryAbi, testERC20Abi, toPantadoError, tx } from "../src/index.js";
import { ANVIL_KEYS, hasFoundry, startAnvilWithDeployment, type AnvilEnv } from "../src/testing/anvil.js";

const run = hasFoundry() ? describe : describe.skip;

run("SDK on Anvil", () => {
  let env: AnvilEnv;
  beforeAll(async () => {
    env = await startAnvilWithDeployment();
  }, 180_000);
  afterAll(() => env?.stop());

  it("creates an index at level 100 and previews match", async () => {
    const pub = createPublicClient({ chain: foundry, transport: http(env.rpcUrl) });
    const account = privateKeyToAccount(ANVIL_KEYS[0]);
    const wallet = createWalletClient({ account, chain: foundry, transport: http(env.rpcUrl) });
    const r = createReader(pub, env.deployment);
    const { contracts: c, assets } = env.deployment;
    const send = async (req: { to: Address; data: `0x${string}` }) => {
      const hash = await wallet.sendTransaction({ ...req, account, chain: foundry });
      const rc = await pub.waitForTransactionReceipt({ hash });
      expect(rc.status).toBe("success");
      return rc;
    };

    await send({ to: c.usdc, data: encodeMint(account.address, parseUnits("50000", 6)) });
    await send(tx.approve(c.usdc, c.factory));
    const nvda = assets.nvda as Address;
    const btcb = assets.btcb as Address;
    await send(
      tx.createAndBuy(c.factory, {
        name: "SDK test",
        ticker: "SDK",
        description: "",
        assets: [nvda, btcb],
        weightsBps: [6000, 4000],
        mode: 1,
        driftBps: 0,
        isPublic: true,
        usdcIn: parseUnits("100", 6),
        minUnits: 0n,
      }),
    );
    const idx = await r.indexByTicker("SDK");
    const level = await r.level(idx);
    expect(level).toBeGreaterThan(99_999_999_000_000_000_000n);
    expect(level).toBeLessThan(100_000_001_000_000_000_000n);
    const summary = await r.index(idx);
    expect(summary).toMatchObject({ name: "SDK test", ticker: "SDK", isPublic: true, creator: account.address });

    const [units] = await r.previewBuy(idx, parseUnits("50", 6));
    await send(tx.approve(c.usdc, idx));
    await send(tx.buy(idx, parseUnits("50", 6), units, account.address));

    // a stock buy above the per-trade cap reverts with the UI message
    try {
      await pub.simulateContract({
        address: c.factory,
        abi: indexFactoryAbi,
        functionName: "createAndBuy",
        account: account.address,
        args: [
          {
            name: "Too big",
            ticker: "BIG",
            description: "",
            assets: [nvda, btcb],
            weightsBps: [9900, 100],
            mode: 0,
            driftBps: 0,
            isPublic: true,
            usdcIn: parseUnits("30000", 6),
            minUnits: 0n,
          },
        ],
      });
      throw new Error("expected revert");
    } catch (e) {
      const pe = toPantadoError(e);
      expect(pe.code).toBe("SizeCapExceeded");
    }
  }, 120_000);
});

function encodeMint(to: Address, amount: bigint): `0x${string}` {
  return encodeFunctionData({ abi: testERC20Abi, functionName: "mint", args: [to, amount] });
}
