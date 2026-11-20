/**
 * Private index page view model — reference/logic/private.js: the Index view model plus `makePublic` and
 * `pubLabel` for the "Private · Only you" banner.
 */
import type { IndexDetail } from "./index.data";
import { indexVM, type IndexHandlers, type IndexInput, type IndexState } from "./index.vm";

/** The private screen is shown only to the creator of a private index; everyone else sees the public page. */
export function showPrivate(detail: IndexDetail | null, me: string | null): boolean {
  return !!detail && !detail.isPublic && !!me && detail.creator.toLowerCase() === me.toLowerCase();
}

export type PubState = "private" | "pending" | "public";

export function privateVM(input: IndexInput, st: IndexState, h: IndexHandlers, pub: PubState, makePublic: () => void) {
  const base = indexVM(input, st, h);
  return {
    ...base,
    makePublic: () => {
      if (pub === "private") makePublic();
    },
    pubLabel: pub === "public" ? "Public · in Marketplace" : pub === "pending" ? "Confirm in your wallet" : "Make public",
  };
}
