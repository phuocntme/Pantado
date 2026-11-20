/**
 * Index assessment (spec §10.3): concentration, volatility, stock/token split, per-leg size caps, fee drag,
 * rebalance history — built only from data-layer numbers, deterministic, no LLM.
 */
export interface AssessmentInput {
  legs: { id: string | null; symbol: string | null; kind: string | null; currentBps: number; targetBps: number }[];
  levels: { ts: number; level: number }[]; // oldest first, USD per unit
  sizeCapUsd: Record<string, number | null>; // per asset id (stocks)
  plans: { status: string; loss: number | null; value: number | null }[];
  tradeFeeBps: number;
  spreadBps: Record<string, number>; // per asset id
}

export interface Assessment {
  concentration: { topAsset: string | null; topPct: number; hhi: number; label: "diversified" | "moderate" | "concentrated" };
  volatility: { annualizedPct: number | null; days: number };
  split: { stocksPct: number; tokensPct: number };
  sizeCaps: { maxBuyUsd: number | null; limitingAsset: string | null };
  feeDrag: { roundTripPct: number };
  rebalances: { plans: number; completed: number; avgLossPct: number | null };
  notes: string[];
  /** Summary sentence and tags for the index page card. */
  text: string;
  tags: { label: string; good: boolean }[];
}

export function assess(x: AssessmentInput): Assessment {
  const w = x.legs.map((l) => l.currentBps / 10_000);
  const hhi = w.reduce((s, v) => s + v * v, 0);
  const topIdx = w.reduce((best, v, i) => (v > (w[best] ?? 0) ? i : best), 0);
  const top = x.legs[topIdx];
  const topPct = Math.round((w[topIdx] ?? 0) * 1000) / 10;
  const label = hhi < 0.15 ? "diversified" : hhi < 0.3 ? "moderate" : "concentrated";

  // daily log returns from the level series
  const daily = new Map<number, number>();
  for (const p of x.levels) daily.set(Math.floor(p.ts / 86400), p.level);
  const lv = [...daily.values()];
  const r: number[] = [];
  for (let i = 1; i < lv.length; i++) if ((lv[i - 1] ?? 0) > 0 && (lv[i] ?? 0) > 0) r.push(Math.log((lv[i] as number) / (lv[i - 1] as number)));
  let annualizedPct: number | null = null;
  if (r.length >= 5) {
    const m = r.reduce((s, v) => s + v, 0) / r.length;
    const sd = Math.sqrt(r.reduce((s, v) => s + (v - m) ** 2, 0) / (r.length - 1));
    annualizedPct = Math.round(sd * Math.sqrt(365) * 1000) / 10;
  }

  const stocksBps = x.legs.filter((l) => l.kind === "stock").reduce((s, l) => s + l.targetBps, 0);

  // largest single buy before a stock leg exceeds its per-trade cap: cap / weight
  let maxBuyUsd: number | null = null;
  let limitingAsset: string | null = null;
  for (const l of x.legs) {
    const cap = l.id ? x.sizeCapUsd[l.id] : null;
    if (!cap || l.currentBps <= 0) continue;
    const lim = cap / (l.currentBps / 10_000);
    if (maxBuyUsd === null || lim < maxBuyUsd) {
      maxBuyUsd = Math.floor(lim);
      limitingAsset = l.symbol;
    }
  }

  const avgSpreadBps = x.legs.reduce((s, l) => s + (l.id ? (x.spreadBps[l.id] ?? 0) : 0) * (l.targetBps / 10_000), 0);
  const roundTripPct = Math.round(((2 * x.tradeFeeBps + 2 * avgSpreadBps) / 100) * 100) / 100;

  const ended = x.plans.filter((p) => p.status !== "Scheduled" && p.status !== "Active");
  const losses = ended.filter((p) => p.loss !== null && p.value).map((p) => ((p.loss as number) / (p.value as number)) * 100);
  const notes: string[] = [];
  if (label === "concentrated" && top?.symbol) notes.push(`${top.symbol} is ${topPct}% of the basket.`);
  if (maxBuyUsd !== null) notes.push(`Buys above about $${maxBuyUsd.toLocaleString("en-US")} hit the per-trade cap of ${limitingAsset}.`);
  if (annualizedPct === null) notes.push("Not enough level history yet for a volatility estimate.");

  return {
    concentration: { topAsset: top?.symbol ?? null, topPct, hhi: Math.round(hhi * 1000) / 1000, label },
    volatility: { annualizedPct, days: lv.length },
    split: { stocksPct: Math.round(stocksBps / 100), tokensPct: 100 - Math.round(stocksBps / 100) },
    sizeCaps: { maxBuyUsd, limitingAsset },
    feeDrag: { roundTripPct },
    rebalances: {
      plans: x.plans.length,
      completed: x.plans.filter((p) => p.status === "Completed").length,
      avgLossPct: losses.length ? Math.round((losses.reduce((s, v) => s + v, 0) / losses.length) * 100) / 100 : null,
    },
    notes,
    text: [
      `${label.charAt(0).toUpperCase()}${label.slice(1)} basket${top?.symbol ? `, largest position ${top.symbol} at ${topPct}%` : ""}.`,
      `${Math.round(stocksBps / 100)}% stocks, ${100 - Math.round(stocksBps / 100)}% tokens.`,
      annualizedPct === null ? "Volatility: not enough history yet." : `Annualised volatility ${annualizedPct}%.`,
      `A buy and later sell costs about ${roundTripPct}% in fees and spreads.`,
      ...notes.filter((n) => n.startsWith("Buys above")),
    ].join(" "),
    tags: [
      { label: label === "diversified" ? "Diversified" : label === "moderate" ? "Moderate concentration" : "Concentrated", good: label !== "concentrated" },
      { label: annualizedPct === null ? "Volatility —" : `Volatility ${annualizedPct}%`, good: annualizedPct !== null && annualizedPct < 60 },
      { label: `Fee drag ${roundTripPct}%`, good: roundTripPct <= 1.5 },
      { label: `${x.plans.filter((p) => p.status === "Completed").length} rebalances completed`, good: true },
    ],
  };
}
