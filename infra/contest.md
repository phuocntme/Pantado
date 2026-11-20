# Contest runbook — Fuji + one VPS (spec §11.1, §14)

Everything below is scripted. Prerequisites: Fuji test AVAX, a VPS, a domain, and (for Ask) an LLM key.

## 1. `.env`

`cp .env.example .env`, then fill:

| Key | Notes |
|---|---|
| `DEPLOYER_PRIVATE_KEY`, `KEEPER_PRICE_PUSHER_KEY`, `KEEPER_TRIGGER_KEY`, `KEEPER_FILLER_KEY`, `KEEPER_AUTO_FUND_KEY`, `AGENT_MANAGER_KEY` | Six **new, Fuji-only** wallets (`cast wallet new` six times). Only the deployer needs faucet AVAX. |
| `AUTO_FUND_SECRET` | `openssl rand -hex 32` |
| `DOMAIN`, `POSTGRES_PASSWORD`, `GRAFANA_ADMIN_PASSWORD` | Host settings for the VPS. |
| `AGENT_LLM_API_KEY` | Needed for Ask / drafts / assessments. |
| `NEXT_PUBLIC_PRIVY_APP_ID` | Optional (Google, X, email sign-in). Without it: browser wallets. |
| `*_RPC_URL_FALLBACK` | Optional provider URLs; public RPCs are configured already. |

## 2. Deploy contracts to Fuji

```bash
pnpm install
# seeds = first on-chain prices and band centres: align them with the market right before deploying
(cd services/market-data && PORT=8199 pnpm start) &   # live mode; wait ~30 s for prices
MARKET_DATA_URL=http://127.0.0.1:8199 pnpm --filter @pantado/scripts refresh:seeds && pnpm gen:config
pnpm --filter @pantado/scripts deploy:fuji --check   # prints how much AVAX the deployer needs
# fund the deployer from a Fuji faucet, then:
pnpm --filter @pantado/scripts deploy:fuji           # contracts → deployments/fuji.json → keeper gas → demo indexes
```

Commit `contracts/deployments/fuji.json`. Re-running is safe (no redeploy unless `FORCE=1`).

## 3. DNS

A records (Cloudflare proxied is fine) → VPS IP: `DOMAIN`, `api.DOMAIN`, `agent.DOMAIN`, `grafana.DOMAIN`.
With Cloudflare proxying, set SSL mode to *Full (strict)*; Caddy obtains the certificates.

## 4. Ship to the VPS

```bash
VPS=root@<ip> infra/deploy-vps.sh --bootstrap   # first time: Docker, firewall, swap, then deploy
VPS=root@<ip> infra/deploy-vps.sh               # later deploys
```

The script syncs the repo and `.env`, builds and starts the 15 services, and waits for
`https://api.DOMAIN/health` and `https://DOMAIN/marketplace`.

## 5. Acceptance on Fuji (spec §14)

```bash
VPS=root@<ip> infra/acceptance-fuji.sh
```

It tunnels to the VPS-local indexer and Prometheus (published on `127.0.0.1` only) and runs
`test/e2e-app/acceptance.ts` with the deployer key from `.env`. Steps 7 and 8 wait for the 10-minute demo
notice and the auctions in real time (budget `ACCEPTANCE_SHOCK_TIMEOUT_MIN`, default 90); pick steps with
`ACCEPTANCE_STEPS=1,2,…`. Report: `test/e2e-app/acceptance-report.json`. Details: `test/e2e-app/README.md`.

## Day-2

- Logs: `ssh $VPS 'cd /opt/pantado && docker compose -f infra/docker-compose.contest.yml logs -f --tail 100 <service>'`
- Keeper gas: Grafana › keeper balances (alert `KeeperLowAvax` below `monitoring.keeperMinAvax`); top up with
  `pnpm --filter @pantado/scripts deploy:fuji` (it only tops up when the deployment exists).
- Backups: `infra/backup.sh` (cron on the VPS).
- Weekends: stock feeds pause at the Friday close while reference pools trade 24/7; when a pool and its feed
  differ by more than 2 % the pusher holds that stock (it goes stale, redeem still works). This is the designed
  behaviour (spec §8).
