# rebalance-trigger

Keeps rebalance plans moving (spec §5.7–5.8). Every `rebalanceTriggerPollSec`, for each index:
triggers Auto plans when due (drift ≥ θ or interval), starts scheduled plans after the notice, opens the
next auction when none is live and the daily cap allows, finalizes expired or finished plans, and syncs
indexes turned Off. Every call is simulated first; guards live in the Rebalancer, never here.
Env: `KEEPER_TRIGGER_KEY` (testnet only), `PORT`, `EXECUTION_RPC_URL` (optional).
