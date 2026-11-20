/**
 * Creates the demo indexes in config/indexes.contest.json (idempotent: existing tickers are skipped), then the
 * listed follow-up buys (each once: skipped when that wallet already holds the index).
 * Owner "deployer" → DEPLOYER_PRIVATE_KEY, "agent-manager" → AGENT_MANAGER_KEY, "demo-N" → DEMO_WALLET_N.
 * Test USDC is minted by the deployer (USDC owner); demo wallets get a little gas AVAX from the deployer.
 * Testnet keys only. Env: PANTADO_PROFILE, EXECUTION_RPC_URL (optional).
 */
import { encodeFunctionData, erc20Abi, keccak256, parseEther, parseUnits, toBytes, type Account, type Address, type Hex } from "viem";
import { indexFactoryAbi, testERC20Abi, toPantadoError, tx, type TxRequest } from "@pantado/sdk";
import { createChainContext, testnetAccount } from "@pantado/service-kit";
import { loadDemoIndexes, loadParams } from "@pantado/shared";

const MODE = { Off: 0, Manual: 1, Auto: 2 } as const;
/** gas a demo wallet is topped up to before it trades */
const DEMO_GAS = parseEther("0.03");

async function main(): Promise<void> {
  const ctx = createChainContext();
  const deployer = testnetAccount("DEPLOYER_PRIVATE_KEY", ctx.chain.id);
  const c = ctx.deployment.contracts;
  const creationFee = BigInt(loadParams().factory.creationFeeUsdc) * 10n ** 6n;
  const accounts = new Map<string, Account>([["deployer", deployer]]);
  const who = (name: string): Account | null => {
    const known = accounts.get(name);
    if (known) return known;
    const env = name === "agent-manager" ? "AGENT_MANAGER_KEY" : `DEMO_WALLET_${name.slice(5)}`;
    if (!process.env[env]) return null;
    const a = testnetAccount(env, ctx.chain.id);
    accounts.set(name, a);
    return a;
  };

  const send = async (account: Account, req: { to: Address; data: Hex; value?: bigint }): Promise<void> => {
    await ctx.publicClient.call({ account, to: req.to, data: req.data, value: req.value });
    const hash = await ctx.wallet(account).sendTransaction({ ...req, account, chain: ctx.chain });
    const rc = await ctx.publicClient.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") throw new Error(`reverted ${hash}`);
  };
  const gasUp = async (a: Account): Promise<void> => {
    if (a.address === deployer.address) return;
    const bal = await ctx.publicClient.getBalance({ address: a.address });
    if (bal < DEMO_GAS / 2n) await send(deployer, { to: a.address, data: "0x", value: DEMO_GAS - bal });
  };
  const usdcFor = async (a: Account, amount: bigint, spender: Address): Promise<void> => {
    await gasUp(a);
    await send(deployer, { to: c.usdc, data: encodeFunctionData({ abi: testERC20Abi, functionName: "mint", args: [a.address, amount] }) });
    const approve: TxRequest = tx.approve(c.usdc, spender, amount);
    await send(a, approve);
  };

  for (const ix of loadDemoIndexes().indexes) {
    const owner = who(ix.owner ?? "deployer");
    if (!owner) {
      console.log(`skip ${ix.ticker}: no key for ${ix.owner}`);
      continue;
    }
    if (!(await ctx.reader.isTickerTaken(ix.ticker))) {
      const usdcIn = parseUnits(ix.firstBuyUsd, 6);
      const assets = Object.keys(ix.components).map((id) => {
        const a = ctx.deployment.assets[id];
        if (!a) throw new Error(`${ix.id}: ${id} not deployed`);
        return a;
      });
      try {
        await usdcFor(owner, usdcIn + creationFee, c.factory);
        await send(
          owner,
          tx.createAndBuy(c.factory, {
            name: ix.name,
            ticker: ix.ticker,
            description: ix.description ?? "",
            assets,
            weightsBps: Object.values(ix.components),
            mode: MODE[ix.mode],
            driftBps: ix.mode === "Auto" ? (ix.driftBps ?? 0) : 0,
            isPublic: ix.visibility === "public",
            usdcIn,
            minUnits: 0n,
          }),
        );
        console.log(`created ${ix.ticker} (${ix.visibility}, ${ix.mode}) owner ${owner.address}`);
      } catch (e) {
        console.error(`${ix.ticker}: ${toPantadoError(e).message}`);
        process.exitCode = 1;
        continue;
      }
    } else console.log(`skip create ${ix.ticker} (exists)`);

    if (!ix.buys?.length) continue;
    const index = (await ctx.publicClient.readContract({
      address: c.factory,
      abi: indexFactoryAbi,
      functionName: "indexByTicker",
      args: [keccak256(toBytes(ix.ticker))],
    })) as Address;
    for (const b of ix.buys) {
      const buyer = who(b.by);
      if (!buyer) continue;
      const held = await ctx.publicClient.readContract({ address: index, abi: erc20Abi, functionName: "balanceOf", args: [buyer.address] });
      if (held > 0n) continue;
      try {
        const usd = parseUnits(b.usd, 6);
        await usdcFor(buyer, usd, index);
        await send(buyer, tx.buy(index, usd, 0n, buyer.address));
        console.log(`  ${b.by} bought ${ix.ticker} for $${b.usd}`);
      } catch (e) {
        console.error(`  ${ix.ticker} buy by ${b.by}: ${toPantadoError(e).message}`);
        process.exitCode = 1;
      }
    }
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
