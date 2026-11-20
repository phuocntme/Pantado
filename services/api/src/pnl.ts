/** FIFO cost basis for index positions (spec §9.4). */
export interface Lot {
  units: bigint;
  costUsdc: bigint;
  ts: number;
}
export interface Exit {
  units: bigint;
  ts: number;
}

export interface Position {
  units: bigint;
  costUsdc: bigint; // cost of remaining units
  realizedCostUsdc: bigint; // cost of units already sold/redeemed
  /** Units held without a known lot (received by transfer): flagged in the UI. */
  unknownBasisUnits: bigint;
}

/** Consume exits FIFO against buy lots. `held` = current on-chain units. */
export function fifo(lots: Lot[], exits: Exit[], held: bigint): Position {
  const q = [...lots].sort((a, b) => a.ts - b.ts).map((l) => ({ ...l }));
  let realized = 0n;
  for (const e of [...exits].sort((a, b) => a.ts - b.ts)) {
    let left = e.units;
    while (left > 0n && q.length > 0) {
      const l = q[0]!;
      const take = left < l.units ? left : l.units;
      const cost = (l.costUsdc * take) / l.units;
      realized += cost;
      l.costUsdc -= cost;
      l.units -= take;
      left -= take;
      if (l.units === 0n) q.shift();
    }
  }
  const known = q.reduce((s, l) => s + l.units, 0n);
  const cost = q.reduce((s, l) => s + l.costUsdc, 0n);
  if (held >= known) return { units: held, costUsdc: cost, realizedCostUsdc: realized, unknownBasisUnits: held - known };
  // fewer units than lots (transfers out): scale remaining cost
  return { units: held, costUsdc: known === 0n ? 0n : (cost * held) / known, realizedCostUsdc: realized, unknownBasisUnits: 0n };
}
