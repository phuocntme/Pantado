# agent

LLM harness for Ask (spec §10). Provider-agnostic client (`src/llm.ts`; adapter chosen by
`AGENT_LLM_PROVIDER`, Anthropic implemented), tools over the public Pantado API only, SSE `POST /ask`
(Auto ≤ 4 steps / Deep ≤ 12), `POST /draft` (validated against the registry and §5 limits),
`GET /assessment/:index` (deterministic, from data-layer numbers), and the agent-manager loop that may
publish versions on its own Manual indexes through the Rebalancer guards. The agent never signs user txs.
Env: `API_URL`, `AGENT_LLM_PROVIDER`, `AGENT_LLM_API_KEY`, `AGENT_AUTO_MODEL`, `AGENT_DEEP_MODEL`,
`AGENT_MANAGER_KEY` (testnet), `AGENT_MANAGER_DRY_RUN`, `REDIS_URL`, `PORT`.
