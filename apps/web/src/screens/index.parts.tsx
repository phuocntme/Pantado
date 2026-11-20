"use client";
/**
 * Live slot renderers for the Index / Private screens and the state blocks shared with New version and Redeem.
 * Markup, sizes and colors are copied from the reference (Index page and the States page).
 */
import { useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { intervalSpec, type IntervalLabel } from "../lib/intervals";
import { css } from "../lib/tpl";
import { MIN_VISIBLE, visible } from "../lib/zoom";
import { useChartZoom, type ChartZoom } from "../lib/zoom-hook";
import { short } from "../lib/nav";
import { CONFIG } from "../lib/config";
import type { TxState } from "../lib/wallet";
import { chartGeometry, levelCandles, SLOTS, type ChartGeom } from "./index.chart";
import type { IndexEvent, Levels } from "./index.data";
import type { IndexVM, PlanVM, TradeBlock } from "./index.vm";

const NETWORK = CONFIG.network.charAt(0).toUpperCase() + CONFIG.network.slice(1);

// ------------------------------------------------------------------ States page markup

export function Alert({ tone, title, body }: { tone: "warn" | "error" | "info"; title: string; body?: string }) {
  const t = { warn: ["#1E170B", "#3A2C12", "#F5B14C"], error: ["#2A1212", "#4A1F1F", "#FF6B6B"], info: ["#0B1626", "#1C2F4A", "#6FA8FF"] }[tone];
  return (
    <div role="alert" style={css(`display: flex; flex-direction: column; gap: 4px; padding: 12px 14px; background: ${t[0]}; border: 1px solid ${t[1]}; border-radius: 12px; font-size: 13px; line-height: 1.5`)}>
      <strong style={css(`color: ${t[2]}`)}>{title}</strong>
      {body ? <span style={css("color: #B4B4BB")}>{body}</span> : null}
    </div>
  );
}

export function StatusRow({ dot, title, sub }: { dot: string; title: string; sub: string }) {
  return (
    <div role="status" style={css("display: flex; align-items: center; gap: 12px; padding: 12px 14px; background: #131316; border: 1px solid #26262B; border-radius: 12px")}>
      <span style={css(`width: 10px; height: 10px; border-radius: 50%; background: ${dot}; flex: none`)} aria-hidden="true"></span>
      <span style={css("display: flex; flex-direction: column; gap: 2px")}>
        <span style={css("font-size: 14px; font-weight: 600")}>{title}</span>
        <span style={css("font-size: 12px; color: #8E8E96")}>{sub}</span>
      </span>
    </div>
  );
}

/** Transaction status (pending / confirmed / failed) with the States page copy. */
export function TxStatus({ state, pending, confirmed, failed }: { state: TxState; pending: string; confirmed: string; failed: string }) {
  if (state.status === "pending") return <StatusRow dot="#C9B3FD" title="Confirm in your wallet" sub={pending} />;
  if (state.status === "confirmed") return <StatusRow dot="#3DD68C" title={confirmed} sub={`Confirmed on ${NETWORK} · ${short(state.hash)}`} />;
  if (state.status === "failed") return <StatusRow dot="#FF6B6B" title={failed} sub={state.error.message} />;
  return null;
}

export function WrongNetwork({ onSwitch }: { onSwitch: () => void }) {
  return (
    <>
      <Alert tone="warn" title="Your wallet is on another network." body={`Pantado trades on ${NETWORK} while in testnet.`} />
      <button type="button" onClick={onSwitch} style={css("min-height: 48px; background: #F2F2F3; color: #0B0B0D; border: 0; border-radius: 12px; font-size: 14px; font-weight: 700")}>
        {`Switch to ${NETWORK}`}
      </button>
    </>
  );
}

// ------------------------------------------------------------------ Index slots

/**
 * Index level chart for the picked interval, zoomable (wheel / pinch, drag, double-click resets) with the hovered
 * candle's OHLC in the legend. Up to the reference's 112 slots the candles keep the reference spacing.
 */
export function ZoomLevelChart(p: { name: string; levels: Levels["levels"]; txs: IndexEvent[]; interval: IntervalLabel; resetKey: string }) {
  const spec = intervalSpec(p.interval);
  const candles = useMemo(() => levelCandles(p.levels, p.txs, spec.sec), [p.levels, p.txs, spec.sec]);
  const n = candles.length;
  const base = Math.max(1, Math.min(n, SLOTS));
  // the full series keeps the reference spacing (112 slots, right-aligned); zooming in moves smoothly to
  // candles that fill the width at the closest zoom
  const slotsFor = (count: number): number => {
    if (count >= base) return Math.max(count, SLOTS);
    const extra = Math.max(SLOTS, base) - base;
    const k = base > MIN_VISIBLE ? (count - MIN_VISIBLE) / (base - MIN_VISIBLE) : 0;
    return Math.round(count + extra * Math.max(0, k));
  };
  const z = useChartZoom(n, SLOTS, `${p.resetKey}:${p.interval}`, slotsFor);
  const vis = visible(candles, z.view);
  const slots = slotsFor(vis.length);
  const at = z.hoverFx === null ? null : Math.floor(z.hoverFx * slots) - (slots - vis.length);
  const g = chartGeometry(vis, slots, at !== null && at >= 0 && at < vis.length ? at : null);
  return <LevelChart name={p.name} g={g} interval={p.interval} zoom={z} />;
}

export function LevelChart({ name, g, interval = "1D", zoom }: { name: string; g: ChartGeom; interval?: IntervalLabel; zoom?: ChartZoom }) {
  return (
    <div style={css("position: relative; height: 520px")} role="img" aria-label={`${interval === "1D" ? "Daily" : interval} candlestick chart of the index level with volume`}>
      <div
        ref={zoom?.ref}
        {...zoom?.handlers}
        title={zoom ? "Scroll or pinch to zoom, drag to move, double-click to reset" : undefined}
        style={css(`position: absolute; left: 0; right: 64px; top: 0; bottom: 28px${zoom ? "; cursor: crosshair; touch-action: pan-y; user-select: none" : ""}`)}
      >
        <svg viewBox="0 0 1000 520" preserveAspectRatio="none" aria-hidden="true" shapeRendering="crispEdges" style={css("display: block; width: 100%; height: 100%")}>
          {g.vLines.map((x, i) => (
            <line key={`v${i}`} x1={x} y1="0" x2={x} y2="520" stroke="#17171A" strokeWidth="1" />
          ))}
          {g.hLines.map((y, i) => (
            <line key={`h${i}`} x1="0" y1={y} x2="1000" y2={y} stroke="#17171A" strokeWidth="1" />
          ))}
          {g.candles.map((c, i) => (
            <g key={i}>
              <rect x={c.vol.x} y={c.vol.y} width={c.vol.w} height={c.vol.h} fill={c.col} opacity="0.28" />
              <rect x={c.wick.x} y={c.wick.y} width="1" height={c.wick.h} fill={c.col} />
              <rect x={c.body.x} y={c.body.y} width={c.body.w} height={c.body.h} fill={c.col} />
            </g>
          ))}
          {g.last ? <line x1="0" y1={g.last.y} x2="1000" y2={g.last.y} stroke={g.last.col} strokeWidth="1" strokeDasharray="2 3" /> : null}
          {g.focusX !== null ? <line x1={g.focusX} y1="0" x2={g.focusX} y2="520" stroke="#3A3A42" strokeWidth="1" strokeDasharray="3 3" /> : null}
        </svg>
      </div>
      <div style={css("position: absolute; left: 14px; top: 12px; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; font-size: 12px; color: #8E8E96")}>
        <span style={css("font-size: 14px; font-weight: 600; color: #F2F2F3")}>{`${name} · ${interval}`}</span>
        {(["o", "h", "l", "c"] as const).map((k) => (
          <span key={k}>
            {`${k.toUpperCase()} `}
            <span style={css(`color: ${g.ohlc?.col ?? "#8E8E96"}`)}>{g.ohlc ? g.ohlc[k] : "—"}</span>
          </span>
        ))}
        <span style={css(`color: ${g.ohlc?.col ?? "#8E8E96"}`)}>{g.ohlc?.chg ?? "—"}</span>
      </div>
      <div style={css("position: absolute; right: 0; top: 0; bottom: 28px; width: 64px; border-left: 1px solid #1C1C20; font-size: 11px; color: #8E8E96")}>
        {g.yLabels.map((l, i) => (
          <span key={i} style={css(`position: absolute; left: 8px; top: ${l.top}; transform: translateY(-50%)`)}>
            {l.text}
          </span>
        ))}
        {g.last ? (
          <span style={css(`position: absolute; left: 0; right: 0; top: ${g.last.top}; transform: translateY(-50%); padding: 3px 8px; background: ${g.last.col}; color: #0B0B0D; font-weight: 600`)}>
            {g.last.text}
          </span>
        ) : null}
      </div>
      <div style={css("position: absolute; left: 0; right: 64px; bottom: 0; height: 28px; border-top: 1px solid #1C1C20; font-size: 11px; color: #8E8E96")}>
        {g.xLabels.map((l, i) => (
          <span key={i} style={css(`position: absolute; left: ${l.left}; top: 7px; transform: translateX(-50%)`)}>
            {l.text}
          </span>
        ))}
      </div>
      <div style={css("position: absolute; right: 0; bottom: 0; width: 64px; height: 28px; border-top: 1px solid #1C1C20; border-left: 1px solid #1C1C20; box-sizing: border-box")}></div>
    </div>
  );
}

/**
 * The creator's description ("shown on the index page", Create form), under the header: its first paragraph, the
 * rest behind "More" so the chart stays in view; nothing when empty.
 */
export function IndexAbout({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const t = text.trim();
  if (!t) return null;
  const [lead = "", ...rest] = t.split(/\n\s*\n/);
  const more = rest.join("\n\n").trim();
  return (
    <div
      aria-label="About this index"
      style={css("display: flex; flex-direction: column; gap: 10px; padding: 12px 16px; background: #0B0B0D; border: 1px solid #1C1C20; border-radius: 14px; font-size: 14px; line-height: 1.55; color: #B4B4BB")}
    >
      <div style={css("display: flex; align-items: baseline; gap: 12px")}>
        <span style={css("flex: 1 1 auto; min-width: 0; color: #F2F2F3")}>{lead}</span>
        {more ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((x) => !x)}
            style={css("flex: none; background: transparent; border: 0; padding: 0; color: #9052F9; font: inherit; font-weight: 600; cursor: pointer")}
          >
            {open ? "Less" : "More"}
          </button>
        ) : null}
      </div>
      {open && more ? <p style={css("margin: 0; white-space: pre-line")}>{more}</p> : null}
    </div>
  );
}

/** One full-width "Ask agent" button under the assessment: opens Ask and asks about this index. */
export function AskAgent({ href }: { href: string }) {
  return (
    <a
      href={href}
      style={css("display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; background: #1A1A1D; border-radius: 12px; font-size: 14px; font-weight: 500")}
    >
      {"Ask agent"}
    </a>
  );
}

export function VersionBanner({ banner, onOpen }: { banner: IndexVM["banner"]; onOpen: () => void }) {
  if (!banner) return null;
  const click = (e: MouseEvent<HTMLAnchorElement>): void => {
    e.preventDefault();
    onOpen();
  };
  return (
    <a
      href="#rebalances"
      onClick={click}
      style={css("display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; padding: 12px 16px; background: #1E1A12; border: 1px solid #3A2F17; border-radius: 14px; font-size: 14px")}
    >
      <span style={css("padding: 4px 10px; border-radius: 999px; background: #3A2F17; color: #F5B14C; font-size: 12px; font-weight: 600")}>{banner.pill}</span>
      <span>{banner.change}</span>
      <span style={css("margin-left: auto; color: #F5B14C; font-weight: 600")}>{"View changes"}</span>
    </a>
  );
}

const LOT_NOTE =
  "Each lot opens 0.5% above the fair price and falls to 2% below over 45 minutes. Anyone can fill it. If nobody does, the next lot is half the size. Lots left after 14 days are dropped.";

export function PlanStatus({ plan }: { plan: PlanVM | null }) {
  if (!plan) return null;
  return (
    <div style={css("display: flex; flex-direction: column; gap: 12px; padding: 16px 20px")}>
      <div style={css("display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px")}>
        <span style={css("display: flex; flex-direction: column; gap: 2px")}>
          <span style={css("font-size: 15px; font-weight: 600")}>{plan.title}</span>
          <span style={css("font-size: 13px; color: #8E8E96")}>{plan.sub}</span>
        </span>
        <span style={css(`padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; background: ${plan.pillBg}; color: ${plan.pillFg}`)}>{plan.pill}</span>
      </div>
      <div style={css("display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px")}>
        {plan.guards.map((g) => (
          <div key={g.label} style={css("display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; background: #131316; border-radius: 12px")}>
            <div style={css("display: flex; justify-content: space-between; gap: 8px; font-size: 12px")}>
              <span style={css("color: #8E8E96")}>{g.label}</span>
              <span style={css("font-weight: 600")}>
                {`${g.val} `}
                <span style={css("color: #8E8E96; font-weight: 400")}>{g.max}</span>
              </span>
            </div>
            <div style={css("height: 6px; border-radius: 3px; background: #1F1F23; overflow: hidden")}>
              <div style={css(`width: ${g.w}; height: 6px; background: ${g.col}`)}></div>
            </div>
          </div>
        ))}
      </div>
      {plan.lots.length > 0 ? (
        <div style={css("overflow-x: auto; border: 1px solid #1C1C20; border-radius: 12px")}>
          <table style={css("width: 100%; min-width: 420px; border-collapse: collapse; font-size: 13px")}>
            <thead>
              <tr style={css("text-align: right; color: #8E8E96; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase")}>
                <th scope="col" style={css("padding: 10px 20px; font-weight: 500; text-align: left")}>{"Lot"}</th>
                <th scope="col" style={css("padding: 10px 12px; font-weight: 500; text-align: left")}>{"Trade"}</th>
                <th scope="col" style={css("padding: 10px 12px; font-weight: 500")}>{"Size"}</th>
                <th scope="col" style={css("padding: 10px 20px; font-weight: 500")}>{"Status"}</th>
              </tr>
            </thead>
            <tbody>
              {plan.lots.map((l) => (
                <tr key={l.n} style={css("border-top: 1px solid #17171A; text-align: right")}>
                  <td style={css("padding: 10px 20px; text-align: left; color: #8E8E96")}>{l.n}</td>
                  <td style={css("padding: 10px 12px; text-align: left")}>{l.trade}</td>
                  <td style={css("padding: 10px 12px")}>{l.size}</td>
                  <td style={css("padding: 10px 20px")}>
                    <span style={css(`padding: 3px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; background: ${l.bg}; color: ${l.fg}`)}>{l.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p style={css("margin: 0; font-size: 12px; line-height: 1.5; color: #8E8E96")}>{LOT_NOTE}</p>
    </div>
  );
}

export function StatsTop({ stats }: { stats: IndexVM["stats"] }) {
  const box = (label: string, value: string, color: string): ReactNode => (
    <div style={css("background: #0B0B0D; border: 1px solid #1C1C20; border-radius: 12px; padding: 12px; text-align: center")}>
      <div style={css("font-size: 11px; color: #8E8E96; letter-spacing: 0.04em; text-transform: uppercase")}>{label}</div>
      <div style={css(`margin-top: 4px; font-family: 'Inter Tight', sans-serif; font-size: 24px; font-weight: 600; color: ${color}`)}>{value}</div>
    </div>
  );
  return (
    <div style={css("display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px")}>
      {box("Level", stats.levelS, "#F2F2F3")}
      {box("Since launch", stats.sinceS, stats.sinceCol)}
    </div>
  );
}

export function Changes({ changes }: { changes: IndexVM["changes"] }) {
  return (
    <div style={css("display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); background: #0B0B0D; border: 1px solid #1C1C20; border-radius: 12px; overflow: hidden")}>
      {changes.map((c, i) => (
        <div key={c.label} style={css(i === 0 ? "padding: 10px 4px; text-align: center;" : "padding: 10px 4px; text-align: center; border-left: 1px solid #1C1C20;")}>
          <div style={css("font-size: 11px; color: #8E8E96")}>{c.label}</div>
          <div style={css(`margin-top: 4px; font-size: 14px; font-weight: 600; color: ${c.col}`)}>{c.s}</div>
        </div>
      ))}
    </div>
  );
}

export function Split({ split }: { split: IndexVM["split"] }) {
  const s = split.stocks;
  const t = split.tokens;
  return (
    <div style={css("display: flex; flex-direction: column; gap: 6px; padding: 4px 2px")}>
      <div style={css("display: flex; justify-content: space-between; font-size: 12px; color: #B4B4BB")}>
        <span>{`Stocks ${s === null ? "—" : `${s}%`}`}</span>
        <span>{`Tokens ${t === null ? "—" : `${t}%`}`}</span>
      </div>
      <div style={css("display: flex; height: 6px; gap: 2px; border-radius: 3px; overflow: hidden")} aria-hidden="true">
        <span style={css(`display: block; width: ${s ?? 0}%; background: #F2F2F3`)}></span>
        <span style={css(`display: block; width: ${t ?? 0}%; background: #9052F9`)}></span>
      </div>
    </div>
  );
}

export function AssessTags({ tags }: { tags: IndexVM["assess"]["tags"] }) {
  if (tags.length === 0) return null;
  return (
    <div style={css("display: flex; flex-wrap: wrap; gap: 6px")}>
      {tags.map((t) => (
        <span
          key={t.label}
          style={css(`padding: 4px 10px; border-radius: 999px; background: ${t.good ? "#11261B" : "#2E2311"}; color: ${t.good ? "#3DD68C" : "#F5B14C"}; font-size: 12px; font-weight: 600`)}
        >
          {t.label}
        </span>
      ))}
    </div>
  );
}

export interface CtaProps {
  vm: IndexVM;
  side: "Buy" | "Sell";
  connected: boolean;
  chainOk: boolean;
  tx: TxState;
  submitting: boolean;
  onSubmit: () => void;
  onSwitch: () => void;
  onRedeemHref: string;
  loadError: string | null;
  /** States page copy: "One signature buys 9.30 TBB" / "You own 9.30 TBB". */
  pending: string;
  confirmed: string;
}

/** Trade button with the spec §12 states above it (stale price, per-trade limit, venue paused, tx, wrong network). */
export function TradeCta(p: CtaProps) {
  const { vm, side } = p;
  const block: TradeBlock = vm.trade;
  const btn = `display: flex; align-items: center; justify-content: center; min-height: 52px; background: ${vm.cta.bg}; color: #0B0B0D; border-radius: 12px; font-weight: 700; font-size: 16px`;
  if (p.loadError) return <Alert tone="error" title={p.loadError} />;
  if (block.kind === "stale")
    return (
      <>
        <Alert tone="warn" title={block.title} body={block.body} />
        <div style={css("display: grid; grid-template-columns: 1fr 1fr; gap: 8px")}>
          <button type="button" disabled style={css("min-height: 48px; background: #1F1F23; color: #8E8E96; border: 0; border-radius: 12px; font-size: 14px; font-weight: 600")}>
            {`${side} paused`}
          </button>
          <a href={p.onRedeemHref} style={css("display: flex; align-items: center; justify-content: center; min-height: 48px; background: #1A1A1D; border-radius: 12px; font-size: 14px; font-weight: 600")}>
            {"Redeem in Portfolio"}
          </a>
        </div>
      </>
    );
  if (!p.connected)
    return (
      <a href="/connect" style={css(btn)}>
        {vm.cta.label}
      </a>
    );
  if (!p.chainOk) return <WrongNetwork onSwitch={p.onSwitch} />;
  const blocked = block.kind !== "none" || !vm.amountOk || p.submitting;
  return (
    <>
      {block.kind === "limit" ? <Alert tone="error" title={block.title} body={block.body} /> : null}
      {block.kind === "paused" ? <Alert tone="warn" title={block.title} body={block.body} /> : null}
      {block.kind === "error" ? <Alert tone="error" title={block.title} /> : null}
      <TxStatus
        state={p.tx}
        pending={p.pending}
        confirmed={p.confirmed}
        failed={`${side} failed`}
      />
      <button
        type="button"
        onClick={p.onSubmit}
        aria-disabled={blocked ? "true" : "false"}
        style={css(`${btn}; border: 0; width: 100%${blocked ? "; opacity: 0.5" : ""}`)}
      >
        {vm.cta.label}
      </button>
    </>
  );
}
