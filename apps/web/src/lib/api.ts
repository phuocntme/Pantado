"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { CONFIG } from "./config";

/** Typed API error surfaced to the UI with the server's message. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function handle<T>(r: Response): Promise<T> {
  const body = (await r.json().catch(() => ({}))) as { error?: { code: string; message: string } };
  if (!r.ok) throw new ApiRequestError(r.status, body.error?.code ?? "Error", body.error?.message ?? `Request failed (${r.status})`);
  return body as T;
}

export const apiGet = async <T>(path: string): Promise<T> => handle<T>(await fetch(`${CONFIG.apiUrl}${path}`, { cache: "no-store" }));
export const apiPost = async <T>(path: string, body: unknown): Promise<T> =>
  handle<T>(await fetch(`${CONFIG.apiUrl}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

export interface Loadable<T> {
  data: T | null;
  error: ApiRequestError | null;
  loading: boolean;
  reload: () => void;
}

/** GET with optional polling. `path = null` skips the request. */
export function useApi<T>(path: string | null, pollMs = 0): Loadable<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const seq = useRef(0);
  const load = useCallback(() => {
    if (path === null) return;
    const n = ++seq.current;
    apiGet<T>(path)
      .then((d) => {
        if (n === seq.current) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (n === seq.current) setData(null);
        if (n === seq.current) setError(e instanceof ApiRequestError ? e : new ApiRequestError(0, "Network", "Cannot reach the Pantado API."));
      })
      .finally(() => n === seq.current && setLoading(false));
  }, [path]);
  useEffect(() => {
    // a new request never shows the previous path's data
    setData(null);
    setError(null);
    setLoading(path !== null);
    load();
    if (!pollMs || path === null) return;
    const t = setInterval(load, pollMs);
    return () => clearInterval(t);
  }, [load, path, pollMs]);
  return { data, error, loading, reload: load };
}
