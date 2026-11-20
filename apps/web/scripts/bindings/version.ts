import type { Binding } from "../bindings.js";

/** New version (Manual index you own): bound to src/screens/version.vm.ts. */
export const binding: Binding = {
  text: {
    "Propose version 4": "heading",
    "Version 4": "nextName",
    "Tech + BTC Balanced": "name",
    "1,204": "holdersS",
    "27%": "volNow",
  },
  slots: [{ tag: "textarea", attrs: { id: "reason" }, name: "reason" }],
};
