# api

Public REST + WebSocket (spec §9.5–9.7) on Fastify. Indexed data from the indexer's GraphQL (HTTP only),
canonical prices from market-data, quotes from on-chain state with the golden-tested TS math
(`/quote/basket` equals the on-chain buy). Hot responses cached 2–5 s (Redis when `REDIS_URL` is set).
Env: `INDEXER_URL`, `MARKET_DATA_URL`, `REDIS_URL`, `EXECUTION_RPC_URL`, `PORT`.
