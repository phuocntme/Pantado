import type { Binding } from "../bindings.js";

/** Create (reference route `create`): fee and name literals → view model; created banner → live status slot. */
export const binding: Binding = {
  text: {
    "My basket": "name",
    "5.00 USDC": "creationFeeS",
    "Creation fee 5 USDC": "feeLine",
  },
  slots: [{ tag: "div", attrs: { role: "status" }, name: "status" }],
};
