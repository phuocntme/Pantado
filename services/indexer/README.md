# indexer

Ponder indexer for the execution chain (spec §9.1–9.2): factory, index vaults (factory children), oracle,
rebalancer, venues, fee splitter, router and ERC-20 transfers of every registry asset. Levels are
recomputed with the same integer math as `IndexLens` and must equal it at the same block
(`scripts/check-level.ts`). Mainnet data-plane chains are added once their pools are confirmed (V2, V4).
Env: `DATABASE_URL` (Postgres; PGlite when unset), `DATABASE_SCHEMA`, `PANTADO_PROFILE`, `EXECUTION_RPC_URL`.
HTTP: `/graphql`, `/sql/*`, `/levels/:index/latest`, `/indexes`, `/health`, `/ready`, `/metrics`.
