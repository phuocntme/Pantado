import { createServer, type Server } from "node:http";
import { Registry, collectDefaultMetrics } from "prom-client";

export interface HealthReport {
  ok: boolean;
  [key: string]: unknown;
}

export interface HealthServer {
  server: Server;
  registry: Registry;
  port: number;
  close(): Promise<void>;
}

/** `/health` (200 when ok, 503 otherwise) and `/metrics` (Prometheus). Port 0 picks a free port. */
export async function startHealthServer(opts: {
  service: string;
  port: number;
  registry?: Registry;
  health: () => HealthReport | Promise<HealthReport>;
}): Promise<HealthServer> {
  const registry = opts.registry ?? new Registry();
  registry.setDefaultLabels({ service: opts.service });
  collectDefaultMetrics({ register: registry });
  const server = createServer((req, res) => {
    void (async () => {
      try {
        if (req.url === "/health") {
          const h = await opts.health();
          res.writeHead(h.ok ? 200 : 503, { "content-type": "application/json" });
          res.end(JSON.stringify({ service: opts.service, ...h }, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v)));
        } else if (req.url === "/metrics") {
          res.writeHead(200, { "content-type": registry.contentType });
          res.end(await registry.metrics());
        } else {
          res.writeHead(404).end();
        }
      } catch (e) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(opts.port, resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : opts.port;
  return {
    server,
    registry,
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
