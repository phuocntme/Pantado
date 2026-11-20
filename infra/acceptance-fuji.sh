#!/usr/bin/env bash
# Spec §14 acceptance against the live contest stack on Fuji, from your machine.
# Opens an SSH tunnel to the VPS for the internal indexer and Prometheus, then runs test/e2e-app/acceptance.ts.
#
#   VPS=root@203.0.113.10 infra/acceptance-fuji.sh            # all steps (7 and 8 wait in real time)
#   VPS=… ACCEPTANCE_STEPS=1,2,3,4,5,6,9,10,11 infra/acceptance-fuji.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
: "${VPS:?set VPS=user@host}"
[[ -f .env ]] || { echo ".env missing" >&2; exit 1; }
DOMAIN="$(grep -E '^DOMAIN=' .env | cut -d= -f2-)"
[[ -n "$DOMAIN" ]] || { echo "DOMAIN is empty in .env" >&2; exit 1; }

IDX_PORT="${LOCAL_INDEXER_PORT:-42069}"
PROM_PORT="${LOCAL_PROMETHEUS_PORT:-9090}"
ssh -N -L "${IDX_PORT}:127.0.0.1:42069" -L "${PROM_PORT}:127.0.0.1:9090" "$VPS" &
TUNNEL=$!
trap 'kill $TUNNEL 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do curl -fsS "http://127.0.0.1:${IDX_PORT}/ready" >/dev/null 2>&1 && break; sleep 1; done

export PANTADO_PROFILE=contest
export API_URL="https://api.${DOMAIN}"
export AGENT_URL="${AGENT_URL:-https://agent.${DOMAIN}}"
export INDEXER_URL="http://127.0.0.1:${IDX_PORT}"
export PROMETHEUS_URL="http://127.0.0.1:${PROM_PORT}"
pnpm --filter @pantado/e2e-app acceptance
