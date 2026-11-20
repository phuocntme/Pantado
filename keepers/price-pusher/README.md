# price-pusher

Pushes canonical prices from market-data (`GET /internal/prices`) to `PriceOracle` (spec §8).
Pushes every `pushIntervalSec` or on a move > `moveBps`; skips and alerts when canonical and cross-check
differ by more than `deviationBps`, when a price is outside its band, or when the source is older than
the asset's `maxAgeSec` — the on-chain price then ages and goes stale by design.
Env: `KEEPER_PRICE_PUSHER_KEY`, `MARKET_DATA_URL`, `PORT` (health/metrics), `EXECUTION_RPC_URL` (optional).
