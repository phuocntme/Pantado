import { z } from "zod";
import { decimalStringSchema } from "./common.js";

/** `config/indexes.contest.json` — demo indexes seeded on Fuji. */

export const tickerSchema = z.string().regex(/^[A-Z0-9]{2,6}$/, "ticker: 2–6 chars, A–Z/0–9");
export const rebalanceModeSchema = z.enum(["Off", "Manual", "Auto"]);
export type RebalanceMode = z.infer<typeof rebalanceModeSchema>;

export const demoIndexSchema = z
  .strictObject({
    id: z.string().regex(/^idx-[a-z0-9]{2,6}$/),
    name: z.string().min(1),
    ticker: tickerSchema,
    mode: rebalanceModeSchema,
    driftBps: z.number().int().optional(),
    components: z.record(z.string().regex(/^[a-z0-9]+$/), z.number().int().min(100)),
    firstBuyUsd: decimalStringSchema,
    visibility: z.enum(["public", "private"]),
    /** creator: the deployer, the agent-manager, or a demo wallet `demo-N` (DEMO_WALLET_N, testnet only) */
    owner: z.string().regex(/^(deployer|agent-manager|demo-[1-9])$/).optional(),
    /** shown on the index page; the factory takes at most 1024 bytes */
    description: z.string().optional(),
    /** later buys by other demo wallets (holders, volume) */
    buys: z.array(z.strictObject({ by: z.string().regex(/^demo-[1-9]$/), usd: decimalStringSchema })).optional(),
  })
  .superRefine((ix, ctx) => {
    const issue = (message: string): void => ctx.addIssue({ code: "custom", message });
    if (ix.id !== `idx-${ix.ticker.toLowerCase()}`) issue(`id must be idx-${ix.ticker.toLowerCase()}`);
    const weights = Object.values(ix.components);
    if (weights.length < 2 || weights.length > 20) issue("2–20 components");
    if (weights.reduce((a, b) => a + b, 0) !== 10_000) issue("weights must sum to 10000 bps");
    if (ix.description && new TextEncoder().encode(ix.description).length > 1024) issue("description: at most 1024 bytes");
  });
export type DemoIndex = z.infer<typeof demoIndexSchema>;

export const demoIndexesFileSchema = z.strictObject({
  $comment: z.string().optional(),
  indexes: z.array(demoIndexSchema),
});
export type DemoIndexesFile = z.infer<typeof demoIndexesFileSchema>;
