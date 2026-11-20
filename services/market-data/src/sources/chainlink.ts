import { parseAbi, type Address, type PublicClient } from "viem";

const AGG = parseAbi(["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"]);

/** Chainlink cross-check (spec §8). Only confirmed feeds are passed in. */
export async function readFeed(client: PublicClient, address: Address, decimals: number): Promise<{ usd: number; ts: number } | null> {
  const [, answer, , updatedAt] = await client.readContract({ address, abi: AGG, functionName: "latestRoundData" });
  if (answer <= 0n) return null;
  return { usd: Number(answer) / 10 ** decimals, ts: Number(updatedAt) };
}
