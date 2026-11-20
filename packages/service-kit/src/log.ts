export type Level = "debug" | "info" | "warn" | "error";
export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function replacer(_k: string, v: unknown): unknown {
  return typeof v === "bigint" ? v.toString() : v;
}

/** JSON-lines logger. `LOG_LEVEL` sets the minimum level (default info). */
export function createLogger(service: string, base: Record<string, unknown> = {}): Logger {
  const min = ORDER[(process.env.LOG_LEVEL as Level | undefined) ?? "info"] ?? ORDER.info;
  const write = (level: Level, msg: string, fields?: Record<string, unknown>): void => {
    if (ORDER[level] < min) return;
    const line = JSON.stringify({ t: new Date().toISOString(), level, service, msg, ...base, ...fields }, replacer);
    (level === "error" || level === "warn" ? process.stderr : process.stdout).write(`${line}\n`);
  };
  return {
    debug: (m, f) => write("debug", m, f),
    info: (m, f) => write("info", m, f),
    warn: (m, f) => write("warn", m, f),
    error: (m, f) => write("error", m, f),
    child: (f) => createLogger(service, { ...base, ...f }),
  };
}
