#!/usr/bin/env bash
# First-time VPS setup (Ubuntu/Debian): Docker Engine + compose plugin, firewall (22, 80, 443), swap, log limits.
# Run through infra/deploy-vps.sh --bootstrap, or directly on the host as root.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

if ! command -v docker >/dev/null; then
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg rsync ufw jq
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

# firewall: SSH + HTTP(S) only; every service port stays on the internal Docker network
if command -v ufw >/dev/null; then
  ufw allow 22/tcp
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw --force enable
fi

# 4 GB swap for image builds on small hosts
if ! swapon --show | grep -q '/swapfile'; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

docker --version
docker compose version
