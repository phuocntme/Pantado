import { Registry } from "prom-client";
import { createChainContext, createLogger, envInt, onShutdown, requireEnv, runLoop, testnetAccount } from "@pantado/service-kit";
import { loadAssets, loadParams, loadServices } from "@pantado/shared";
import { httpApi } from "./api-client.js";
import { runManagerOnce } from "./manager.js";
import { providerFromEnv } from "./llm.js";
import { buildAgentServer, memorySessions, redisSessions } from "./server.js";

async function main(): Promise<void> {
  const log = createLogger("agent");
  const svc = loadServices();
  const params = loadParams();
  const autoModel = requireEnv(svc.agent.autoModelEnv);
  const deepModel = requireEnv(svc.agent.deepModelEnv);
  const llm = providerFromEnv();
  const api = httpApi(requireEnv("API_URL"));
  const registry = new Registry();
  const app = buildAgentServer(
    {
      llm,
      api,
      assets: loadAssets(),
      limits: {
        minAssets: params.factory.minAssets,
        maxAssets: params.factory.maxAssets,
        minWeightPct: params.factory.minWeightBps / 100,
        driftMinPct: params.rebalancer.driftMinBps / 100,
        driftMaxPct: params.rebalancer.driftMaxBps / 100,
      },
      harness: { autoModel, deepModel, autoMaxSteps: svc.agent.autoMaxSteps, deepMaxSteps: svc.agent.deepMaxSteps },
      sessions: process.env.REDIS_URL ? await redisSessions(process.env.REDIS_URL) : memorySessions(),
      tradeFeeBps: params.vault.tradeFeeBps,
      historySince: Date.parse(`${svc.marketData.history.since}T00:00:00Z`) / 1000,
      benchmark: svc.agent.benchmark,
      onReport: (r) =>
        log.info("answer", {
          mode: r.mode,
          model: r.model,
          session: r.sessionKind,
          question: r.question.slice(0, 300),
          tools: r.tools.join(","),
          toolErrors: r.toolErrors,
          steps: r.steps,
          ms: r.ms,
          tokensIn: r.usage.input + r.usage.cacheRead + r.usage.cacheWrite,
          tokensOut: r.usage.output,
          unverified: r.numbers.unverified.join(","),
          stoppedAtLimit: r.stoppedAtLimit,
        }),
    },
    registry,
  );
  const port = envInt("PORT", 3002);
  await app.listen({ port, host: "0.0.0.0" });
  log.info("started", { port, provider: llm.name });

  // agent-manager loop (contest flag; testnet key only)
  let stopManager = async (): Promise<void> => undefined;
  const ctx = createChainContext();
  if (ctx.profile.flags.agentManager && process.env.AGENT_MANAGER_KEY) {
    const account = testnetAccount("AGENT_MANAGER_KEY", ctx.chain.id);
    const loop = runLoop(
      "manager",
      svc.agent.managerPollSec * 1000,
      async () => {
        const res = await runManagerOnce(
          {
            reader: ctx.reader,
            client: ctx.publicClient,
            account,
            send: async (req) => {
              const hash = await ctx.wallet(account).sendTransaction({ ...req, account, chain: ctx.chain });
              await ctx.publicClient.waitForTransactionReceipt({ hash });
              return hash;
            },
            llm,
            rebalancer: ctx.deployment.contracts.rebalancer,
            now: () => Math.floor(Date.now() / 1000),
          },
          {
            tickers: svc.agent.managerIndexes.map((i) => i.replace(/^idx-/, "").toUpperCase()),
            model: deepModel,
            minIntervalSec: svc.agent.managerMinVersionIntervalSec,
            minChangePct: svc.agent.managerMinChangePct,
            dryRun: process.env.AGENT_MANAGER_DRY_RUN === "true",
          },
        );
        for (const r of res) log.info("manager", { ...r });
      },
      log,
    );
    stopManager = () => loop.stop();
    log.info("agent-manager on", { manager: account.address });
  }
  onShutdown(async () => {
    await stopManager();
    await app.close();
  });
}

main().catch((e: unknown) => {
  createLogger("agent").error("fatal", { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
