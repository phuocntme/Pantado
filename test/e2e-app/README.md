# App end-to-end tests

| What | Command |
|---|---|
| Local stack (Anvil, deploy, seed, indexer, market-data seed mode, api, web) | `pnpm stack:anvil` (`WEB_PORT`, `STACK_KEEPERS=1` adds pusher / trigger / filler, `STACK_WEB=0` skips the web build) |
| UI smoke on Anvil (Playwright, every screen, trade flows) | `pnpm e2e:anvil` |
| Contest acceptance (spec §14, steps 1–11) | `pnpm acceptance` |

## Acceptance (`acceptance.ts`)

Runs against a stack that is already up. Each step prints PASS / FAIL / SKIP with the evidence (levels, blocks,
messages) and the run writes `acceptance-report.json`.

| Env | |
|---|---|
| `PANTADO_PROFILE`, `PANTADO_DEPLOYMENTS?`, `EXECUTION_RPC_URL?` | execution network (test networks only) |
| `API_URL`, `INDEXER_URL`, `AGENT_URL?` | services; without `AGENT_URL` step 4 uses a fixed "AI chips + BTC" draft |
| `PROMETHEUS_URL?` or `HEALTH_URLS?` | step 11 (no firing alert except the induced `PriceStale`) |
| `DEPLOYER_PRIVATE_KEY` | oracle / test-USDC owner (also read from the repo `.env`) |
| `ACCEPTANCE_USER_KEY?` | second wallet; a fresh one is generated and funded otherwise |
| `ACCEPTANCE_STEPS?` | e.g. `1,2,3,5` |
| `ACCEPTANCE_FAST_FORWARD=1` | Anvil only: warp time instead of waiting |
| `ACCEPTANCE_SHOCK_TIMEOUT_MIN?` | budget for step 7 (default 90) |

Steps 7 (shock) and 10 (stale) change one asset's oracle config with the owner key so the pusher skips it, and
restore the original config at the end of the step and on exit.

### On Anvil

```bash
STACK_KEEPERS=1 STACK_WEB=0 pnpm stack:anvil &          # wait for "stack ready"
S=$(cat .stack.json)
EXECUTION_RPC_URL=$(jq -r .rpcUrl <<<"$S") PANTADO_DEPLOYMENTS=$(jq -r .deployment <<<"$S") \
API_URL=$(jq -r .api <<<"$S") INDEXER_URL=$(jq -r .indexer <<<"$S") HEALTH_URLS=$(jq -r '.health|join(",")' <<<"$S") \
DEPLOYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
ACCEPTANCE_FAST_FORWARD=1 pnpm acceptance
```

(The key is Anvil's public development account #0.)

### On Fuji

`VPS=user@host infra/acceptance-fuji.sh` — see `infra/contest.md`.
