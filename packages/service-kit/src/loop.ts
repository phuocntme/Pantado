import type { Logger } from "./log.js";

export interface Loop {
  stop(): Promise<void>;
  readonly ticks: number;
}

/** Run `tick` now and then every `intervalMs` (never overlapping). Errors are logged, not fatal. */
export function runLoop(name: string, intervalMs: number, tick: () => Promise<void>, log: Logger): Loop {
  let stopped = false;
  let ticks = 0;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> = Promise.resolve();
  const step = (): void => {
    if (stopped) return;
    running = tick()
      .catch((e: unknown) => log.error(`${name} tick failed`, { error: e instanceof Error ? e.message : String(e) }))
      .finally(() => {
        ticks += 1;
        if (!stopped) timer = setTimeout(step, intervalMs);
      });
  };
  step();
  return {
    get ticks() {
      return ticks;
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await running;
    },
  };
}

/** Resolve on SIGINT / SIGTERM. */
export function onShutdown(fn: () => Promise<void>): void {
  const handler = (): void => {
    void fn().finally(() => process.exit(0));
  };
  process.once("SIGINT", handler);
  process.once("SIGTERM", handler);
}
