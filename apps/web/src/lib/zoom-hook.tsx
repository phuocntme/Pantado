"use client";
import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { clampView, defaultView, panView, zoomView, type View } from "./zoom";

export interface ChartZoom {
  view: View;
  /** Pointer position over the plot, 0 (left) … 1 (right); null when the pointer is outside or dragging. */
  hoverFx: number | null;
  /** True when the view is not the default one (double-click resets). */
  zoomed: boolean;
  ref: (el: HTMLDivElement | null) => void;
  handlers: {
    onPointerDown: (e: RPointerEvent<HTMLDivElement>) => void;
    onPointerMove: (e: RPointerEvent<HTMLDivElement>) => void;
    onPointerUp: (e: RPointerEvent<HTMLDivElement>) => void;
    onPointerCancel: (e: RPointerEvent<HTMLDivElement>) => void;
    onPointerLeave: () => void;
    onDoubleClick: () => void;
  };
}

/**
 * Zoom and pan for a candle chart plot: mouse wheel / trackpad pinch zooms around the pointer, horizontal
 * scroll or drag pans, two-finger pinch zooms on touch screens, double-click resets. `slots(count)` is how
 * many candle slots the layout spreads across the plot width for `count` visible candles.
 */
export function useChartZoom(
  n: number,
  defaultMax: number,
  resetKey: string,
  slots: (count: number) => number = (c) => c,
  /** Time of the first candle: when it moves back, older candles were prepended and the view shifts with them. */
  firstT: number | null = null,
): ChartZoom {
  const [view, setView] = useState<View>(() => defaultView(n, defaultMax));
  const [hoverFx, setHoverFx] = useState<number | null>(null);
  const el = useRef<HTMLDivElement | null>(null);
  const nRef = useRef(n);
  const firstRef = useRef(firstT);
  const viewRef = useRef(view);
  viewRef.current = view;
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const pointers = useRef(new Map<number, number>()); // pointerId → clientX
  const drag = useRef<{ x: number; view: View; pinch: number | null } | null>(null);

  // new interval / asset: back to the default view; new candles: keep following the right edge
  useEffect(() => {
    setView(defaultView(nRef.current, defaultMax));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);
  useEffect(() => {
    const prev = nRef.current;
    const prevFirst = firstRef.current;
    nRef.current = n;
    firstRef.current = firstT;
    const prepended = prevFirst !== null && firstT !== null && firstT < prevFirst && n > prev ? n - prev : 0;
    // a drag in progress keeps its anchor on the same candles
    const d = drag.current;
    if (prepended && d) drag.current = { ...d, view: { count: d.view.count, end: d.view.end + prepended } };
    setView((v) =>
      prev === 0 || v.count === 0
        ? defaultView(n, defaultMax)
        : prepended
          ? clampView({ count: v.count, end: v.end + prepended }, n)
          : v.end >= prev
            ? clampView({ count: v.count, end: n }, n)
            : clampView(v, n),
    );
  }, [n, defaultMax, firstT]);

  const fx = (clientX: number): number => {
    const r = el.current?.getBoundingClientRect();
    return r && r.width > 0 ? Math.min(1, Math.max(0, (clientX - r.left) / r.width)) : 1;
  };
  const barsPerPx = (): number => {
    const r = el.current?.getBoundingClientRect();
    return r && r.width > 0 ? slotsRef.current(viewRef.current.count) / r.width : 0;
  };

  const onWheel = useCallback((e: WheelEvent) => {
    const N = nRef.current;
    if (N <= 0) return;
    e.preventDefault();
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && !e.ctrlKey) {
      setView((v) => panView(v, N, -e.deltaX * barsPerPx()));
      return;
    }
    const f = Math.exp(Math.max(-1, Math.min(1, e.deltaY / (e.ctrlKey ? 100 : 300))));
    const a = fx(e.clientX);
    setView((v) => zoomView(v, N, f, a));
  }, []);

  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      if (el.current) el.current.removeEventListener("wheel", onWheel);
      el.current = node;
      // non-passive so the page does not scroll while zooming the chart
      if (node) node.addEventListener("wheel", onWheel, { passive: false });
    },
    [onWheel],
  );

  const spread = (): number | null => {
    const xs = [...pointers.current.values()];
    return xs.length >= 2 ? Math.abs((xs[0] ?? 0) - (xs[1] ?? 0)) : null;
  };

  const handlers: ChartZoom["handlers"] = {
    onPointerDown: (e) => {
      pointers.current.set(e.pointerId, e.clientX);
      e.currentTarget.setPointerCapture?.(e.pointerId);
      drag.current = { x: e.clientX, view: viewRef.current, pinch: spread() };
      setHoverFx(null);
    },
    onPointerMove: (e) => {
      if (!pointers.current.has(e.pointerId)) {
        if (e.pointerType === "mouse") setHoverFx(fx(e.clientX));
        return;
      }
      pointers.current.set(e.pointerId, e.clientX);
      const d = drag.current;
      if (!d) return;
      const N = nRef.current;
      const s = spread();
      if (s !== null && d.pinch !== null && d.pinch > 0 && s > 0) {
        const xs = [...pointers.current.values()];
        setView(zoomView(d.view, N, d.pinch / s, fx(((xs[0] ?? 0) + (xs[1] ?? 0)) / 2)));
      } else if (s === null) {
        setView(panView(d.view, N, (e.clientX - d.x) * barsPerPx()));
      }
    },
    onPointerUp: (e) => {
      pointers.current.delete(e.pointerId);
      drag.current = pointers.current.size ? { x: [...pointers.current.values()][0] ?? 0, view: viewRef.current, pinch: spread() } : null;
      if (e.pointerType === "mouse") setHoverFx(fx(e.clientX));
    },
    onPointerCancel: (e) => {
      pointers.current.delete(e.pointerId);
      drag.current = null;
    },
    onPointerLeave: () => {
      if (!drag.current) setHoverFx(null);
    },
    onDoubleClick: () => setView(defaultView(nRef.current, defaultMax)),
  };

  const def = defaultView(n, defaultMax);
  return { view, hoverFx, zoomed: view.count !== def.count || view.end !== def.end, ref, handlers };
}
