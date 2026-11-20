import type { Binding } from "../bindings.js";

/** Profile / creator page: handle, wallet (copy), X link (hidden when unknown), public indexes. */
export const binding: Binding = {
  text: {
    "@handle": "handle",
    H: "avatar",
    "Indexes · 3": "countLabel",
  },
  slots: [
    { tag: "button", attrs: { "style~": "display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 14px; background: #131316; color: #F2F2F3" }, name: "walletCopy" },
    { tag: "a", attrs: { href: "https://x.com" }, name: "xLink" },
  ],
};
