"use client";
import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../lib/api";

/**
 * GET one path per key (e.g. one request per index) and keep the results by key. A failed request maps to
 * null ("—" in the view model). Re-fetches when the key set changes or every `pollMs`.
 */
export function useMany<T, R>(keys: string[], path: (k: string) => string, pick: (t: T) => R, pollMs = 0): Record<string, R | null> {
  const sig = useMemo(() => [...new Set(keys)].sort().join(","), [keys]);
  const [out, setOut] = useState<Record<string, R | null>>({});
  useEffect(() => {
    const ks = sig ? sig.split(",") : [];
    let live = true;
    const load = (): void => {
      void Promise.all(
        ks.map(async (k) => {
          try {
            return [k, pick(await apiGet<T>(path(k)))] as const;
          } catch {
            return [k, null] as const;
          }
        }),
      ).then((rows) => {
        if (live) setOut(Object.fromEntries(rows));
      });
    };
    load();
    const t = pollMs ? setInterval(load, pollMs) : null;
    return () => {
      live = false;
      if (t) clearInterval(t);
    };
    // path / pick are stable per call site
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, pollMs]);
  return out;
}
