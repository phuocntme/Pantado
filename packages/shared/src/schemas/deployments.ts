import { z } from "zod";
import { addressSchema } from "./common.js";

/** `contracts/deployments/<network>.json`, written by `script/Deploy.s.sol`. */
export const deploymentSchema = z.object({
  network: z.string(),
  chainId: z.number().int().positive(),
  deployer: addressSchema,
  startBlock: z.number().int().min(0),
  demo: z.boolean(),
  contracts: z.object({
    usdc: addressSchema,
    oracle: addressSchema,
    assetRegistry: addressSchema,
    /** Test networks: oracle-priced test-token venue. */
    tokenVenue: addressSchema.optional(),
    /** Mainnet: token venue over real DEX pools (spec §7). */
    dexVenue: addressSchema.optional(),
    stockVenue: addressSchema,
    feeSplitter: addressSchema,
    factory: addressSchema,
    vaultImplementation: addressSchema,
    rebalancer: addressSchema,
    lens: addressSchema,
    swapRouter: addressSchema,
  }),
  assets: z.record(z.string().regex(/^[a-z0-9]+$/), addressSchema),
}).refine((d) => d.contracts.tokenVenue !== undefined || d.contracts.dexVenue !== undefined, { message: "a token venue (tokenVenue or dexVenue) is required" });
export type Deployment = z.infer<typeof deploymentSchema>;
