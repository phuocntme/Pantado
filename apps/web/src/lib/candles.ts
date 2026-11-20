"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, useApi } from "./api";

export interface CandleRow {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface CandlePage {
  source: string | null;
  candles: CandleRow[];
}

/** Older pages before the newest candles, oldest first; pure so it can be tested. */
export function mergePages(older: CandleRow[], newest: CandleRow[]): CandleRow[] {
  const first = newest[0]?.t;
  return first === undefined ? older : [...older.filter((c) => c.t < first), ...newest];
}

/**
 * Candles of one asset and interval: the newest page (polled) plus older pages fetched on demand with
 * `before=` until the history runs out.
 */
export function useCandleHistory(
  path: string | null,
  pageSize: number,
  pollMs: number,
): { data: CandlePage | null; loadOlder: () => void; exhausted: boolean } {
  const newest = useApi<CandlePage>(path, pollMs);
  const [older, setOlder] = useState<CandleRow[]>([]);
  const [exhausted, setExhausted] = useState(false);
  const busy = useRef(false);
  const gen = useRef(0);
  useEffect(() => {
    gen.current++;
    busy.current = false;
    setOlder([]);
    setExhausted(false);
  }, [path]);
  const merged = newest.data ? mergePages(older, newest.data.candles) : null;
  const oldest = merged?.[0]?.t;
  const loadOlder = useCallback(() => {
    if (!path || busy.current || exhausted || oldest === undefined) return;
    busy.current = true;
    const g = gen.current;
    const sep = path.includes("?") ? "&" : "?";
    const url = `${path.replace(/([?&])limit=\d+/, "$1limit=" + String(pageSize))}${sep}before=${oldest}`;
    apiGet<CandlePage>(url)
      .then((p) => {
        if (g !== gen.current) return;
        const rows = p.candles.filter((c) => c.t < oldest);
        if (!rows.length) setExhausted(true);
        else setOlder((o) => [...rows, ...o.filter((c) => c.t >= oldest)]);
      })
      .catch(() => undefined)
      .finally(() => {
        if (g === gen.current) busy.current = false;
      });
  }, [path, pageSize, exhausted, oldest]);
  return { data: newest.data ? { source: newest.data.source, candles: merged ?? [] } : null, loadOlder, exhausted };
}
