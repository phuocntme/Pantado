"use client";
import { css } from "./tpl";

/**
 * Chart intervals of the reference chart header (15m · 1h · 4h · 1D · 1W). `fetch` = candles requested first
 * (older pages load while dragging back to the start of the history), `show` = candles visible before zooming.
 */
export const INTERVALS = [
  { label: "15m", api: "15m", sec: 900, fetch: 1000, show: 192 },
  { label: "1h", api: "1h", sec: 3600, fetch: 1000, show: 168 },
  { label: "4h", api: "4h", sec: 14_400, fetch: 1000, show: 180 },
  { label: "1D", api: "1d", sec: 86_400, fetch: 1000, show: 120 },
  { label: "1W", api: "1w", sec: 604_800, fetch: 300, show: 104 },
] as const;

/** Candles per older page. */
export const PAGE = 1000;

export type IntervalLabel = (typeof INTERVALS)[number]["label"];
export type IntervalSpec = (typeof INTERVALS)[number];
export const DEFAULT_INTERVAL: IntervalLabel = "1D";

export function intervalSpec(label: IntervalLabel): IntervalSpec {
  return INTERVALS.find((i) => i.label === label) ?? INTERVALS[3];
}

/** The reference "Interval" group, live: the picked interval is bold and `aria-pressed`. */
export function IntervalBar({ value, onPick }: { value: IntervalLabel; onPick: (v: IntervalLabel) => void }) {
  return (
    <div role="group" aria-label="Interval" style={css("display: flex; flex-wrap: wrap; align-items: center")}>
      {INTERVALS.map((i) => {
        const on = i.label === value;
        return (
          <button
            key={i.label}
            type="button"
            aria-pressed={on}
            onClick={() => onPick(i.label)}
            style={css(
              on
                ? "min-height: 44px; padding: 0 10px; background: transparent; border: 0; color: #F2F2F3; font-size: 13px; font-weight: 700"
                : "min-height: 44px; padding: 0 10px; background: transparent; border: 0; color: #8E8E96; font-size: 13px; font-weight: 500",
            )}
          >
            {i.label}
          </button>
        );
      })}
      <span style={css("width: 1px; height: 20px; background: #1C1C20; margin: 0 8px")} aria-hidden="true"></span>
      <button type="button" style={css("min-height: 44px; padding: 0 10px; background: transparent; border: 0; color: #B4B4BB; font-size: 13px")}>
        {"Indicators"}
      </button>
    </div>
  );
}
