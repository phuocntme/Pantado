import type { Address, PublicClient } from "viem";
import { indexLensAbi } from "./abis/index.js";

export interface LevelCheck {
  index: Address;
  ticker: string;
  block: bigint;
  indexer: bigint;
  lens: bigint;
  diff: bigint;
  ok: boolean;
}

/**
 * level(indexer) vs level(IndexLens) at the same block (spec §9.4).
 * `indexerUrl` serves `/indexes` and `/levels/:index/latest` (services/indexer API).
 */
export async function checkLevels(opts: {
  indexerUrl: string;
  client: PublicClient;
  lens: Address;
  toleranceWei: bigint;
}): Promise<LevelCheck[]> {
  const get = async <T>(path: string): Promise<T> => {
    const r = await fetch(new URL(path, opts.indexerUrl));
    if (!r.ok) throw new Error(`indexer ${path}: ${r.status}`);
    return (await r.json()) as T;
  };
  const indexes = await get<{ id: Address; ticker: string }[]>("/indexes");
  const out: LevelCheck[] = [];
  for (const ix of indexes) {
    const l = await get<{ block: string; level: string }>(`/levels/${ix.id}/latest`);
    const block = BigInt(l.block);
    const lens = await opts.client.readContract({ address: opts.lens, abi: indexLensAbi, functionName: "level", args: [ix.id], blockNumber: block });
    const indexer = BigInt(l.level);
    const diff = indexer > lens ? indexer - lens : lens - indexer;
    out.push({ index: ix.id, ticker: ix.ticker, block, indexer, lens, diff, ok: diff <= opts.toleranceWei });
  }
  return out;
}
