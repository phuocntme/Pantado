#!/usr/bin/env bash
# Ship Pantado to the VPS and (re)start the contest stack (spec §11.1).
#
#   VPS=root@203.0.113.10 infra/deploy-vps.sh              # sync code + .env, build, start, health-check
#   VPS=root@203.0.113.10 infra/deploy-vps.sh --bootstrap  # first time: install Docker, firewall, then deploy
#
# Needs: .env filled (see .env.example) and contracts/deployments/fuji.json (scripts/deploy-fuji.ts).
# DNS: A records for DOMAIN, api.DOMAIN, agent.DOMAIN, grafana.DOMAIN → the VPS (see infra/production.md).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

: "${VPS:?set VPS=user@host}"
DIR="${VPS_DIR:-/opt/pantado}"
COMPOSE="docker compose -f infra/docker-compose.contest.yml --env-file .env"

die() { printf '\033[31m✘ %s\033[0m\n' "$*" >&2; exit 1; }
ok() { printf '\033[32m✔\033[0m %s\n' "$*"; }

[[ -f .env ]] || die ".env missing (cp .env.example .env)"
DEP_FILE="$(jq -r .execution.deployments config/networks/contest.json)"
[[ -f "$DEP_FILE" ]] || die "$DEP_FILE missing — deploy to Fuji first (pnpm --filter @pantado/scripts deploy:fuji)"

# required secrets (values stay local until rsync over SSH)
for k in DOMAIN POSTGRES_PASSWORD GRAFANA_ADMIN_PASSWORD AUTO_FUND_SECRET AGENT_AUTO_MODEL AGENT_DEEP_MODEL KEEPER_PRICE_PUSHER_KEY KEEPER_TRIGGER_KEY KEEPER_FILLER_KEY KEEPER_AUTO_FUND_KEY; do
  grep -Eq "^${k}=.+" .env || die "$k is empty in .env"
done
grep -Eq "^AGENT_LLM_API_KEY=.+" .env || printf '  note: AGENT_LLM_API_KEY is empty — Ask will answer with an error until it is set\n'
DOMAIN="$(grep -E '^DOMAIN=' .env | cut -d= -f2-)"
ok "local checks (domain $DOMAIN, deployment $DEP_FILE)"

if [[ "${1:-}" == "--bootstrap" ]]; then
  ssh "$VPS" 'bash -s' < infra/bootstrap-vps.sh
  ok "VPS bootstrapped"
fi

ssh "$VPS" "mkdir -p '$DIR'"
rsync -az --delete \
  --exclude '.git' --exclude 'node_modules' --exclude '.next' --exclude 'dist' \
  --exclude 'contracts/out' --exclude 'contracts/cache' --exclude 'contracts/broadcast' \
  --exclude '.env' --exclude 'test/e2e-app/.stack.json' --exclude 'test/e2e-app/.market-history.json*' --exclude 'test/e2e-app/test-results' \
  --exclude 'contracts/deployments/anvil-*' --exclude 'contracts/deployments/e2e.json' \
  ./ "$VPS:$DIR/"
rsync -az --chmod=F600 .env "$VPS:$DIR/.env"
ok "code and .env synced to $VPS:$DIR"

ssh "$VPS" "cd '$DIR' && $COMPOSE up -d --build --remove-orphans"
ok "stack started"

echo "waiting for health…"
for host in "api.$DOMAIN/health" "$DOMAIN/marketplace"; do
  for _ in $(seq 1 60); do
    if curl -fsS --max-time 5 "https://$host" >/dev/null 2>&1; then ok "https://$host"; continue 2; fi
    sleep 5
  done
  die "https://$host did not come up — check: ssh $VPS 'cd $DIR && $COMPOSE ps && $COMPOSE logs --tail 50'"
done
ssh "$VPS" "cd '$DIR' && $COMPOSE ps --format 'table {{.Service}}\t{{.Status}}'"
echo
echo "Grafana: https://grafana.$DOMAIN (admin / GRAFANA_ADMIN_PASSWORD). Acceptance: see test/e2e-app/README.md."
