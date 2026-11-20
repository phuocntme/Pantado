# @pantado/service-kit

Node runtime pieces shared by keepers and services: JSON logger, `/health` + `/metrics` server
(Prometheus via prom-client), interval loop with graceful stop, env helpers, and chain context
(viem clients + reader for the active profile). Keys are refused on mainnet chain ids.
