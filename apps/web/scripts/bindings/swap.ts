import type { Binding } from "../bindings.js";

/** Swap (reference route `swap`): the mock tx line becomes a live status / notice slot. */
export const binding: Binding = {
  slots: [
    { tag: "div", attrs: { role: "status" }, name: "status" },
    // the Route row is not shown: an empty slot
    { tag: "div", attrs: {}, childText: "Route", name: "routeRow" },
  ],
};
