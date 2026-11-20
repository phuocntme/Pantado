/**
 * CI + monitor: level(indexer) == level(IndexLens) at the same block for every index.
 * Env: INDEXER_URL, PANTADO_PROFILE, EXECUTION_RPC_URL (optional). Exit 1 on any mismatch.
 */
import { createPublicClient, http } from "viem";
import { findRepoRoot, loadDeployment, loadProfile, loadServices } from "@pantado/shared";
import { checkLevels } from "@pantado/sdk";

async function main(): Promise<number> {
  findRepoRoot();
  const profile = loadProfile();
  const dep = loadDeployment();
  const rpc = process.env.EXECUTION_RPC_URL ?? profile.execution.rpc[0];
  const indexerUrl = process.env.INDEXER_URL;
  if (!rpc || !indexerUrl) throw new Error("EXECUTION_RPC_URL / INDEXER_URL missing");
  const client = createPublicClient({ transport: http(rpc) });
  const res = await checkLevels({
    indexerUrl,
    client: client as Parameters<typeof checkLevels>[0]["client"],
    lens: dep.contracts.lens,
    toleranceWei: BigInt(loadServices().monitoring.navToleranceWei),
  });
  for (const r of res) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.ticker.padEnd(6)} block ${r.block} indexer ${r.indexer} lens ${r.lens} diff ${r.diff}`);
  return res.every((r) => r.ok) ? 0 : 1;
}

main()
  .then((code) => (process.exitCode = code))
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
