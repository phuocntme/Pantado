# market-data

Canonical prices (spec §8, §9.3): Avalanche price engine over whitelisted pools (deepest pool, $5k
liquidity floor, 3σ outlier filter), Robinhood Chain reference-pool 60 s TWAP for stocks with stock-API
fallback after 900 s, Chainlink / stock-API cross-checks. Only confirmed addresses are read.
Serves `GET /internal/prices`; writes Redis `price:<chain>:<id>` and publishes `prices`.
`MARKET_DATA_MODE=seed` serves config seed prices labelled "seed" — local development only.
Env: `PORT`, `HEALTH_PORT`, `REDIS_URL`, `STOCK_API_PROVIDER`, `STOCK_API_KEY`.
