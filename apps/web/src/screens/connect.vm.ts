import type { Scope } from "../lib/tpl";
import { askVM, type AskInputs } from "./ask.vm";

/** Connect view model: the reference renders the Ask home behind the dialog (reference/logic/connect.js = ask.js). */
export function connectVM(x: AskInputs): Scope {
  return askVM(x);
}
