/**
 * One-command Fuji deploy (spec §14.1): contracts from config (25 pTokens + test tokens, seeded stock reserve,
 * keeper roles) → contracts/deployments/fuji.json → keeper gas top-ups → demo indexes.
 *
 *   pnpm --filter @pantado/scripts deploy:fuji            # preflight, deploy, fund keepers, seed demo indexes
 *   pnpm --filter @pantado/scripts deploy:fuji --check    # preflight only (keys, chain, balances, cost)
 *   FORCE=1 …                                             # deploy again although the deployments file exists
 *   VERIFY=1 …                                            # also verify sources on the Fuji explorer
 *
 * Reads the repo's .env. Every key is a Fuji-only wallet; mainnet chains are refused.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, createWalletClient, formatEther, formatGwei, http, parseEther, type Address, type PrivateKeyAccount } from "viem";
import { testnetAccount } from "@pantado/service-kit";
import { findRepoRoot, loadProfile } from "@pantado/shared";

const root = findRepoRoot();
try {
  process.loadEnvFile(join(root, ".env"));
} catch {
  /* no .env: rely on the environment */
}
process.env.PANTADO_PROFILE ??= "contest";

const CHECK_ONLY = process.argv.includes("--check");
const FORCE = process.env.FORCE === "1";
const VERIFY = process.env.VERIFY === "1";
/** Deploy.s.sol used 45M gas (152 txs) on Anvil, seed-demo a few M more; ~3× headroom. */
const DEPLOY_GAS = BigInt(process.env.DEPLOY_GAS_ESTIMATE ?? "150000000");

const ok = (m: string): void => console.log(`\x1b[32m✔\x1b[0m ${m}`);
function die(m: string): never {
  console.error(`\x1b[31m✘ ${m}\x1b[0m`);
  process.exit(1);
}

function run(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): void {
  const r = spawnSync(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: "inherit" });
  if (r.status !== 0) die(`${cmd} ${args.join(" ")} failed (${r.status ?? r.signal})`);
}

async function main(): Promise<void> {
  const profile = loadProfile();
  if (profile.execution.network !== "fuji") die(`profile ${profile.profile} does not execute on fuji`);
  const rpc = process.env.FUJI_RPC_URL_FALLBACK || profile.execution.rpc[0];
  if (!rpc) die("no Fuji RPC");
  const pc = createPublicClient({ transport: http(rpc) });
  const chainId = await pc.getChainId();
  if (chainId !== profile.execution.chainId) die(`RPC ${rpc} is chain ${chainId}, expected ${profile.execution.chainId}`);
  ok(`RPC ${rpc} → chain ${chainId}`);

  // ---------------------------------------------------------------- keys
  const names = ["DEPLOYER_PRIVATE_KEY", "KEEPER_PRICE_PUSHER_KEY", "KEEPER_TRIGGER_KEY", "KEEPER_FILLER_KEY", "KEEPER_AUTO_FUND_KEY", "AGENT_MANAGER_KEY"] as const;
  const acct = Object.fromEntries(names.map((n) => [n, testnetAccount(n, chainId)])) as Record<(typeof names)[number], PrivateKeyAccount>;
  if (new Set(Object.values(acct).map((a) => a.address)).size !== names.length)
    die("use six different wallets (deployer, pusher, trigger, filler, auto-fund, agent-manager)");
  if (!process.env.AUTO_FUND_SECRET) die("AUTO_FUND_SECRET is empty (shared secret between the app and auto-fund)");
  const deployer = acct.DEPLOYER_PRIVATE_KEY;
  ok(`keys: deployer ${deployer.address}`);

  // ---------------------------------------------------------------- balances
  // keeper gas targets (AVAX); override with FUND_<NAME>_AVAX
  const target: Partial<Record<(typeof names)[number], string>> = {
    KEEPER_PRICE_PUSHER_KEY: process.env.FUND_PUSHER_AVAX ?? "1",
    KEEPER_TRIGGER_KEY: process.env.FUND_TRIGGER_AVAX ?? "0.3",
    KEEPER_FILLER_KEY: process.env.FUND_FILLER_AVAX ?? "0.3",
    KEEPER_AUTO_FUND_KEY: process.env.FUND_AUTOFUND_AVAX ?? "1.5",
    AGENT_MANAGER_KEY: process.env.FUND_MANAGER_AVAX ?? "0.2",
  };
  let topUps = 0n;
  const gaps: { name: string; to: Address; value: bigint }[] = [];
  for (const [name, avax] of Object.entries(target) as [(typeof names)[number], string][]) {
    const a = acct[name];
    const have = await pc.getBalance({ address: a.address });
    const want = parseEther(avax);
    console.log(`  ${name.padEnd(24)} ${a.address}  ${formatEther(have)} AVAX (target ${avax})`);
    if (have < want) {
      gaps.push({ name, to: a.address, value: want - have });
      topUps += want - have;
    }
  }
  const gasPrice = await pc.getGasPrice();
  const deployCost = DEPLOY_GAS * gasPrice;
  const bal = await pc.getBalance({ address: deployer.address });
  console.log(
    `  deployer ${formatEther(bal)} AVAX; needs ≈ ${formatEther(deployCost)} (deploy @ ${formatGwei(gasPrice)} gwei) + ${formatEther(topUps)} (keeper top-ups)`,
  );
  const depFile = join(root, profile.execution.deployments);
  const deployed = existsSync(depFile) && !FORCE;
  if (bal < (deployed ? 0n : deployCost) + topUps) die(`fund the deployer ${deployer.address} from a Fuji faucet first`);
  ok("balances");
  if (deployed) ok(`${profile.execution.deployments} exists — contracts will not be redeployed (FORCE=1 to redeploy)`);
  if (CHECK_ONLY) {
    ok("preflight passed");
    return;
  }

  // ---------------------------------------------------------------- contracts
  run("pnpm", ["gen:config"], root, {});
  if (!deployed) {
    const verify = VERIFY
      ? ["--verify", "--verifier-url", `https://api.routescan.io/v2/network/testnet/evm/${chainId}/etherscan`, "--etherscan-api-key", "verifyContract"]
      : [];
    run("forge", ["script", "script/Deploy.s.sol", "--rpc-url", rpc, "--broadcast", "--slow", ...verify], join(root, "contracts"), {
      NETWORK: "fuji",
      DEMO: "true",
      DEPLOYER_PRIVATE_KEY: process.env.DEPLOYER_PRIVATE_KEY,
      KEEPER_PRICE_PUSHER_ADDRESS: acct.KEEPER_PRICE_PUSHER_KEY.address,
      KEEPER_AUTO_FUND_ADDRESS: acct.KEEPER_AUTO_FUND_KEY.address,
      KEEPER_FILLER_ADDRESS: acct.KEEPER_FILLER_KEY.address,
    });
    if (!existsSync(depFile)) die(`${profile.execution.deployments} was not written`);
    ok(`contracts deployed → ${profile.execution.deployments}`);
  }

  // ---------------------------------------------------------------- keeper gas
  const wallet = createWalletClient({ account: deployer, transport: http(rpc) });
  for (const g of gaps) {
    const hash = await wallet.sendTransaction({ account: deployer, chain: null, to: g.to, value: g.value });
    await pc.waitForTransactionReceipt({ hash });
    ok(`topped up ${g.name} by ${formatEther(g.value)} AVAX`);
  }

  // ---------------------------------------------------------------- demo indexes
  // the deploy's seed prices are fresh for maxAgeSec: create the demo indexes before they age out
  run("pnpm", ["seed-demo"], join(root, "scripts"), { EXECUTION_RPC_URL: rpc });
  ok("demo indexes seeded (config/indexes.contest.json)");

  console.log(`\nNext: commit ${profile.execution.deployments}, start the stack (infra/deploy-vps.sh), then run the acceptance suite:`);
  console.log("  pnpm --filter @pantado/e2e-app acceptance   (see test/e2e-app/README.md)");
}

main().catch((e: unknown) => die(e instanceof Error ? e.message : String(e)));
