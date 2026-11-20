#!/usr/bin/env bash
# Daily Postgres backup (spec §11.1): pg_dump → gzip → object storage (S3-compatible).
# Cron: 15 3 * * *  /opt/pantado/infra/backup.sh >> /var/log/pantado-backup.log 2>&1
# Env (.env): POSTGRES_PASSWORD, BACKUP_S3_URI (e.g. s3://bucket/pantado), optional BACKUP_S3_ENDPOINT, BACKUP_KEEP_DAYS.
set -euo pipefail
cd "$(dirname "$0")"
set -a; source ../.env; set +a
: "${BACKUP_S3_URI:?set BACKUP_S3_URI}"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
FILE="pantado-${STAMP}.sql.gz"
TMP="$(mktemp -d)"
trap 'rm -r -- "$TMP"' EXIT
docker compose -f docker-compose.contest.yml exec -T postgres pg_dump -U pantado -d pantado --format=plain | gzip -9 > "$TMP/$FILE"
ENDPOINT=()
[ -n "${BACKUP_S3_ENDPOINT:-}" ] && ENDPOINT=(--endpoint-url "$BACKUP_S3_ENDPOINT")
aws s3 cp "${ENDPOINT[@]}" "$TMP/$FILE" "${BACKUP_S3_URI%/}/$FILE"
echo "backup ok: ${BACKUP_S3_URI%/}/$FILE ($(du -h "$TMP/$FILE" | cut -f1))"
# retention is enforced by a bucket lifecycle rule (BACKUP_KEEP_DAYS, default 14) rather than deletes from here
