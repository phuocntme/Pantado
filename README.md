<p align="center"><img src="brand/banner.png" alt="Pantado" width="720"></p>

<h3 align="center">Any narrative. One token.</h3>

<p align="center">
An AI Agent that turns tokenized stocks and Avalanche tokens into indexes that can be asked, built, bought and shared.<br>
Built on Avalanche · live on Fuji testnet · <a href="https://pantado.xyz">pantado.xyz</a>
</p>

<p align="center">
<img alt="Avalanche" src="https://img.shields.io/badge/Avalanche-live%20on%20Fuji-E84142?logo=avalanche&logoColor=white">
<img alt="Contracts" src="https://img.shields.io/badge/contracts-11%20on%20Fuji-E84142">
<img alt="Pharaoh-ready" src="https://img.shields.io/badge/stock%20pools-Pharaoh--ready-F2A900">
<img alt="AI agent" src="https://img.shields.io/badge/AI%20agent-Claude-D97757">
<img alt="Tests" src="https://img.shields.io/badge/tests-400%2B%20passing-2fbf71">
</p>

<p align="center">
<b>🌐 Live app:</b> <a href="https://pantado.xyz">pantado.xyz</a> · <b>👤 Author:</b> <a href="https://github.com/phuocntme">phuocntme</a>
</p>

---

## At a glance

| | |
|---|---|
| **What** | An AI agent that turns any market narrative into one index token: ask about a stock or token, draft a basket with weights, a backtest and risks, publish it, and buy the whole basket in one USDC transaction. |
| **Try it** | [pantado.xyz](https://pantado.xyz): sign in with Google, X, email or passkey (embedded wallet with test funds), or Core / MetaMask. |
| **Avalanche** | 11 contracts on Fuji · 35 Avalanche tokens priced from Avalanche mainnet · `DexVenue` routes tested on an Avalanche mainnet fork (30 routes, quote = swap) · ready for Pharaoh's permissionless stock pools |
| **Safety** | Mint and burn pro rata to the vault · redeem in kind always open and free · stale prices pause buys, sells and auctions, never redeem · rebalances under notice, daily cap and loss budget |
| **Tested** | 90 Foundry tests incl. invariants · 179 TypeScript · 127 web · Playwright e2e 7 / 7 |

**Contents:** [Why](#why) · [What it does](#what-pantado-does) · [Features](#features) ·
[Stock data](#stock-data-pharaoh-ready) · [How it works](#how-it-works) · [Contracts](#contracts-on-avalanche-fuji-chain-43113) ·
[Tested](#tested) · [Roadmap](#roadmap) · [Run it](#run-it-locally)

## Why

Real-world assets are moving on-chain, but owning a *theme* is still a chore. To hold "AI chips + Bitcoin" you pick the assets, size the weights, sign one swap and one approval per asset, and then rebalance by hand forever. The data you need is scattered across chains and dashboards. Index products exist, but they are built by institutions, not by the people who have the idea.

**Pantado turns any market narrative into one token.**

## What Pantado does

Pantado lets anyone go from a market idea to owning it, in three steps:

1. **Understand the market.** Ask an AI agent about any stock or token and get answers built on live on-chain data, not guesses. Every number is pulled from a tool call and checked before you see it.
2. **Turn the idea into an index.** Describe a theme like "AI chips + Bitcoin" and the agent drafts the basket: assets, weights, a backtest and the risks. Tune it, publish it, and earn 0.20% every time someone trades it.
3. **Own the whole basket as one token.** One USDC payment buys every asset in a single transaction and gives you one ERC-20 backed by the real assets in its vault. Exit any time: sell for USDC, or redeem for the assets themselves, free.

No institution in between, no swap-by-swap execution, no manual rebalancing.

Index tokens have open supply: minted when you buy, burned when you exit, and always priced at the value of the vault. They never sell out.

## Features

| | |
|---|---|
| **Ask** | Live price, 24h / 7d / 30d change, range, volatility, drawdown, volume. Auto or Deep mode. Research, not investment advice. |
| **Build** | AI-drafted index with weights, backtest vs AVAX and main risks; **View** opens it in Create. |
| **Create & publish** | 2–20 tokenized stocks and Avalanche tokens, presets (Equal / Market cap / Low volatility), 90-day backtest, rebalancing Off / Manual / Auto. 5 USDC to publish. |
| **Buy & exit** | One transaction, all or nothing. Sell for USDC or redeem in kind: always open, fee-free, can't be paused. |
| **Portfolio** | Positions, PnL, drift, creator earnings, rebalance history. |
| **Sign in** | Google, X, email or passkey with an embedded wallet and test funds, or Core / MetaMask. |

**Marketplace:** 35 Avalanche tokens, 25 tokenized stocks and 10+ community indexes.

## Stock data: Pharaoh-ready

> **Pantado is built for Avalanche-native tokenized stocks.** Permissionless tokenized-stock pools on Avalanche are
> coming with **Pharaoh** but are not live yet. Until they are, this demo prices its tokenized stocks from a
> **temporary on-chain reference market: Robinhood Chain**, read-only. That is why a stock's page and the agent's
> answers name it as the reference market.
>
> - Token prices, history and volume come from Avalanche mainnet; only the stock data uses the stand-in.
> - On Fuji, stocks trade as test pTokens priced from that reference; nothing on Fuji has real value.
> - When the Avalanche stock pools launch, they replace the stand-in. Each stock's data source is set per asset in
>   `config/assets.json`; the switch needs no change to the index contracts.

## How it works

```
 App & login     Next.js web app · Privy (Google, X, email, passkey) · Core / MetaMask
      │
 AI agent        Claude Haiku (Auto) / Sonnet (Deep) · tools: prices, history, backtest, quotes, drafts
      │          · number check against tool data · daily on-topic suggestions
      │
 Data & services Market data (Avalanche + Robinhood Chain mainnets, read-only) · Indexer (Ponder + Postgres)
      │          · API (Fastify) · keepers: price pusher, rebalance trigger, auction filler, auto-fund, monitor
      │
 Contracts       IndexFactory · IndexVault (ERC-20 per index) · PriceOracle · SwapRouter · Rebalancer
                 · FeeSplitter · venues (Fuji test venues; DexVenue for mainnet, fork-tested)
```

**Safety by design**

- Buy mints pro rata to the current basket; sell is pro rata; redeem in kind is always open.
- One canonical price per asset; a stale price pauses buys, sells and auctions, never redeem.
- Rebalances run under notice, a daily cap, a loss budget and a maximum duration, including agent-managed indexes.
- The agent never signs user transactions. Its own manager wallet acts only on its own indexes, through the same guards.

## Fees

| Fee | Value |
|---|---|
| Index buy / sell | 0.50% (0.30% protocol, 0.20% creator) |
| Index creation | 5 USDC |
| Single-asset swap | 0.10% |
| Redeem in kind | free |

## Contracts on Avalanche Fuji (chain 43113)

| Contract | Address |
|---|---|
| IndexFactory | [`0x85c168A2fEd642fA12cE718CC3b7DF3678cDdFE6`](https://testnet.snowtrace.io/address/0x85c168A2fEd642fA12cE718CC3b7DF3678cDdFE6) |
| IndexVault (implementation) | [`0xe71FBb70f7d0954D7795c7982742BdD5061F5918`](https://testnet.snowtrace.io/address/0xe71FBb70f7d0954D7795c7982742BdD5061F5918) |
| PriceOracle | [`0xB9c0E113AC16F0eD02032c1723DfAbA9C082104e`](https://testnet.snowtrace.io/address/0xB9c0E113AC16F0eD02032c1723DfAbA9C082104e) |
| SwapRouter | [`0x32752d7aF03Dad7540884C1b7E593B3974E8412b`](https://testnet.snowtrace.io/address/0x32752d7aF03Dad7540884C1b7E593B3974E8412b) |
| Rebalancer | [`0x6edB4AFf968E66975F931199EC3eABd07cC2C3eD`](https://testnet.snowtrace.io/address/0x6edB4AFf968E66975F931199EC3eABd07cC2C3eD) |
| FeeSplitter | [`0xF502cAf5F22c7f13B3207AE5204e1949a90c7366`](https://testnet.snowtrace.io/address/0xF502cAf5F22c7f13B3207AE5204e1949a90c7366) |
| AssetRegistry | [`0xE04Cec64c402E614bDDc615aA4998EA765AA01A8`](https://testnet.snowtrace.io/address/0xE04Cec64c402E614bDDc615aA4998EA765AA01A8) |
| IndexLens | [`0x249c7EeE6f5aac10E92E4E275E8F01e0b1CeE711`](https://testnet.snowtrace.io/address/0x249c7EeE6f5aac10E92E4E275E8F01e0b1CeE711) |
| Stock venue | [`0xD6ed8fbcEe091642FDC97d5F1fF9A663fF5D5f63`](https://testnet.snowtrace.io/address/0xD6ed8fbcEe091642FDC97d5F1fF9A663fF5D5f63) |
| Token venue | [`0xDe9D072Db625FeC54500199Ac07e75D5Fc4F9b8F`](https://testnet.snowtrace.io/address/0xDe9D072Db625FeC54500199Ac07e75D5Fc4F9b8F) |
| Test USDC | [`0xd42405859FEaF57f75F433CFC62A425d6187e4f6`](https://testnet.snowtrace.io/address/0xd42405859FEaF57f75F433CFC62A425d6187e4f6) |

All 60 test asset tokens are listed in `contracts/deployments/fuji.json`. Assets on Fuji are test tokens priced
from the mainnet reference markets; nothing on Fuji has real value.

## Tested

| Suite | Result |
|---|---|
| Contracts (Foundry, incl. invariants) | 90 passed (+2 mainnet-fork tests, run with `AVALANCHE_FORK_RPC`) |
| Mainnet fork | 30 DexVenue routes: quote = swap; production deploy → create, buy, sell, redeem |
| TypeScript (shared, sdk, service-kit, api, agent, market-data, keepers, scripts) | 179 passed |
| Web (vitest) | 127 passed |
| End to end (Playwright, local chain) | 7 / 7 |

TypeScript ports of the contract math are golden-tested against Foundry fixtures; the index level from the indexer
equals `IndexLens` at the same block.

## Roadmap

- **Done:** product UI · 11 contracts live on Fuji · AI agent · mainnet price data · DEX venue tested on a mainnet fork.
- **Next:** mainnet beta, completed once Pharaoh's permissionless stock pools launch on Avalanche (not live yet;
  until then stock data uses the temporary reference market, see [Stock data: Pharaoh-ready](#stock-data-pharaoh-ready)).
- **Later:** meme-token indexes on Avalanche · open API for outside agents · verified creators.

## Run it locally

1. Install Foundry, Node 20+, pnpm and Docker.
2. `cp .env.example .env` and fill what you need (see `.env.example` and `infra/contest.md`).
3. `pnpm install && pnpm gen:config`
4. Local chain with everything: `STACK_PRICES=live STACK_KEEPERS=1 WEB_PORT=4002 pnpm --filter @pantado/e2e-app stack:anvil`
   → http://localhost:4002

Against Fuji with Docker: `infra/docker-compose.contest.yml` + `infra/docker-compose.fuji-local.yml` (see their
headers); public deploy: `infra/contest.md`.

### Commands

| What | Command |
|---|---|
| All TS tests (Anvil tests need Foundry) | `pnpm -r test` |
| Contracts | `cd contracts && forge build && forge test` |
| Generated config is up to date | `pnpm gen:config:check` |
| End-to-end contract demo on Anvil | `contracts/script/anvil-demo.sh` |
| Full local stack (Anvil, indexer, api, web) | `pnpm --filter @pantado/e2e-app stack:anvil` |
| App e2e on Anvil (Playwright) | `pnpm --filter @pantado/e2e-app e2e:anvil` |
| Level check (indexer vs IndexLens) | `INDEXER_URL=… pnpm --filter @pantado/scripts check-level` |
| Seed demo indexes | `pnpm --filter @pantado/scripts seed-demo` |
| Refresh seed prices / bands from the live market | `MARKET_DATA_URL=… pnpm --filter @pantado/scripts refresh:seeds [--check]` |
| Acceptance (spec §14) | `pnpm --filter @pantado/e2e-app acceptance` (see `test/e2e-app/README.md`) |
| Deploy to Fuji (one command) | `pnpm --filter @pantado/scripts deploy:fuji` (`--check` for a dry preflight) |
| Ship to a server | `VPS=user@host infra/deploy-vps.sh [--bootstrap]` |
| Acceptance on Fuji | `VPS=user@host infra/acceptance-fuji.sh` |
| Web dev server | `pnpm --filter @pantado/web dev` → http://localhost:4002 |
| Demo screenshots / video scenes | `pnpm --filter @pantado/e2e-app exec tsx demo/shots.ts <dir>` · `… demo/video.ts <dir>` |

## Repository

`contracts/` (Foundry, solc 0.8.26, OpenZeppelin 5) · `packages/shared` (config, schemas, contract math port) ·
`packages/sdk` (ABIs, reads, tx builders) · `packages/service-kit` (health, metrics, keys) · `keepers/*` ·
`services/{indexer,market-data,api,agent}` · `apps/web` (Next.js) · `infra/` (compose, Caddy, Prometheus, Grafana) ·
`scripts/` · `test/e2e-app`.

Design documents: `spec.md` (product specification) · `STRUCTURE.md` (repository layout) · `apps/web/reference/pantado-app.html` (reference UI).

## Author

**phuocntme** · GitHub: [@phuocntme](https://github.com/phuocntme)

## License

MIT — see [LICENSE](LICENSE).
