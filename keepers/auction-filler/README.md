# auction-filler

Demo filler (spec §5.8). Every `keepers.auctionFiller.pollSec`, for each live auction it compares the
auction price (bought asset per sold asset) with the oracle reference and fills when the edge is at least
`minEdgeBps`, up to `maxFillUsd` per fill. It buys what it pays with through `SwapRouter` using test USDC
(it is a USDC minter on testnets) and sells what it receives back to USDC. Anyone can fill; this keeper
only keeps the demo moving.
Env: `KEEPER_FILLER_KEY` (testnet only), `PORT`, `EXECUTION_RPC_URL` (optional).
