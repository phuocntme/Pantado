/**
 * Local full stack for app e2e (spec §14 on Anvil): Anvil + Deploy (DEMO) + seed-demo + indexer (PGlite) +
 * market-data (seed mode; STACK_PRICES=live for real markets) + api + agent (when an LLM key is set) + web (dev wallet = Anvil key, chain 31337 only). Writes `.stack.json` with URLs
 * and stays up until killed. Used by playwright.config.ts as its webServer.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { privateKeyToAccount } from "viem/accounts";
import { ANVIL_KEYS, startAnvilWithDeployment } from "@pantado/sdk/testing";
import { startIndexer } from "@pantado/service-kit/testing";
import { findRepoRoot } from "@pantado/shared";

const root = findRepoRoot();
const procs: ChildProcess[] = [];
const PORTS = { api: 3101, market: 8181, web: Number(process.env.WEB_PORT ?? 3100), pusher: 9301, trigger: 9302, filler: 9303, autoFund: 9304, agent: Number(process.env.AGENT_PORT ?? 3002) };
// STACK_KEEPERS=1 also runs price-pusher, rebalance-trigger and auction-filler (acceptance on Anvil)
const KEEPERS = process.env.STACK_KEEPERS === "1";
// STACK_PRICES=live: market-data reads the real mainnet markets (prices, candles, changes) instead of config seeds;
// keep the default seed mode for tests that warp time (acceptance with ACCEPTANCE_FAST_FORWARD, Playwright)
const LIVE_PRICES = process.env.STACK_PRICES === "live";
// STACK_KEEPER_ROLES=1: grant the keeper roles at deploy but run no keepers (they run elsewhere, e.g. Docker)
const ROLES = KEEPERS || process.env.STACK_KEEPER_ROLES === "1";
// Anvil development keys: #2 pusher, #4 filler, #5 trigger, #6 auto-fund (local chain only)
const KEYS = { pusher: ANVIL_KEYS[2], filler: ANVIL_KEYS[4], trigger: ANVIL_KEYS[5], autoFund: ANVIL_KEYS[6] };
// ANVIL_PORT: a fixed RPC port, so a browser wallet's saved "Pantado local" network survives restarts (demo)
const ANVIL_PORT = process.env.ANVIL_PORT ? Number(process.env.ANVIL_PORT) : undefined;
// local stand-in for the auto-fund secret (the API → keeper call); never used off this machine
const LOCAL_FUND_SECRET = "pantado-local-stack";
// Ask agent: runs when AGENT_LLM_API_KEY is set (environment or the repo's .env). Only the AGENT_LLM_* and model
// variables are taken from .env, so its Fuji keys and URLs never reach this local stack. No agent-manager here.
const AGENT_VARS = ["AGENT_LLM_PROVIDER", "AGENT_LLM_API_KEY", "AGENT_AUTO_MODEL", "AGENT_DEEP_MODEL"] as const;
function agentEnv(): Record<string, string> | null {
  const file = join(root, ".env");
  const fromFile = existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
  const out: Record<string, string> = {};
  for (const k of AGENT_VARS) {
    const v = process.env[k] || fromFile[k];
    if (v) out[k] = v;
  }
  return out.AGENT_LLM_API_KEY ? out : null;
}

function start(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): ChildProcess {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "inherit", "inherit"] });
  procs.push(p);
  return p;
}

async function waitHttp(url: string, ms = 180_000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).status < 500) return;
    } catch {
      /* not up */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timeout ${url}`);
}

async function main(): Promise<void> {
  const env = await startAnvilWithDeployment({
    demo: true,
    port: ANVIL_PORT,
    ...(ROLES ? { pusher: privateKeyToAccount(KEYS.pusher).address, filler: privateKeyToAccount(KEYS.filler).address } : {}),
    // a browser wallet connected to the local stack gets test USDC + AVAX once, like on Fuji
    ...(KEEPERS ? { autoFund: privateKeyToAccount(KEYS.autoFund).address } : {}),
  });
  const depFile = join(root, "contracts/deployments/e2e.json");
  writeFileSync(depFile, JSON.stringify(env.deployment, null, 2));
  const common = { PANTADO_ROOT: root, PANTADO_PROFILE: "contest", PANTADO_DEPLOYMENTS: depFile, EXECUTION_RPC_URL: env.rpcUrl, LOG_LEVEL: "warn" };

  const seed = spawnSync("pnpm", ["seed-demo"], {
    cwd: join(root, "scripts"),
    env: { ...process.env, ...common, DEPLOYER_PRIVATE_KEY: ANVIL_KEYS[0], AGENT_MANAGER_KEY: ANVIL_KEYS[3] },
    encoding: "utf8",
  });
  if (seed.status !== 0) throw new Error(`seed failed: ${seed.stderr}`);

  const ix = await startIndexer(env.rpcUrl, env.deployment);
  start("pnpm", ["start"], join(root, "services/market-data"), {
    ...common,
    PORT: String(PORTS.market),
    HEALTH_PORT: "0",
    ...(LIVE_PRICES ? { MARKET_DATA_MODE: "live", HISTORY_FILE: join(root, "test/e2e-app/.market-history.json") } : { MARKET_DATA_MODE: "seed" }),
  });
  if (KEEPERS) {
    start("pnpm", ["start"], join(root, "keepers/auto-fund"), { ...common, PORT: String(PORTS.autoFund), HEALTH_PORT: "0", KEEPER_AUTO_FUND_KEY: KEYS.autoFund, AUTO_FUND_SECRET: LOCAL_FUND_SECRET });
  }
  start("pnpm", ["start"], join(root, "services/api"), {
    ...common,
    PORT: String(PORTS.api),
    INDEXER_URL: ix.url,
    MARKET_DATA_URL: `http://127.0.0.1:${PORTS.market}`,
    ...(KEEPERS ? { AUTO_FUND_URL: `http://127.0.0.1:${PORTS.autoFund}`, AUTO_FUND_SECRET: LOCAL_FUND_SECRET } : {}),
  });
  await waitHttp(`http://127.0.0.1:${PORTS.api}/health`);
  if (KEEPERS) {
    const mkt = { MARKET_DATA_URL: `http://127.0.0.1:${PORTS.market}` };
    start("pnpm", ["start"], join(root, "keepers/price-pusher"), { ...common, ...mkt, PORT: String(PORTS.pusher), KEEPER_PRICE_PUSHER_KEY: KEYS.pusher });
    start("pnpm", ["start"], join(root, "keepers/rebalance-trigger"), { ...common, PORT: String(PORTS.trigger), KEEPER_TRIGGER_KEY: KEYS.trigger });
    start("pnpm", ["start"], join(root, "keepers/auction-filler"), { ...common, ...mkt, PORT: String(PORTS.filler), KEEPER_FILLER_KEY: KEYS.filler });
    for (const p of [PORTS.pusher, PORTS.trigger, PORTS.filler]) await waitHttp(`http://127.0.0.1:${p}/health`);
  }
  const agent = agentEnv();
  if (agent) {
    start("pnpm", ["start"], join(root, "services/agent"), { ...common, ...agent, PORT: String(PORTS.agent), API_URL: `http://127.0.0.1:${PORTS.api}` });
    await waitHttp(`http://127.0.0.1:${PORTS.agent}/health`);
  } else console.log("agent off: set AGENT_LLM_API_KEY (and AGENT_AUTO_MODEL / AGENT_DEEP_MODEL) in .env to answer in Ask");

  // e2e wallet = Anvil key #1 (funded by tests through the deployer); never valid off chain 31337
  const webEnv = {
    ...common,
    NEXT_PUBLIC_API_URL: `http://127.0.0.1:${PORTS.api}`,
    NEXT_PUBLIC_RPC_URL: env.rpcUrl,
    NEXT_PUBLIC_AGENT_URL: `http://127.0.0.1:${PORTS.agent}`,
    NEXT_PUBLIC_DEV_WALLET_KEY: ANVIL_KEYS[1],
    NEXT_TELEMETRY_DISABLED: "1",
  };
  const cfg = spawnSync("pnpm", ["run", "public-config"], { cwd: join(root, "apps/web"), env: { ...process.env, ...webEnv }, encoding: "utf8" });
  if (cfg.status !== 0) throw new Error(`web config failed: ${cfg.stderr}`);
  writeFileSync(
    join(root, "test/e2e-app/.stack.json"),
    JSON.stringify({
      rpcUrl: env.rpcUrl,
      api: `http://127.0.0.1:${PORTS.api}`,
      web: `http://127.0.0.1:${PORTS.web}`,
      indexer: ix.url,
      deployment: depFile,
      health: [`http://127.0.0.1:${PORTS.api}/health`, ...(KEEPERS ? [PORTS.pusher, PORTS.trigger, PORTS.filler].map((p) => `http://127.0.0.1:${p}/health`) : [])],
    }),
  );
  if (process.env.STACK_WEB === "0") {
    console.log("stack ready (no web)");
    return keepAlive(ix, env);
  }
  // production build: closest to what ships, and served same-origin without dev-server origin checks
  const build = spawnSync("pnpm", ["exec", "next", "build", "--webpack"], { cwd: join(root, "apps/web"), env: { ...process.env, ...webEnv }, encoding: "utf8" });
  if (build.status !== 0) throw new Error(`web build failed: ${build.stdout}\n${build.stderr}`);
  start("pnpm", ["exec", "next", "start", "-p", String(PORTS.web)], join(root, "apps/web"), webEnv);
  await waitHttp(`http://127.0.0.1:${PORTS.web}/marketplace`, 300_000);

  console.log("stack ready");
  keepAlive(ix, env);
}

function keepAlive(ix: { stop(): void }, env: { stop(): void }): void {
  const stop = (): void => {
    for (const p of procs) p.kill("SIGTERM");
    ix.stop();
    env.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e: unknown) => {
  console.error(e);
  for (const p of procs) p.kill("SIGKILL");
  process.exit(1);
});
