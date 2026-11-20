import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

export class EnvError extends Error {
  override readonly name = "EnvError";
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new EnvError(`missing env ${name}`);
  return v;
}

export function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new EnvError(`env ${name} must be an integer`);
  return n;
}

/** Chain ids where keeper / agent-manager keys must never be used (testnet only). */
export const MAINNET_CHAIN_IDS: ReadonlySet<number> = new Set([43114, 1]);

/** Load a testnet-only key from env; refuses mainnet execution chains. */
export function testnetAccount(envName: string, chainId: number): PrivateKeyAccount {
  if (MAINNET_CHAIN_IDS.has(chainId)) {
    throw new EnvError(`${envName} is a testnet-only key; refusing to run on chain ${chainId}`);
  }
  const key = requireEnv(envName);
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new EnvError(`${envName} is not a 32-byte hex key`);
  return privateKeyToAccount(key as `0x${string}`);
}
