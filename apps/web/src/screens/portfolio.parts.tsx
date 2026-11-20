"use client";
/**
 * Live slot renderers shared by Portfolio (and the creator page): each keeps the reference markup and styles
 * of the subtree it replaces (scripts/bindings/portfolio.ts), and of the reference States page for loading / empty.
 */
import type { ReactNode } from "react";
import { css, lookup, type LinkTarget, type Scope } from "../lib/tpl";

/** States page › Loading (four skeleton rows). */
export function LoadingRows(): ReactNode {
  const row = (k: number) => (
    <div key={k} style={css("display: flex; align-items: center; gap: 12px")}>
      <span style={css("width: 32px; height: 32px; border-radius: 50%; background: #1F1F23; flex: none")}></span>
      <span style={css("flex: 1; display: flex; flex-direction: column; gap: 6px")}>
        <span style={css("display: block; height: 12px; width: 45%; border-radius: 6px; background: #1F1F23")}></span>
        <span style={css("display: block; height: 12px; width: 25%; border-radius: 6px; background: #1F1F23")}></span>
      </span>
      <span style={css("display: block; height: 12px; width: 64px; border-radius: 6px; background: #1F1F23")}></span>
    </div>
  );
  return <div style={css("padding: 8px 20px 18px; display: flex; flex-direction: column; gap: 12px")}>{[0, 1, 2, 3].map(row)}</div>;
}

/** States page › Empty portfolio. */
export function EmptyPortfolio({ v, nav }: { v: Scope; nav: (t: LinkTarget, s: Scope) => string }): ReactNode {
  return (
    <div style={css("padding: 8px 20px 18px")}>
      <div style={css("display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 8px 0; text-align: center")}>
        <span style={css("font-size: 16px; font-weight: 600")}>{"Nothing here yet"}</span>
        <span style={css("font-size: 13px; color: #8E8E96")}>{"Ask the agent for an index idea, or browse the Marketplace."}</span>
        <span style={css("display: flex; gap: 8px")}>
          <a style={css("display: flex; align-items: center; min-height: 44px; padding: 0 16px; background: #1A1A1D; border-radius: 12px; font-size: 14px; font-weight: 600")} href={nav("Marketplace", v)}>
            {"Marketplace"}
          </a>
          <a style={css("display: flex; align-items: center; min-height: 44px; padding: 0 16px; background: #F2F2F3; color: #0B0B0D; border-radius: 12px; font-size: 14px; font-weight: 700")} href={nav("Main", v)}>
            {"Ask the agent"}
          </a>
        </span>
      </div>
    </div>
  );
}

/** States page › Transaction status row (pending / confirmed / failed). */
export function TxRow({ dot, title, sub }: { dot: string; title: string; sub: string }): ReactNode {
  return (
    <div style={css("margin-top: 10px; display: flex; align-items: center; gap: 12px; padding: 12px 14px; background: #131316; border: 1px solid #26262B; border-radius: 12px")}>
      <span style={css(`width: 10px; height: 10px; border-radius: 50%; background: ${dot}; flex: none`)} aria-hidden="true"></span>
      <span style={css("display: flex; flex-direction: column; gap: 2px")}>
        <span style={css("font-size: 14px; font-weight: 600")}>{title}</span>
        <span style={css("font-size: 12px; color: #8E8E96")}>{sub}</span>
      </span>
    </div>
  );
}

export const str = (path: string, s: Scope): string => {
  const x = lookup(path, s);
  return x === null || x === undefined ? "" : String(x);
};
