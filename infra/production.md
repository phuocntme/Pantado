# Production topology (spec §11.2 — documented, not built)

Same services, config keys and boundaries as the contest stack; scale by moving services, not rewriting them.

- **Execution:** `PANTADO_PROFILE=production` → `config/networks/production.json` (execution on Avalanche
  43114, token legs via `dex-venue`, stock legs via `stock-venue` until permissionless stock pools on Avalanche
  are released and `venue.production` points to them). Every mainnet address must be confirmed on-chain first.
  Keeper and agent-manager keys are testnet-only: production needs KMS-backed
  signers and a multisig/timelock owner for admin roles (out of scope for this build).
- **Nodes:** own AvalancheGo nodes on local NVMe (RPC + WS), public RPCs as fallbacks (`rpcEnv`).
- **Data:** Postgres + TimescaleDB for app tables; ClickHouse for swaps/transfers at volume; Redpanda between
  ingestion (indexer) and consumers (market-data, api, monitor); Parquet cold storage for history.
- **Hosts:** split by role — ingestion (indexer, market-data), serving (api, web, agent behind a load balancer,
  Redis cluster), keepers (isolated host, signer via KMS), observability (Prometheus/Grafana, alerting).
- **Security:** contract audit and legal review before mainnet; WAF/rate limiting at the edge; secrets in a
  vault; backups to object storage with lifecycle rules and restore drills.
