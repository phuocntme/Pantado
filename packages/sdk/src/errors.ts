import { BaseError, ContractFunctionRevertedError, decodeErrorResult, type Abi, type Hex } from "viem";
import * as abis from "./abis/index.js";

/** Every custom error of every Pantado contract, deduplicated by name. */
const ALL_ERRORS: Abi = (() => {
  const seen = new Set<string>();
  const out: Abi[number][] = [];
  for (const abi of Object.values(abis) as Abi[]) {
    for (const item of abi) {
      if (item.type !== "error") continue;
      const key = `${item.name}(${item.inputs.map((i) => i.type).join(",")})`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
})();

/** UI copy for contract errors (spec §12 states). Unknown errors fall back to a generic message. */
export const ERROR_MESSAGES: Record<string, string> = {
  PriceStale: "A price in this basket is stale. Buy and sell are paused; you can still redeem from Portfolio.",
  SizeCapExceeded: "This trade is above the max per trade for this stock.",
  OiCapExceeded: "This stock has reached its open-interest limit. Try a smaller amount later.",
  ReserveGuard: "The stock venue reserve limit is reached. Try a smaller amount later.",
  InsufficientReserve: "The stock venue cannot pay this sell right now. You can redeem in-kind from Portfolio.",
  BuysPausedFor: "New buys of one asset in this basket are paused. Sells and redeem stay open.",
  Slippage: "The price moved beyond your limit. Refresh the quote and try again.",
  InsufficientInventory: "The venue does not have enough inventory for this trade. Try a smaller amount.",
  TickerTaken: "This ticker is already taken.",
  BadTicker: "Ticker must be 2–6 characters, A–Z or 0–9.",
  BadName: "Name must be 1–64 characters.",
  BadWeights: "Weights must be whole percents, each at least 1 %, summing to 100 %.",
  BadAssetCount: "An index holds 2 to 20 assets.",
  UnlistedAsset: "One of the assets is not listed.",
  DuplicateAsset: "Each asset can appear only once.",
  FirstBuyTooSmall: "The first buy must be at least 100 USDC.",
  NotCreator: "Only the creator of this index can do this.",
  AlreadyPublic: "This index is already public.",
  PlanInProgress: "A rebalance plan is already scheduled or running.",
  MustPassThroughOff: "Switch to Off first: Auto can only change to Manual through Off.",
  WrongMode: "This action is not available in the index's current rebalancing mode.",
  NotDue: "This index is not due for a rebalance yet.",
  TooEarly: "The rebalance notice period has not ended yet.",
  DailyCapReached: "The daily rebalance limit is reached. Auctions resume within 24 h.",
  LossBudgetExceeded: "This fill would exceed the plan's loss budget.",
  PlanExpired: "This rebalance plan reached its maximum duration.",
  AuctionOver: "This auction has ended.",
  NotListed: "No listed asset at this contract address.",
  UnsupportedPair: "No listed asset at this contract address.",
  ERC20InsufficientBalance: "Insufficient balance.",
  ERC20InsufficientAllowance: "Approval required before this transaction.",
};

export class PantadoError extends Error {
  override readonly name = "PantadoError";
  constructor(
    /** Contract error name, e.g. "PriceStale", or "Unknown". */
    readonly code: string,
    message: string,
    readonly args: readonly unknown[] = [],
    override readonly cause?: unknown,
  ) {
    super(message);
  }
}

/** Decode revert data into a typed error with UI copy. */
export function decodeRevert(data: Hex): PantadoError {
  try {
    const d = decodeErrorResult({ abi: ALL_ERRORS, data });
    return new PantadoError(d.errorName, ERROR_MESSAGES[d.errorName] ?? `Transaction reverted: ${d.errorName}`, d.args ?? []);
  } catch {
    return new PantadoError("Unknown", "Transaction reverted.");
  }
}

/** Map anything thrown by viem (simulate / write / call) to a PantadoError. */
export function toPantadoError(err: unknown): PantadoError {
  if (err instanceof PantadoError) return err;
  if (err instanceof BaseError) {
    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      if (reverted.raw) {
        const e = decodeRevert(reverted.raw);
        return new PantadoError(e.code, e.message, e.args, err);
      }
      const name = reverted.data?.errorName;
      if (name) return new PantadoError(name, ERROR_MESSAGES[name] ?? `Transaction reverted: ${name}`, reverted.data?.args ?? [], err);
    }
    // eth_call / estimateGas errors carry the revert data on a nested RawContractError
    const withData = err.walk((e) => {
      const d = (e as { data?: unknown }).data;
      return typeof d === "string" && d.startsWith("0x") && d.length >= 10;
    }) as { data?: string } | null;
    if (withData?.data) {
      const e = decodeRevert(withData.data as Hex);
      return new PantadoError(e.code, e.message, e.args, err);
    }
    return new PantadoError("Unknown", err.shortMessage, [], err);
  }
  return new PantadoError("Unknown", err instanceof Error ? err.message : String(err), [], err);
}
