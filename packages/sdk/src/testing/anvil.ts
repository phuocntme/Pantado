import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { deploymentSchema, findRepoRoot, type Deployment } from "@pantado/shared";

/** Anvil's built-in development keys (public, local chain only). */
export const ANVIL_KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
  "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e", // #6 → 0x976E…0aa9 (local stack auto-fund)
] as const;

export interface AnvilEnv {
  rpcUrl: string;
  deployment: Deployment;
  stop(): void;
}

export function hasFoundry(): boolean {
  return spawnSync("anvil", ["--version"]).status === 0 && spawnSync("forge", ["--version"]).status === 0;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, () => {
      const addr = srv.address();
      srv.close(() => (typeof addr === "object" && addr ? resolve(addr.port) : reject(new Error("no port"))));
    });
  });
}

async function waitRpc(url: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`anvil did not start at ${url}`);
}

/**
 * Start a fresh Anvil, deploy every contract with script/Deploy.s.sol and return the deployment.
 * Writes contracts/deployments/<network>.json with a unique network name so parallel runs do not clash.
 */
export async function startAnvilWithDeployment(
  opts: { demo?: boolean; pusher?: string; autoFund?: string; filler?: string; /** fixed RPC port (a wallet's saved network keeps working across restarts); default: any free port */ port?: number } = {},
): Promise<AnvilEnv> {
  const root = findRepoRoot();
  const port = opts.port ?? (await freePort());
  const rpcUrl = `http://127.0.0.1:${port}`;
  const anvil: ChildProcess = spawn("anvil", ["--port", String(port), "--silent", "--gas-limit", "300000000", "--code-size-limit", "50000"], {
    stdio: "ignore",
  });
  const stop = (): void => {
    anvil.kill("SIGKILL");
  };
  try {
    await waitRpc(rpcUrl);
    const network = `anvil-${port}`;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NETWORK: network,
      DEMO: opts.demo ? "true" : "false",
      DEPLOYER_PRIVATE_KEY: ANVIL_KEYS[0],
    };
    delete env.KEEPER_PRICE_PUSHER_ADDRESS;
    delete env.KEEPER_AUTO_FUND_ADDRESS;
    delete env.KEEPER_FILLER_ADDRESS;
    if (opts.filler) env.KEEPER_FILLER_ADDRESS = opts.filler;
    if (opts.pusher) env.KEEPER_PRICE_PUSHER_ADDRESS = opts.pusher;
    if (opts.autoFund) env.KEEPER_AUTO_FUND_ADDRESS = opts.autoFund;
    const res = spawnSync("forge", ["script", "script/Deploy.s.sol", "--rpc-url", rpcUrl, "--broadcast", "-q"], {
      cwd: join(root, "contracts"),
      env,
      encoding: "utf8",
    });
    if (res.status !== 0) throw new Error(`deploy failed:\n${res.stdout}\n${res.stderr}`);
    const file = join(root, "contracts/deployments", `${network}.json`);
    const deployment = deploymentSchema.parse(JSON.parse(readFileSync(file, "utf8")));
    spawnSync("rm", ["-f", file]);
    return { rpcUrl, deployment, stop };
  } catch (e) {
    stop();
    throw e;
  }
}

/** Advance Anvil time by `secs` and mine one block. */
export async function advanceTime(rpcUrl: string, secs: number): Promise<void> {
  const { createTestClient, http } = await import("viem");
  const { foundry } = await import("viem/chains");
  const t = createTestClient({ mode: "anvil", chain: foundry, transport: http(rpcUrl) });
  await t.increaseTime({ seconds: secs });
  await t.mine({ blocks: 1 });
}

export { TestKit } from "./kit.js";
