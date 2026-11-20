import { QuoteError } from "@pantado/shared";
import { ERROR_MESSAGES } from "@pantado/sdk";

/** Typed API error; `code` matches contract error names where one exists. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function fromQuoteError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  if (e instanceof QuoteError) return new ApiError(422, e.code, ERROR_MESSAGES[e.code] ?? e.message);
  return new ApiError(500, "Internal", e instanceof Error ? e.message : String(e));
}
