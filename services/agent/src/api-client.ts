/** The agent reads data only through the public Pantado API (spec §10.1, STRUCTURE: HTTP only). */
export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface PantadoApi {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
}

export function httpApi(baseUrl: string, timeoutMs = 5000): PantadoApi {
  const handle = async <T>(r: Response): Promise<T> => {
    const body = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
    if (!r.ok) throw new ApiClientError(r.status, body.error?.message ?? `API ${r.status}`);
    return body as T;
  };
  return {
    get: async <T>(path: string) => handle<T>(await fetch(new URL(path, baseUrl), { signal: AbortSignal.timeout(timeoutMs) })),
    post: async <T>(path: string, body: unknown) =>
      handle<T>(
        await fetch(new URL(path, baseUrl), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        }),
      ),
  };
}

/** In-memory API for tests: path → response (or a function of the path). */
export function fakeApi(routes: Record<string, unknown | ((path: string) => unknown)>): PantadoApi & { calls: string[] } {
  const calls: string[] = [];
  const find = (path: string): unknown => {
    calls.push(path);
    const key = Object.keys(routes).find((k) => (k.endsWith("*") ? path.startsWith(k.slice(0, -1)) : k === path));
    if (!key) throw new ApiClientError(404, `no route ${path}`);
    const v = routes[key];
    return typeof v === "function" ? (v as (p: string) => unknown)(path) : v;
  };
  return {
    calls,
    get: async <T>(path: string) => find(path) as T,
    post: async <T>(path: string, body: unknown) => find(`${path} ${JSON.stringify(body)}`) as T,
  };
}
