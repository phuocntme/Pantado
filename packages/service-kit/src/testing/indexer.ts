import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PublicClient } from "viem";
import { findRepoRoot, type Deployment } from "@pantado/shared";

export interface IndexerEnv {
  url: string;
  /** Resolve once the indexer has processed the chain head. */
  caughtUp(client: PublicClient): Promise<void>;
  stop(): void;
}

async function waitFor(fn: () => Promise<boolean>, ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("timeout waiting for indexer");
}

/** Run services/indexer (Ponder, PGlite) against an Anvil deployment, for tests. */
export async function startIndexer(rpcUrl: string, deployment: Deployment): Promise<IndexerEnv> {
  const dir = mkdtempSync(join(tmpdir(), "pantado-indexer-"));
  const depFile = join(dir, "deployment.json");
  writeFileSync(depFile, JSON.stringify(deployment));
  const port = 42_100 + Math.floor(Math.random() * 2000);
  const url = `http://127.0.0.1:${port}`;
  const child: ChildProcess = spawn("npx", ["ponder", "start", "--port", String(port)], {
    cwd: join(findRepoRoot(), "services/indexer"),
    env: {
      ...process.env,
      PANTADO_ROOT: findRepoRoot(),
      PANTADO_PROFILE: "contest",
      PANTADO_DEPLOYMENTS: depFile,
      EXECUTION_RPC_URL: rpcUrl,
      PONDER_PGLITE_DIR: join(dir, "pglite"),
      DATABASE_SCHEMA: "pantado",
      INDEXER_POLL_MS: "200",
      DATABASE_URL: "",
    },
    stdio: "ignore",
  });
  await waitFor(async () => (await fetch(`${url}/ready`)).ok, 120_000);
  return {
    url,
    stop: () => void child.kill("SIGKILL"),
    async caughtUp(client) {
      const head = Number(await client.getBlockNumber());
      await waitFor(async () => {
        const s = (await (await fetch(`${url}/status`)).json()) as Record<string, { block?: { number: number } }>;
        return Object.values(s).some((c) => (c.block?.number ?? 0) >= head);
      }, 60_000);
    },
  };
}
