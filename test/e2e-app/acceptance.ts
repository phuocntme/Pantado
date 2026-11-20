/**
 * Contest acceptance (spec §14) against a running stack: contracts + keepers + market-data + indexer + api
 * (+ agent). Works on Fuji (real time) and on Anvil (`ACCEPTANCE_FAST_FORWARD=1` warps time).
 *
 * Env:
 *   PANTADO_PROFILE, PANTADO_DEPLOYMENTS?, EXECUTION_RPC_URL?   execution network (testnet only)
 *   API_URL, INDEXER_URL, AGENT_URL?                            services (agent optional → step 4 uses a fixed draft)
 *   PROMETHEUS_URL? | HEALTH_URLS? (comma list)                 step 11
 *   DEPLOYER_PRIVATE_KEY                                       owner of oracle / test USDC (testnet only)
 *   ACCEPTANCE_USER_KEY?                                       second wallet (fresh key if unset, funded by the deployer)
 *   ACCEPTANCE_STEPS?                                          e.g. "1,2,3,5" (default: all)
 *   ACCEPTANCE_FAST_FORWARD=1                                  Anvil only: evm_increaseTime instead of waiting
 *   ACCEPTANCE_SHOCK_TIMEOUT_MIN?                              step 7 wall-clock budget (default 90)
 * Writes test/e2e-app/acceptance-report.json. Exit code 1 when any step fails.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodeFunctionData, erc20Abi, formatUnits, parseEther, parseUnits, type Account, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { assetRegistryAbi, ERROR_MESSAGES, indexLensAbi, priceOracleAbi, RebalanceMode, testERC20Abi, toPantadoError, tx, type TxRequest } from "@pantado/sdk";
import { createChainContext, MAINNET_CHAIN_IDS, testnetAccount } from "@pantado/service-kit";
import { findRepoRoot, loadAssets, loadDemoIndexes, loadParams, loadServices } from "@pantado/shared";

// ------------------------------------------------------------------ setup

const root = findRepoRoot();
try {
  process.loadEnvFile(join(root, ".env")); // keys for a Fuji run; variables already set win
} catch {
  /* no .env */
}
const ctx = createChainContext();
const pc = ctx.publicClient;
const c = ctx.deployment.contracts;
const assets = loadAssets();
const params = loadParams();
const services = loadServices();
const API = need("API_URL");
const INDEXER = need("INDEXER_URL");
const AGENT = process.env.AGENT_URL ?? null;
const FAST = process.env.ACCEPTANCE_FAST_FORWARD === "1";
if (FAST && ctx.chain.id !== 31337) throw new Error("ACCEPTANCE_FAST_FORWARD is for Anvil (31337) only");
const only = process.env.ACCEPTANCE_STEPS ? new Set(process.env.ACCEPTANCE_STEPS.split(",").map((s) => Number(s.trim()))) : null;
const owner = testnetAccount("DEPLOYER_PRIVATE_KEY", ctx.chain.id);
if (MAINNET_CHAIN_IDS.has(ctx.chain.id)) throw new Error("acceptance runs on test networks only");
const user = process.env.ACCEPTANCE_USER_KEY ? testnetAccount("ACCEPTANCE_USER_KEY", ctx.chain.id) : privateKeyToAccount(generatePrivateKey());
const usdc = c.usdc;
const execOf = (id: string): Address => {
  const a = ctx.deployment.assets[id];
  if (!a) throw new Error(`asset ${id} not deployed`);
  return a as Address;
};

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v.replace(/\/$/, "");
}

type Status = "pass" | "fail" | "skip";
interface StepResult {
  step: number;
  name: string;
  status: Status;
  detail: string;
  ms: number;
}
const results: StepResult[] = [];
const log = (msg: string): void => console.log(`  · ${msg}`);

class Skip extends Error {}

async function step(n: number, name: string, fn: () => Promise<string>): Promise<void> {
  if (only && !only.has(n)) return;
  console.log(`\n[${n}] ${name}`);
  const t = Date.now();
  let status: Status = "pass";
  let detail = "";
  try {
    detail = await fn();
  } catch (e) {
    status = e instanceof Skip ? "skip" : "fail";
    detail = e instanceof Error ? e.message : String(e);
  }
  const r = { step: n, name, status, detail, ms: Date.now() - t };
  results.push(r);
  console.log(`  ${status.toUpperCase()} ${detail}`);
}

function check(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(what: string, fn: () => Promise<T | null | undefined | false>, timeoutMs: number, pollMs = 3_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  let last: unknown = null;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await sleep(pollMs);
  }
  throw new Error(`timed out waiting for ${what}${last instanceof Error ? ` (${last.message})` : ""}`);
}

/**
 * Advance chain time: warp on Anvil, wait on a real network. After a warp the keepers need a moment to
 * catch up (the pusher re-pushes every price that aged), so by default wait until prices are fresh again.
 */
async function elapse(sec: number, settle = true): Promise<void> {
  if (!FAST) return sleep(sec * 1000);
  await pc.request({ method: "evm_increaseTime" as never, params: [sec] as never });
  await pc.request({ method: "evm_mine" as never, params: [] as never });
  if (!settle) return;
  const all = Object.values(ctx.deployment.assets).filter((a): a is Address => !!a && a.toLowerCase() !== usdc.toLowerCase());
  await waitFor("prices fresh after the warp", async () => (await Promise.all(all.map((a) => ctx.reader.isFresh(a)))).every(Boolean), 120_000, 1_000);
}

async function send(account: Account, req: TxRequest): Promise<{ hash: Hex; block: bigint }> {
  try {
    await pc.call({ account, to: req.to, data: req.data, value: req.value });
    const hash = await ctx.wallet(account).sendTransaction({ to: req.to, data: req.data, value: req.value, account, chain: ctx.chain });
    const rc = await pc.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") throw new Error(`reverted ${hash}`);
    return { hash, block: rc.blockNumber };
  } catch (e) {
    throw toPantadoError(e);
  }
}

/** The revert a user would get, decoded to the UI error (null when the call would succeed). */
async function revertOf(account: Account, req: TxRequest): Promise<{ code: string; message: string } | null> {
  try {
    await pc.call({ account, to: req.to, data: req.data, value: req.value });
    return null;
  } catch (e) {
    const pe = toPantadoError(e);
    return { code: pe.code, message: pe.message };
  }
}

async function getJson<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${base}${path}`, init);
  if (!r.ok) throw new Error(`${base}${path}: HTTP ${r.status} ${await r.text().catch(() => "")}`.slice(0, 300));
  return (await r.json()) as T;
}

async function mintUsdc(to: Address, whole: number): Promise<void> {
  await send(owner, { to: usdc, data: encodeFunctionData({ abi: testERC20Abi, functionName: "mint", args: [to, parseUnits(String(whole), 6)] }) });
}

/** level(indexer) == level(lens) at the indexer's block, once the indexer has seen `minBlock`. */
async function levelMatches(index: Address, minBlock: bigint): Promise<string> {
  const row = await waitFor(
    `indexer level ≥ block ${minBlock}`,
    async () => {
      const l = await getJson<{ block: string; level: string }>(INDEXER, `/levels/${index}/latest`);
      return BigInt(l.block) >= minBlock ? l : null;
    },
    120_000,
    1_500,
  );
  const block = BigInt(row.block);
  const lens = await pc.readContract({ address: c.lens, abi: indexLensAbi, functionName: "level", args: [index], blockNumber: block });
  check(BigInt(row.level) === lens, `level mismatch at block ${block}: indexer ${row.level} vs lens ${lens}`);
  return `level ${formatUnits(lens, 18)} @${block}`;
}

const pct = (bps: bigint | number): string => `${(Number(bps) / 100).toFixed(2)}%`;

// ------------------------------------------------------------------ oracle overrides (always restored)

interface OracleCfg {
  asset: Address;
  maxAgeSec: bigint;
  bandMin: bigint;
  bandMax: bigint;
}
const overridden = new Map<Address, OracleCfg>();
let ownerWasPusher: boolean | null = null;

async function readCfg(asset: Address): Promise<OracleCfg> {
  const [maxAgeSec, , , bandMin, bandMax] = await pc.readContract({ address: c.oracle, abi: priceOracleAbi, functionName: "configs", args: [asset] });
  return { asset, maxAgeSec, bandMin, bandMax };
}

async function configure(asset: Address, maxAgeSec: bigint, bandMin: bigint, bandMax: bigint): Promise<void> {
  if (!overridden.has(asset)) overridden.set(asset, await readCfg(asset));
  await send(owner, {
    to: c.oracle,
    data: encodeFunctionData({ abi: priceOracleAbi, functionName: "configureAsset", args: [asset, maxAgeSec, bandMin, bandMax] }),
  });
}

async function ownerPush(asset: Address, priceE18: bigint): Promise<void> {
  if (ownerWasPusher === null) {
    ownerWasPusher = await pc.readContract({ address: c.oracle, abi: priceOracleAbi, functionName: "isPusher", args: [owner.address] });
    if (!ownerWasPusher) await send(owner, { to: c.oracle, data: encodeFunctionData({ abi: priceOracleAbi, functionName: "setPusher", args: [owner.address, true] }) });
  }
  await send(owner, tx.pushPrices(c.oracle, [asset], [priceE18]));
}

async function restoreOracle(): Promise<void> {
  for (const cfg of overridden.values()) {
    try {
      await send(owner, {
        to: c.oracle,
        data: encodeFunctionData({ abi: priceOracleAbi, functionName: "configureAsset", args: [cfg.asset, cfg.maxAgeSec, cfg.bandMin, cfg.bandMax] }),
      });
      log(`restored oracle config of ${cfg.asset}`);
    } catch (e) {
      console.error(`  ! could not restore ${cfg.asset}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  overridden.clear();
  if (ownerWasPusher === false) {
    await send(owner, { to: c.oracle, data: encodeFunctionData({ abi: priceOracleAbi, functionName: "setPusher", args: [owner.address, false] }) }).catch(() => undefined);
    ownerWasPusher = null;
  }
}

// ------------------------------------------------------------------ steps

let created: Address | null = null; // step 4 index, traded in 5, 6, 10

async function main(): Promise<void> {
  console.log(`acceptance on chain ${ctx.chain.id} (${ctx.profile.profile}); user ${user.address}; ${FAST ? "fast-forward" : "real time"}`);

  // fund the second wallet: gas + test USDC
  const bal = await pc.getBalance({ address: user.address });
  if (bal < parseEther("0.2")) await send(owner, { to: user.address, data: "0x", value: parseEther("0.3") });
  await mintUsdc(user.address, 5_000);
  await send(user, tx.approve(usdc, c.factory));

  await step(1, "Deploy: 25 pTokens + test tokens registered, stock reserve seeded, deployments file", async () => {
    const listed = await Promise.all(assets.filter((a) => a.kind !== "quote").map(async (a) => ({ a, ok: await pc.readContract({ address: c.assetRegistry, abi: assetRegistryAbi, functionName: "isListed", args: [execOf(a.id)] }) })));
    const missing = listed.filter((x) => !x.ok).map((x) => x.a.id);
    check(missing.length === 0, `not listed: ${missing.join(", ")}`);
    const stocks = assets.filter((a) => a.kind === "stock").length;
    check(stocks === 25, `expected 25 stocks, config has ${stocks}`);
    const { reserve } = await ctx.reader.stockVenueState();
    check(reserve > 0n, "stock reserve is empty");
    return `${listed.length} assets listed (${stocks} stocks); reserve ${formatUnits(reserve, 6)} USDC; ${process.env.PANTADO_DEPLOYMENTS ?? ctx.profile.execution.deployments}`;
  });

  await step(2, "Keepers live: every on-chain price within 25 bps of the displayed price", async () => {
    const view = await getJson<{ id: string; price: { usd: number; source: string; fresh: boolean } | null }[]>(API, "/assets");
    const bad: string[] = [];
    let ok = 0;
    for (const a of view) {
      if (!a.price || assets.find((x) => x.id === a.id)?.kind === "quote") continue;
      const [p] = await pc.readContract({ address: c.oracle, abi: priceOracleAbi, functionName: "latest", args: [execOf(a.id)] });
      const onchain = Number(p) / 1e18;
      const gap = (Math.abs(onchain - a.price.usd) / a.price.usd) * 10_000;
      if (!a.price.fresh || gap > services.marketData.moveBps) bad.push(`${a.id} ${a.price.fresh ? "" : "stale "}${gap.toFixed(1)}bps`);
      else ok++;
    }
    check(bad.length === 0, `${ok} ok; off: ${bad.join(", ")}`);
    return `${ok} assets fresh and within ${services.marketData.moveBps} bps`;
  });

  await step(3, "Marketplace data: live prices with source badges", async () => {
    const view = await getJson<{ id: string; kind: string; badge: string | null; dataSource: string; price: { source: string } | null }[]>(API, "/assets");
    const stocks = view.filter((a) => a.kind === "stock");
    const noBadge = stocks.filter((a) => !a.badge?.includes("Robinhood Chain")).map((a) => a.id);
    check(noBadge.length === 0, `stocks without the reference badge: ${noBadge.join(", ")}`);
    const priced = view.filter((a) => a.kind !== "quote" && a.price);
    const seeded = priced.filter((a) => a.price?.source === "seed");
    if (ctx.chain.id !== 31337) check(seeded.length === 0, `seed prices on a public network: ${seeded.map((a) => a.id).join(", ")}`);
    const board = await getJson<unknown[]>(API, "/board");
    check(Array.isArray(board) && board.length > 0, "board is empty");
    return `${priced.length}/${view.length - 1} priced; sources: ${[...new Set(priced.map((a) => (a.price?.source ?? "").split(":")[0]))].join(", ")}`;
  });

  await step(4, "Ask → draft → create (one signature) → level 100.00", async () => {
    let draft: { name: string; ticker: string; components: string[]; weights: number[] } | null = null;
    let via = "fixed draft (no AGENT_URL)";
    if (AGENT) {
      draft = await getJson(AGENT, "/draft", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: "make me an AI chips index with some BTC" }) });
      via = "agent /draft";
    }
    draft ??= { name: "AI Chips + BTC", ticker: "AICB", components: ["nvda", "amd", "tsm", "mu", "btcb"], weights: [22, 22, 18, 18, 20] };
    check(draft.components.includes("btcb"), `draft has no BTC: ${draft.components.join(",")}`);
    const sum = draft.weights.reduce((s, w) => s + w, 0);
    const bps = draft.weights.map((w) => Math.round((w * 10_000) / sum));
    bps[0] = (bps[0] ?? 0) + 10_000 - bps.reduce((s, w) => s + w, 0);
    const ticker = `A${Date.now().toString(36).slice(-4).toUpperCase()}`;
    const usdcIn = parseUnits(String(params.factory.minFirstBuyUsdc * 3), 6);
    await mintUsdc(owner.address, params.factory.minFirstBuyUsdc * 3 + params.factory.creationFeeUsdc);
    await send(owner, tx.approve(usdc, c.factory));
    const r = await send(
      owner,
      tx.createAndBuy(c.factory, {
        name: draft.name,
        ticker,
        description: "acceptance",
        assets: draft.components.map(execOf),
        weightsBps: bps,
        mode: RebalanceMode.Manual,
        driftBps: 0,
        isPublic: true,
        usdcIn,
        minUnits: 0n,
      }),
    );
    created = await ctx.reader.indexByTicker(ticker);
    const lvl = await ctx.reader.level(created, r.block);
    check(formatUnits(lvl, 18).startsWith("100") || Math.abs(Number(lvl) / 1e18 - 100) < 0.01, `level after create is ${formatUnits(lvl, 18)}`);
    await levelMatches(created, r.block);
    const detail = await waitFor("index in the API", () => getJson<{ name: string }>(API, `/indexes/${created}`), 60_000);
    return `${via}: ${draft.components.join("/")} → ${ticker} ${created}; level ${(Number(lvl) / 1e18).toFixed(2)}; API shows "${detail.name}"`;
  });

  await step(5, "Second wallet buys, sells part, redeems part; indexer level == lens after each", async () => {
    const ix = created;
    if (!ix) throw new Skip("needs step 4");
    const out: string[] = [];
    await send(user, tx.approve(usdc, ix));
    const b = await send(user, tx.buy(ix, parseUnits("300", 6), 0n, user.address));
    out.push(`buy ${await levelMatches(ix, b.block)}`);
    const units = await pc.readContract({ address: ix, abi: erc20Abi, functionName: "balanceOf", args: [user.address] });
    const s = await send(user, tx.sell(ix, units / 3n, 0n, user.address));
    out.push(`sell ${await levelMatches(ix, s.block)}`);
    const rd = await send(user, tx.redeem(ix, units / 3n, user.address));
    out.push(`redeem ${await levelMatches(ix, rd.block)}`);
    return out.join("; ");
  });

  await step(6, "Stock buy above sizeCapUsd reverts with the UI message", async () => {
    const ix = created;
    if (!ix) throw new Skip("needs step 4");
    const k = await ctx.reader.basket(ix);
    let need = 0;
    for (let i = 0; i < k.assets.length; i++) {
      const a = assets.find((x) => ctx.deployment.assets[x.id]?.toLowerCase() === k.assets[i]?.toLowerCase());
      if (a?.kind !== "stock") continue;
      const w = Number(k.currentBps[i] ?? 0n) / 10_000;
      if (w > 0) need = Math.max(need, Math.ceil((a.risk.sizeCapUsd / w) * 1.2));
    }
    check(need > 0, "index has no stock leg");
    await mintUsdc(user.address, need);
    const rv = await revertOf(user, tx.buy(ix, parseUnits(String(need), 6), 0n, user.address));
    check(rv?.code === "SizeCapExceeded", `expected SizeCapExceeded, got ${rv ? rv.code : "success"}`);
    check(rv.message === ERROR_MESSAGES.SizeCapExceeded, "UI message differs");
    return `buy of $${need.toLocaleString("en-US")} → "${rv.message}"`;
  });

  await step(7, "Price shock → Auto index drifts ≥ θ → auctions → filler fills → drift reduced within guards", async () => {
    const auto = loadDemoIndexes().indexes.find((i) => i.mode === "Auto");
    if (!auto) throw new Skip("no Auto demo index in config");
    const ix = await ctx.reader.indexByTicker(auto.ticker);
    check(!/^0x0{40}$/.test(ix), `${auto.ticker} not deployed (run seed-demo)`);
    const ps0 = await ctx.reader.planState(ix);
    check(ps0.mode === RebalanceMode.Auto, `${auto.ticker} is not Auto`);
    const k = await ctx.reader.basket(ix);
    // shock the largest stock leg up just past θ (relative drift |c − w| / w)
    let i = 0;
    for (let j = 1; j < k.assets.length; j++) if ((k.currentBps[j] ?? 0n) > (k.currentBps[i] ?? 0n)) i = j;
    const asset = k.assets[i] as Address;
    const w = Number(k.currentBps[i]) / 10_000;
    const d = ps0.driftBps / 10_000 + 0.2;
    const s = d / (1 - w * (1 + d));
    check(s > 0 && s < 5, `shock out of range (${s})`);
    const [p0] = await ctx.reader.price(asset);
    const shocked = (p0 * BigInt(Math.round((1 + s) * 1e6))) / 1_000_000n;
    log(`shock ${asset} +${(s * 100).toFixed(0)}% (${formatUnits(p0, 18)} → ${formatUnits(shocked, 18)}); θ ${pct(ps0.driftBps)}`);
    // band around the shocked price: the pusher skips this asset until the config is restored
    await configure(asset, 86_400n, (shocked * 9n) / 10n, (shocked * 11n) / 10n);
    await ownerPush(asset, shocked);
    const kd = await ctx.reader.basket(ix);
    const maxDrift = kd.driftBps.reduce((m, v) => (v > m ? v : m), 0n);
    check(maxDrift >= BigInt(ps0.driftBps), `drift ${pct(maxDrift)} < θ ${pct(ps0.driftBps)}`);

    const budgetMs = Number(process.env.ACCEPTANCE_SHOCK_TIMEOUT_MIN ?? 90) * 60_000;
    const notice = BigInt((await ctx.reader.rebalancerParams()).noticeSec);
    const scheduled = await waitFor("rebalance-trigger to schedule a plan", async () => {
      const ps = await ctx.reader.planState(ix);
      return ps.plan.status === 1 || ps.plan.status === 2 ? ps : null;
    }, 5 * 60_000);
    log(`plan ${scheduled.plan.id} scheduled, starts at ${scheduled.plan.startAt}`);
    check(scheduled.plan.startAt - BigInt(Math.floor(Date.now() / 1000)) <= notice + 120n || FAST, "notice longer than configured");
    const filled = await waitFor(
      "auction fills",
      async () => {
        if (FAST) await elapse(300);
        const r = await getJson<{ fills: unknown[]; plans: { planId: number; status: string; loss: string | null; lossBudget: string | null }[] }>(API, `/indexes/${ix}/rebalances`);
        return r.fills.length > 0 ? r : null;
      },
      budgetMs,
      FAST ? 4_000 : 20_000,
    );
    const kd2 = await ctx.reader.basket(ix);
    const after = kd2.driftBps[i] ?? 0n;
    const ps = await ctx.reader.planState(ix);
    check(after < (kd.driftBps[i] ?? 0n), `drift not reduced (${pct(kd.driftBps[i] ?? 0n)} → ${pct(after)})`);
    check(ps.plan.loss <= BigInt(ps.plan.lossBudget), `loss ${ps.plan.loss} above budget ${ps.plan.lossBudget}`);
    return `${filled.fills.length} fills; drift ${pct(kd.driftBps[i] ?? 0n)} → ${pct(after)}; loss ${formatUnits(ps.plan.loss < 0n ? 0n : ps.plan.loss, 18)} ≤ budget ${formatUnits(ps.plan.lossBudget, 18)} USD`;
  });
  await restoreOracle();

  await step(8, "Manual index: creator publishes a new version; starts after the notice", async () => {
    const manual = loadDemoIndexes().indexes.find((i) => i.mode === "Manual" && (i.owner ?? "deployer") === "deployer" && i.visibility !== "private");
    if (!manual) throw new Skip("no deployer-owned Manual demo index in config");
    const ix = await ctx.reader.indexByTicker(manual.ticker);
    const before = await ctx.reader.planState(ix);
    if (before.plan.status === 1 || before.plan.status === 2) throw new Skip(`${manual.ticker} already has a plan in progress (status ${before.plan.status})`);
    const cur = await ctx.reader.index(ix);
    const n = cur.targetBps.length;
    // rotate 2 % from the largest leg to the smallest
    const w = [...cur.targetBps].map(Number);
    const hi = w.indexOf(Math.max(...w));
    const lo = w.indexOf(Math.min(...w));
    w[hi] = (w[hi] ?? 0) - 200;
    w[lo] = (w[lo] ?? 0) + 200;
    check(w.length === n, "weights");
    const r = await send(owner, tx.publishVersion(c.rebalancer, ix, w, "acceptance: rotate 2%"));
    const ts = (await pc.getBlock({ blockNumber: r.block })).timestamp;
    const ps = await ctx.reader.planState(ix);
    const notice = BigInt((await ctx.reader.rebalancerParams()).noticeSec);
    check(ps.plan.manual && ps.plan.status === 1, `expected a scheduled manual plan, got status ${ps.plan.status}`);
    check(ps.plan.startAt - ts === notice, `starts after ${ps.plan.startAt - ts}s, expected ${notice}s`);
    if (FAST) {
      await elapse(Number(notice) + 1);
      await waitFor("keeper to start the version", async () => (await ctx.reader.planState(ix)).plan.status >= 2, 120_000);
      const now = await ctx.reader.index(ix);
      check(now.targetBps.map(Number).join() === w.join(), "targets did not switch to the new version");
      return `v${ps.version} scheduled ${notice}s after publish, started on time with targets ${w.join("/")}`;
    }
    return `v${ps.version} scheduled to start ${notice}s after publish (${new Date(Number(ps.plan.startAt) * 1000).toISOString()})`;
  });

  await step(9, "Private index: only in its creator's Portfolio; Make public → Marketplace", async () => {
    const ticker = `P${Date.now().toString(36).slice(-4).toUpperCase()}`;
    const r = await send(
      user,
      tx.createAndBuy(c.factory, {
        name: `Private ${ticker}`,
        ticker,
        description: "acceptance",
        assets: [execOf("wavax"), execOf("btcb")],
        weightsBps: [5000, 5000],
        mode: RebalanceMode.Off,
        driftBps: 0,
        isPublic: false,
        usdcIn: parseUnits(String(params.factory.minFirstBuyUsdc), 6),
        minUnits: 0n,
      }),
    );
    const ix = await ctx.reader.indexByTicker(ticker);
    await levelMatches(ix, r.block);
    const listed = async (): Promise<boolean> => (await getJson<{ id?: string; address?: string }[]>(API, "/indexes")).some((x) => (x.id ?? x.address ?? "").toLowerCase() === ix.toLowerCase());
    await sleep(services.api.cacheSec * 1000 + 500);
    check(!(await listed()), "private index is listed in the Marketplace");
    const pf = await getJson<{ yourIndexes?: { id?: string; address?: string }[]; created?: { id?: string }[] }>(API, `/portfolio/${user.address}`);
    const mine = JSON.stringify(pf).toLowerCase().includes(ix.toLowerCase());
    check(mine, "private index missing from its creator's Portfolio");
    const other = JSON.stringify(await getJson<unknown>(API, `/portfolio/${owner.address}`)).toLowerCase().includes(ix.toLowerCase());
    check(!other, "private index shows in another wallet's Portfolio");
    await send(user, tx.makePublic(c.factory, ix));
    await waitFor("index in the Marketplace", async () => (await listed()) || null, 60_000, 2_000);
    return `${ticker} ${ix}: private → creator Portfolio only; public → Marketplace`;
  });

  await step(10, "Stale price → buy/sell revert with the UI message; redeem succeeds", async () => {
    const ix = created;
    if (!ix) throw new Skip("needs step 4");
    const k = await ctx.reader.basket(ix);
    const asset = k.assets[k.assets.length - 1] as Address; // a token leg (BTC)
    // band [1, 1] wei: the pusher skips the asset; max age 1 s: it goes stale right away
    await configure(asset, 1n, 1n, 1n);
    await elapse(3, false);
    await waitFor("price to go stale", async () => !(await ctx.reader.isFresh(asset)), 60_000, 1_000);
    const units = await pc.readContract({ address: ix, abi: erc20Abi, functionName: "balanceOf", args: [user.address] });
    check(units > 0n, "second wallet holds no units (step 5)");
    const buy = await revertOf(user, tx.buy(ix, parseUnits("100", 6), 0n, user.address));
    const sell = await revertOf(user, tx.sell(ix, units / 4n, 0n, user.address));
    check(buy?.code === "PriceStale" && buy.message === ERROR_MESSAGES.PriceStale, `buy: ${buy ? buy.code : "succeeded"}`);
    check(sell?.code === "PriceStale", `sell: ${sell ? sell.code : "succeeded"}`);
    const r = await send(user, tx.redeem(ix, units / 4n, user.address));
    if (only === null || only.has(11)) await monitoring(asset);
    return `buy/sell → "${buy.message}"; redeem ok in block ${r.block}`;
  });
  await restoreOracle();

  // ------------------------------------------------------------------ report
  results.sort((a, b) => a.step - b.step);
  const failed = results.filter((r) => r.status === "fail");
  const file = join(root, "test/e2e-app/acceptance-report.json");
  writeFileSync(file, JSON.stringify({ chainId: ctx.chain.id, profile: ctx.profile.profile, at: new Date().toISOString(), user: user.address, results }, null, 2));
  console.log(`\n${results.map((r) => `${r.status === "pass" ? "✔" : r.status === "skip" ? "–" : "✘"} ${r.step}. ${r.name}`).join("\n")}`);
  console.log(`\n${results.length - failed.length}/${results.length} passed or skipped; report: ${file}`);
  process.exitCode = failed.length ? 1 : 0;
}

/** Step 11, run while step 10 holds one asset stale: everything green except that asset. */
async function monitoring(staleAsset: Address): Promise<void> {
  await step(11, "Monitoring green except the induced stale asset", async () => {
    const prom = process.env.PROMETHEUS_URL;
    if (prom) {
      const r = await getJson<{ data: { result: { metric: Record<string, string> }[] } }>(prom.replace(/\/$/, ""), `/api/v1/query?query=${encodeURIComponent('ALERTS{alertstate="firing"}')}`);
      const staleId = Object.entries(ctx.deployment.assets).find(([, a]) => a?.toLowerCase() === staleAsset.toLowerCase())?.[0];
      const other = r.data.result.filter((x) => !(x.metric.alertname === "PriceStale" && (x.metric.asset === staleId || x.metric.asset === staleAsset)));
      check(other.length === 0, `firing: ${other.map((x) => `${x.metric.alertname}${x.metric.asset ? `(${x.metric.asset})` : ""}`).join(", ")}`);
      return `no alerts firing except PriceStale(${staleId ?? staleAsset})`;
    }
    const urls = (process.env.HEALTH_URLS ?? "").split(",").map((u) => u.trim()).filter(Boolean);
    if (!urls.length) throw new Skip("set PROMETHEUS_URL or HEALTH_URLS");
    const bad: string[] = [];
    for (const u of urls) {
      const res = await fetch(u).catch(() => null);
      const body = res ? ((await res.json().catch(() => ({}))) as { ok?: boolean }) : {};
      if (!res?.ok || body.ok === false) bad.push(u);
    }
    check(bad.length === 0, `unhealthy: ${bad.join(", ")}`);
    return `${urls.length} services healthy`;
  });
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await restoreOracle().catch(() => undefined);
  });
