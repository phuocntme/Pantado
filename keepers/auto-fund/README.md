# auto-fund

Contest only (`flags.autoFundOnSignIn`). Sends each new embedded wallet `keepers.autoFund.usdc` test USDC
(minted; the keeper is a USDC minter) and `keepers.autoFund.avax` AVAX, once per wallet (spec §12).
`POST /fund {"address": "0x…"}` with `Authorization: Bearer $AUTO_FUND_SECRET`, called by the web app's
server after it verifies the Privy session — never from the browser. Once-per-wallet is an atomic Redis
`SET NX` on `autofund:<network>:<address>`.
Env: `KEEPER_AUTO_FUND_KEY` (testnet only), `AUTO_FUND_SECRET`, `REDIS_URL`, `PORT`.
