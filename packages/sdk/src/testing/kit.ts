import { createPublicClient, createWalletClient, encodeFunctionData, http, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import type { Deployment } from "@pantado/shared";
import { assetRegistryAbi, priceOracleAbi, testERC20Abi } from "../abis/index.js";
import { createReader, type PantadoReader } from "../reads.js";
import { tx, type CreateIndexInput } from "../tx.js";
import { ANVIL_KEYS } from "./anvil.js";

/** Test helpers over an Anvil deployment. Key #0 is the deployer (owner, pusher, USDC owner). */
export class TestKit {
  readonly pub: PublicClient;
  readonly reader: PantadoReader;
  constructor(
    readonly rpcUrl: string,
    readonly deployment: Deployment,
  ) {
    this.pub = createPublicClient({ chain: foundry, transport: http(rpcUrl) }) as PublicClient;
    this.reader = createReader(this.pub, deployment);
  }

  account(i = 0) {
    const key = ANVIL_KEYS[i];
    if (!key) throw new Error(`no anvil key ${i}`);
    return privateKeyToAccount(key);
  }

  async send(req: { to: Address; data: Hex }, keyIndex = 0): Promise<Hex> {
    const account = this.account(keyIndex);
    const w = createWalletClient({ account, chain: foundry, transport: http(this.rpcUrl) });
    const hash = await w.sendTransaction({ ...req, account, chain: foundry });
    const rc = await this.pub.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") throw new Error(`tx reverted ${hash}`);
    return hash;
  }

  asset(id: string): Address {
    const a = this.deployment.assets[id];
    if (!a) throw new Error(`unknown asset ${id}`);
    return a;
  }

  /** Mint test USDC (deployer is the owner) and approve `spender`. */
  async fundUsdc(keyIndex: number, amount: bigint, spender?: Address): Promise<void> {
    const to = this.account(keyIndex).address;
    const c = this.deployment.contracts;
    await this.send({ to: c.usdc, data: encodeFunctionData({ abi: testERC20Abi, functionName: "mint", args: [to, amount] }) }, 0);
    if (spender) await this.send(tx.approve(c.usdc, spender), keyIndex);
  }

  /** Re-push every registry asset at its current price (keeps prices fresh after time travel). */
  async refreshPrices(overrides: Record<string, bigint> = {}): Promise<void> {
    const c = this.deployment.contracts;
    const all = await this.pub.readContract({ address: c.assetRegistry, abi: assetRegistryAbi, functionName: "assets" });
    const prices = await Promise.all(
      all.map(async (a) => {
        const [p] = await this.pub.readContract({ address: c.oracle, abi: priceOracleAbi, functionName: "latest", args: [a] });
        return p;
      }),
    );
    for (const [id, p] of Object.entries(overrides)) {
      const idx = all.indexOf(this.asset(id));
      if (idx >= 0) prices[idx] = p;
    }
    await this.send(tx.pushPrices(c.oracle, [...all], prices));
  }

  /** Multiply one asset's price by num/den (scripted shock). */
  async shock(id: string, num: bigint, den: bigint): Promise<void> {
    const [p] = await this.reader.price(this.asset(id));
    await this.refreshPrices({ [id]: (p * num) / den });
  }

  async createIndex(keyIndex: number, p: Omit<CreateIndexInput, "assets"> & { assets: string[] }): Promise<Address> {
    const c = this.deployment.contracts;
    await this.fundUsdc(keyIndex, p.usdcIn + 10_000_000n, c.factory);
    await this.send(tx.createAndBuy(c.factory, { ...p, assets: p.assets.map((id) => this.asset(id)) }), keyIndex);
    return this.reader.indexByTicker(p.ticker);
  }

  async now(): Promise<number> {
    return Number((await this.pub.getBlock()).timestamp);
  }
}
