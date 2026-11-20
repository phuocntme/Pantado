import { lookup, type LinkTarget, type Scope } from "./tpl";

/** Reference link targets → app routes. A view model may override per scope with `_href.<Target>`. */
export const ROUTES: Record<LinkTarget, string> = {
  Main: "/",
  AskChat: "/ask",
  Marketplace: "/marketplace",
  IndexDetail: "/marketplace",
  Asset: "/asset/nvda",
  Create: "/create",
  Portfolio: "/portfolio",
  Creator: "/profile",
  Connect: "/connect",
  Review: "/create",
  Redeem: "/portfolio",
  Version: "/portfolio",
  Swap: "/swap",
  IndexPrivate: "/portfolio",
  States: "/states",
};

export function nav(target: LinkTarget, scope: Scope): string {
  // innermost first: loop items of sc-for child scopes (own keys), walking out through the scope chain
  for (let s: object | null = scope; s && s !== Object.prototype; s = Object.getPrototypeOf(s) as object | null) {
    for (const key of Object.keys(s)) {
      const item = (s as Record<string, unknown>)[key];
      if (key === "_href" && item && typeof item === "object") {
        const h = (item as Record<string, unknown>)[target];
        if (typeof h === "string") return h;
      } else if (key !== "$index" && item && typeof item === "object") {
        const h = lookup(`_href.${target}`, item as Scope);
        if (typeof h === "string") return h;
      }
    }
  }
  return ROUTES[target];
}

/** Short wallet label "0x2c71…ab90". */
export const short = (a: string | null | undefined): string => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
