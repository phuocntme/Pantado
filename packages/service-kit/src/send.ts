import type { Account, Address, Hex } from "viem";
import { toPantadoError, type PantadoError } from "@pantado/sdk";
import type { ChainContext } from "./chain.js";

export type SendResult = { ok: true; hash: Hex } | { ok: false; error: PantadoError };

/**
 * Simulate (eth_call) then send a call and wait for its receipt. A revert in simulation is returned as a
 * typed error and nothing is sent, so keepers racing each other never waste gas on doomed txs.
 */
export async function simulateAndSend(ctx: ChainContext, account: Account, req: { to: Address; data: Hex }): Promise<SendResult> {
  try {
    await ctx.publicClient.call({ account, to: req.to, data: req.data });
  } catch (e) {
    return { ok: false, error: toPantadoError(e) };
  }
  try {
    const hash = await ctx.wallet(account).sendTransaction({ ...req, account, chain: ctx.chain });
    const rc = await ctx.publicClient.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") return { ok: false, error: toPantadoError(new Error(`reverted ${hash}`)) };
    return { ok: true, hash };
  } catch (e) {
    return { ok: false, error: toPantadoError(e) };
  }
}

/** Every index address registered in the factory. */
export async function listIndexes(ctx: ChainContext): Promise<Address[]> {
  const n = await ctx.reader.indexCount();
  const out: Address[] = [];
  for (let off = 0n; off < n; off += 100n) out.push(...(await ctx.reader.indexes(off, 100n)));
  return out;
}
