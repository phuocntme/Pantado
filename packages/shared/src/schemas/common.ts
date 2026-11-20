import { z } from "zod";

/** Placeholder for a value that must be confirmed on-chain before use. */
export const TODO = "TODO" as const;

export type Address = `0x${string}`;
export const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "expected a 0x-prefixed 20-byte address")
  .transform((v) => v as Address);

/** Address that may still be pending verification. */
export const addressOrTodoSchema = z.union([addressSchema, z.literal(TODO)]);

/** Non-negative decimal number written as a string, e.g. "164.6". */
export const decimalStringSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/, "expected a non-negative decimal string");

/** Non-negative integer written as a string (wei, base units). */
export const uintStringSchema = z.string().regex(/^(0|[1-9][0-9]*)$/, "expected a uint string");

export const bpsSchema = z.number().int().min(0).max(10_000);

export const chainIdSchema = z.union([z.number().int().positive(), z.literal(TODO)]);

export const urlOrTodoSchema = z.union([z.string().url(), z.literal(TODO)]);

export const profileNameSchema = z.enum(["contest", "production"]);
export type ProfileName = z.infer<typeof profileNameSchema>;
