/** Idempotent event key: `(chainId, blockNumber, txHash, logIndex)`. */
export function eventId(chainId: number, e: { block: { number: bigint }; transaction: { hash: string }; log: { logIndex: number } }): string {
  return `${chainId}:${e.block.number}:${e.transaction.hash}:${e.log.logIndex}`;
}

export const lower = (a: string): `0x${string}` => a.toLowerCase() as `0x${string}`;

export const DEAD = "0x000000000000000000000000000000000000dead";
export const ZERO = "0x0000000000000000000000000000000000000000";

export const PLAN_STATUS = ["None", "Scheduled", "Active", "Completed", "Stopped", "Expired", "Cancelled"] as const;
