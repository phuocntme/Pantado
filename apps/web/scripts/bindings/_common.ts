import type { Binding } from "../bindings.js";

/** Account chrome on every screen (top bar wallet button). Merged into each screen's binding. */
export const binding: Binding = {
  text: {
    "0x2c71…ab90": "me.short",
    "$1,620": "me.balanceS",
    // network fee line: "Sponsored" only when gas sponsorship is actually configured
    Sponsored: "me.gasS",
    // network badge: "Fuji testnet", or "Local test chain" on the dev stack (never Fuji for a local chain)
    "Fuji testnet": "me.netBadge",
  },
};
