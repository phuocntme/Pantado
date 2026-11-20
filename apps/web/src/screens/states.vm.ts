import type { Me } from "../lib/chrome";
import type { Scope } from "../lib/tpl";

/** States gallery view model (reference/logic/states.js returns {}); only the account chrome is live. */
export function statesVM(me: Me): Scope {
  return { me };
}
