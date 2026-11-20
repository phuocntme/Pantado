"use client";
/**
 * Live slot renderers shared by the Asset, Swap, Create and Review screens. Markup and styles are copied
 * from the reference (Asset chart, Asset stats, States page) so slots look exactly like the static
 * reference nodes they replace.
 */
import { useEffect, useMemo, type ReactNode } from "react";
import { intervalSpec, type IntervalLabel } from "../lib/intervals";
import { css } from "../lib/tpl";
import { visible } from "../lib/zoom";
import { useChartZoom, type ChartZoom } from "../lib/zoom-hook";
import { buildChart, chartSlots, type Candle, type ChartModel } from "./asset.chart";
import type { Notice, Perf, Tone, TxLine } from "./asset.states";

export type { Notice, Perf, TxLine };

// ---------------------------------------------------------------- notices (States page markup)

const TONE: Record<Tone, { bg: string; bd: string; fg: string }> = {
  amber: { bg: "#1E170B", bd: "#3A2C12", fg: "#F5B14C" },
  red: { bg: "#2A1212", bd: "#4A1F1F", fg: "#FF6B6B" },
  blue: { bg: "#0B1626", bd: "#1C2F4A", fg: "#6FA8FF" },
};

export function NoticeBox({ n }: { n: Notice }) {
  const t = TONE[n.tone];
  return (
    <>
      <div
        role="alert"
        style={css(`display: flex; flex-direction: column; gap: 4px; padding: 12px 14px; background: ${t.bg}; border: 1px solid ${t.bd}; border-radius: 12px; font-size: 13px; line-height: 1.5`)}
      >
        <strong style={css(`color: ${t.fg}`)}>{n.title}</strong>
        {n.body ? <span style={css("color: #B4B4BB")}>{n.body}</span> : null}
      </div>
      {n.action ? (
        <button
          type="button"
          onClick={n.action.run}
          style={css("min-height: 48px; background: #F2F2F3; color: #0B0B0D; border: 0; border-radius: 12px; font-size: 14px; font-weight: 700")}
        >
          {n.action.label}
        </button>
      ) : null}
    </>
  );
}

export function Notices({ list }: { list: Notice[] }) {
  if (list.length === 0) return null;
  return (
    <div style={css("display: flex; flex-direction: column; gap: 8px")}>
      {list.map((n, i) => (
        <NoticeBox key={i} n={n} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- transaction status (States page markup)

export function TxStatusLine({ s }: { s: TxLine }) {
  return (
    <div role="status" style={css("display: flex; align-items: center; gap: 12px; padding: 12px 14px; background: #131316; border: 1px solid #26262B; border-radius: 12px")}>
      <span style={css(`width: 10px; height: 10px; border-radius: 50%; background: ${s.dot}; flex: none`)} aria-hidden="true"></span>
      <span style={css("display: flex; flex-direction: column; gap: 2px")}>
        <span style={css("font-size: 14px; font-weight: 600")}>{s.title}</span>
        {s.href ? (
          <a href={s.href} target="_blank" rel="noreferrer" style={css("font-size: 12px; color: #8E8E96")}>
            {s.sub}
          </a>
        ) : (
          <span style={css("font-size: 12px; color: #8E8E96")}>{s.sub}</span>
        )}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------- stats (Asset aside markup)

/** The 24H / 7D / 30D / 90D strip (colors follow the sign). */
export function PerfGrid({ items }: { items: Perf[] }) {
  return (
    <div style={css("display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); background: #0B0B0D; border: 1px solid #1C1C20; border-radius: 12px; overflow: hidden")}>
      {items.map((p, i) => (
        <div key={p.label} style={css(`padding: 10px 4px; text-align: center;${i ? " border-left: 1px solid #1C1C20;" : ""}`)}>
          <div style={css("font-size: 11px; color: #8E8E96")}>{p.label}</div>
          <div style={css(`margin-top: 4px; font-size: 14px; font-weight: 600; color: ${p.col}`)}>{p.value}</div>
        </div>
      ))}
    </div>
  );
}

/** Large stat value (e.g. 24h change) with a sign color. */
export function BigValue({ value, col }: { value: string; col: string }) {
  return <div style={css(`margin-top: 4px; font-family: 'Inter Tight', sans-serif; font-size: 24px; font-weight: 600; color: ${col}`)}>{value}</div>;
}

// ---------------------------------------------------------------- candlestick chart (Asset chart markup)

/** Zoomable candle chart: wheel / pinch to zoom, drag to pan, double-click to reset, hover for one candle's OHLC. */
export function ZoomCandleChart(p: {
  candles: Candle[];
  interval: IntervalLabel;
  resetKey: string;
  title: string;
  aria: string;
  source: string | null;
  emptyText: string;
  chgDp?: number;
  /** Called when the view nears the oldest loaded candle (load the page before it). */
  onNeedOlder?: () => void;
}) {
  // a short series keeps the reference spacing (20 slots, left-aligned); a longer one always fills the width
  const slotsFor = (count: number): number => (p.candles.length >= 20 ? count : chartSlots(count));
  const z = useChartZoom(p.candles.length, intervalSpec(p.interval).show, `${p.resetKey}:${p.interval}`, slotsFor, p.candles[0]?.t ?? null);
  const start = z.view.end - z.view.count;
  const { onNeedOlder } = p;
  useEffect(() => {
    if (onNeedOlder && p.candles.length && start <= Math.max(10, z.view.count / 4)) onNeedOlder();
  }, [onNeedOlder, start, z.view.count, p.candles.length]);
  const vis = visible(p.candles, z.view);
  const slots = slotsFor(vis.length);
  const slot = z.hoverFx === null ? null : Math.floor(z.hoverFx * slots);
  const focus = slot !== null && slot < vis.length ? slot : null;
  const m = useMemo(() => buildChart(vis, p.chgDp ?? 1, 0.18, focus, slots), [vis, p.chgDp, focus, slots]);
  return <CandleChart m={m} title={p.title} aria={p.aria} source={p.source} emptyText={p.emptyText} zoom={z} />;
}

export function CandleChart({
  m,
  title,
  aria,
  source,
  emptyText,
  zoom,
}: {
  m: ChartModel;
  title: string;
  aria: string;
  source: string | null;
  emptyText: string;
  zoom?: ChartZoom;
}) {
  let body: ReactNode;
  if (m.empty) {
    body = (
      <div style={css("position: absolute; inset: 0 64px 28px 0; display: flex; align-items: center; justify-content: center; font-size: 13px; color: #8E8E96")}>{emptyText}</div>
    );
  } else {
    body = (
      <div
        ref={zoom?.ref}
        {...zoom?.handlers}
        title={zoom ? "Scroll or pinch to zoom, drag to move, double-click to reset" : undefined}
        style={css(`position: absolute; left: 0; right: 64px; top: 0; bottom: 28px${zoom ? "; cursor: crosshair; touch-action: pan-y; user-select: none" : ""}`)}
      >
        <svg viewBox="0 0 1000 520" preserveAspectRatio="none" aria-hidden="true" shapeRendering="crispEdges" style={css("display: block; width: 100%; height: 100%")}>
          {m.gridX.map((x, i) => (
            <line key={`gx${i}`} x1={x} y1="0" x2={x} y2="520" stroke="#17171A" strokeWidth="1" />
          ))}
          {m.gridY.map((y, i) => (
            <line key={`gy${i}`} x1="0" y1={y} x2="1000" y2={y} stroke="#17171A" strokeWidth="1" />
          ))}
          {m.bars.map((b, i) => (
            <g key={i}>
              {m.hasVolume ? <rect x={b.x} y={b.volY} width={b.w} height={b.volH} fill={b.col} opacity="0.28" /> : null}
              <rect x={b.wickX} y={b.wickY} width="1" height={b.wickH} fill={b.col} />
              <rect x={b.x} y={b.bodyY} width={b.w} height={b.bodyH} fill={b.col} />
            </g>
          ))}
          {m.focusX !== null ? <line x1={m.focusX} y1="0" x2={m.focusX} y2="520" stroke="#3A3A42" strokeWidth="1" strokeDasharray="3 3" /> : null}
        </svg>
      </div>
    );
  }
  return (
    <div style={css("position: relative; height: 520px")} role="img" aria-label={aria}>
      {body}
      <div style={css("position: absolute; left: 14px; top: 12px; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; font-size: 12px; color: #8E8E96")}>
        <span style={css("font-size: 14px; font-weight: 600; color: #F2F2F3")}>{title}</span>
        {m.ohlc ? (
          <>
            {(["o", "h", "l", "c"] as const).map((k) => (
              <span key={k}>
                {`${k.toUpperCase()} `}
                <span style={css(`color: ${m.ohlc!.col}`)}>{m.ohlc![k]}</span>
              </span>
            ))}
            <span style={css(`color: ${m.ohlc.col}`)}>{m.ohlc.chg}</span>
          </>
        ) : null}
        {source ? <span>{`Source: ${source}`}</span> : null}
      </div>
      <div style={css("position: absolute; right: 0; top: 0; bottom: 28px; width: 64px; border-left: 1px solid #1C1C20; font-size: 11px; color: #8E8E96")}>
        {m.yTicks.map((t) => (
          <span key={t.label} style={css(`position: absolute; left: 8px; top: ${t.pct}%; transform: translateY(-50%)`)}>
            {t.label}
          </span>
        ))}
        {m.last ? (
          <span style={css(`position: absolute; left: 0; right: 0; top: ${m.last.pct}%; transform: translateY(-50%); padding: 3px 8px; background: ${m.last.col}; color: #0B0B0D; font-weight: 600`)}>
            {m.last.label}
          </span>
        ) : null}
      </div>
      <div style={css("position: absolute; left: 0; right: 64px; bottom: 0; height: 28px; border-top: 1px solid #1C1C20; font-size: 11px; color: #8E8E96")}>
        {m.xTicks.map((t, i) => (
          <span key={i} style={css(`position: absolute; left: ${t.pct}%; top: 7px; transform: translateX(-50%)`)}>
            {t.label}
          </span>
        ))}
      </div>
      <div style={css("position: absolute; right: 0; bottom: 0; width: 64px; height: 28px; border-top: 1px solid #1C1C20; border-left: 1px solid #1C1C20; box-sizing: border-box")}></div>
    </div>
  );
}
