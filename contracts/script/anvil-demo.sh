#!/usr/bin/env bash
# P4 gate: deploy everything to a fresh Anvil and run the end-to-end demo.
# Uses Anvil's built-in development accounts (public test keys, local chain only).
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${ANVIL_PORT:-8545}"
RPC="http://127.0.0.1:${PORT}"
export NETWORK=anvil DEMO=true
# Anvil default accounts #0 (deployer) and #1 (second wallet) — local development only.
export DEPLOYER_PRIVATE_KEY="${ANVIL_DEPLOYER_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
export DEMO_USER_KEY="${ANVIL_USER_KEY:-0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d}"

anvil --port "$PORT" --silent --gas-limit 300000000 --code-size-limit 50000 &
ANVIL_PID=$!
trap 'kill $ANVIL_PID 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do cast block-number --rpc-url "$RPC" >/dev/null 2>&1 && break; sleep 0.2; done

forge script script/Deploy.s.sol --rpc-url "$RPC" --broadcast --slow -q
DEMO_STAGE=1 forge script script/Demo.s.sol --rpc-url "$RPC" --broadcast
NOTICE=$(jq '.demoOverrides.noticeSec' config/params.json)
cast rpc evm_increaseTime $((NOTICE + 1)) --rpc-url "$RPC" >/dev/null
cast rpc evm_mine --rpc-url "$RPC" >/dev/null
DEMO_STAGE=2 forge script script/Demo.s.sol --rpc-url "$RPC" --broadcast
echo "anvil demo: OK"
