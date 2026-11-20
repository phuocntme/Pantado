import { createPublicClient, fallback, http, type PublicClient } from "viem";
import { createReader, executionChain } from "@pantado/sdk";
import { createLogger, envInt, onShutdown, requireEnv } from "@pantado/service-kit";
import { executionRpcs, loadAssets, loadDeployment, loadProfile, loadServices } from "@pantado/shared";
import { indexerClient, marketDataHistory, marketDataPrices, memoryCache, redisCache, type ApiDeps } from "./deps.js";
import { privyKeys, privyVerifier } from "./privy.js";
import { buildServer } from "./server.js";
import { registerWs } from "./ws.js";

async function main(): Promise<void> {
  const log = createLogger("api");
  const profile = loadProfile();
  const deployment = loadDeployment();
  const override = process.env.EXECUTION_RPC_URL;
  // the API only reads: the read pool first, then the configured RPCs
  const urls = override ? [override] : executionRpcs(profile, "reads", process.env).map((e) => e.url);
  const chain = { ...executionChain(profile, override), id: deployment.chainId };
  // reads issued together (e.g. every asset's oracle price) go out as JSON-RPC batches: a few HTTP requests instead
  // of one per call, which keeps the stack under the public RPC's per-IP rate limit
  const client = createPublicClient({ chain, transport: fallback(urls.map((u) => http(u, { batch: { batchSize: 25, wait: 10 } }))) }) as PublicClient;
  const cache = process.env.REDIS_URL ? await redisCache(process.env.REDIS_URL) : memoryCache();
  const services = loadServices();
  const deps: ApiDeps = {
    profile,
    services,
    assets: loadAssets(),
    deployment,
    client,
    reader: createReader(client, deployment),
    gql: indexerClient(requireEnv("INDEXER_URL")),
    cache,
    prices: marketDataPrices(process.env.MARKET_DATA_URL),
    history: marketDataHistory(process.env.MARKET_DATA_URL),
    autoFund:
      profile.flags.autoFundOnSignIn && process.env.AUTO_FUND_URL && process.env.AUTO_FUND_SECRET
        ? {
            url: process.env.AUTO_FUND_URL,
            secret: process.env.AUTO_FUND_SECRET,
            // embedded-wallet gas needs a verified Privy sign-in; without an app id there is none
            verifyPrivy: process.env.NEXT_PUBLIC_PRIVY_APP_ID
              ? privyVerifier({
                  appId: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
                  issuer: services.keepers.autoFund.privyIssuer,
                  keys: privyKeys(services.keepers.autoFund.privyJwksUrl, process.env.NEXT_PUBLIC_PRIVY_APP_ID),
                })
              : null,
          }
        : null,
  };
  const app = buildServer(deps);
  const stopWs = await registerWs(app, deps);
  const port = envInt("PORT", 3001);
  await app.listen({ port, host: "0.0.0.0" });
  log.info("started", { port, profile: profile.profile });
  onShutdown(async () => {
    stopWs();
    await app.close();
    await cache.close();
  });
}

main().catch((e: unknown) => {
  createLogger("api").error("fatal", { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
