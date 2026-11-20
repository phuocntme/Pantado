import websocket from "@fastify/websocket";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { displayPrices, type ApiDeps } from "./deps.js";

/**
 * WS channels (spec §9.7): `prices`, `trades:<assetId>`, `level:<indexAddress>`, `auctions`.
 * Client → `{"subscribe": ["prices", "level:0x…"]}` / `{"unsubscribe": [...]}`. Server → `{channel, data}`.
 * A poller diffs upstream state and pushes only changes.
 */
export async function registerWs(app: FastifyInstance, d: ApiDeps, pollMs = 2000): Promise<() => void> {
  await app.register(websocket);
  const subs = new Map<WebSocket, Set<string>>();
  const last = new Map<string, string>();

  app.get("/ws", { websocket: true }, (socket) => {
    subs.set(socket, new Set());
    socket.on("message", (raw: Buffer) => {
      try {
        const m = JSON.parse(raw.toString()) as { subscribe?: string[]; unsubscribe?: string[] };
        const s = subs.get(socket);
        if (!s) return;
        for (const c of m.subscribe ?? []) if (/^(prices|auctions|trades:[a-z0-9]+|level:0x[0-9a-fA-F]{40})$/.test(c)) s.add(c.toLowerCase());
        for (const c of m.unsubscribe ?? []) s.delete(c.toLowerCase());
        // replay the last value so a new subscriber renders immediately
        for (const c of m.subscribe ?? []) {
          const v = last.get(c.toLowerCase());
          if (v) socket.send(v);
        }
      } catch {
        socket.send(JSON.stringify({ error: "bad message" }));
      }
    });
    socket.on("close", () => subs.delete(socket));
  });

  const publish = (channel: string, data: unknown): void => {
    const msg = JSON.stringify({ channel, data }, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v));
    if (last.get(channel) === msg) return;
    last.set(channel, msg);
    for (const [sock, s] of subs) if (s.has(channel) && sock.readyState === 1) sock.send(msg);
  };

  const wanted = (): Set<string> => new Set([...subs.values()].flatMap((s) => [...s]));

  const tick = async (): Promise<void> => {
    const w = wanted();
    if (w.size === 0) return;
    if (w.has("prices")) publish("prices", Object.fromEntries(await displayPrices(d)));
    for (const c of w) {
      if (c.startsWith("level:")) {
        const index = c.slice(6);
        const r = await d.gql<{ indexLevelss: { items: { block: string; ts: string; level: string }[] } }>(
          `query($i: String!) { indexLevelss(where: { index: $i }, orderBy: "block", orderDirection: "desc", limit: 1) { items { block ts level } } }`,
          { i: index },
        );
        if (r.indexLevelss.items[0]) publish(c, r.indexLevelss.items[0]);
      } else if (c.startsWith("trades:")) {
        const exec = d.deployment.assets[c.slice(7)];
        if (!exec) continue;
        const r = await d.gql<{ swapss: { items: unknown[] } }>(
          `query($a: String!) { swapss(where: { asset: $a }, orderBy: "ts", orderDirection: "desc", limit: 20) { items { id side amount usdc account ts txHash } } }`,
          { a: exec.toLowerCase() },
        );
        publish(c, r.swapss.items);
      } else if (c === "auctions") {
        const r = await d.gql<{ auctionss: { items: unknown[] } }>(
          `{ auctionss(orderBy: "ts", orderDirection: "desc", limit: 50) { items { index planId auctionId sellAsset buyAsset lot filled startPrice floorPrice endAt ts } } }`,
        );
        publish("auctions", r.auctionss.items);
      }
    }
  };

  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void tick()
      .catch(() => undefined)
      .finally(() => (running = false));
  }, pollMs);
  return () => clearInterval(timer);
}
