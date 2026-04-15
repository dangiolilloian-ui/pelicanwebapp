#!/bin/sh
# Nightly Postgres backup loop.
#
# Runs pg_dump against the compose `db` service once every BACKUP_INTERVAL
# seconds (default 24h) and writes a gzipped dump to /backups.  Old dumps
# past BACKUP_RETENTION (default 14) are pruned so the volume doesn't grow
# forever.
#
# We run in a loop rather than using cron so the container stays PID-1
# simple — no crond, no logrotate, just one shell process that the Docker
# supervisor can see and restart cleanly.

set -eu

: "${BACKUP_INTERVAL:=86400}"   # 24h
: "${BACKUP_RETENTION:=14}"     # days
: "${PGHOST:=db}"
: "${PGUSER:=pelican}"
: "${PGDATABASE:=pelican}"

mkdir -p /backups

log() {
  echo "[backup $(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
}

run_backup() {
  ts=$(date -u +%Y%m%d_%H%M%S)
  tmp="/backups/.pelican-${ts}.sql.gz.part"
  final="/backups/pelican-${ts}.sql.gz"

  log "starting pg_dump -> ${final}"
  # -Fp plain SQL + gzip keeps the dump human-readable and trivially
  # restorable with `gunzip -c | psql`.  We don't use -Fc because these
  # databases are small and the simpler format wins for ops.
  if PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" \
    --no-owner --no-privileges --clean --if-exists | gzip > "$tmp"; then
    mv "$tmp" "$final"
    size=$(du -h "$final" | cut -f1)
    log "ok: ${final} (${size})"
  else
    log "FAIL: pg_dump exited non-zero"
    rm -f "$tmp"
    return 1
  fi

  # Prune: anything older than BACKUP_RETENTION days.  find -mtime is
  # resolution-of-days which is exactly what we want here.
  find /backups -maxdepth 1 -type f -name 'pelican-*.sql.gz' -mtime "+${BACKUP_RETENTION}" -print -delete | \
    while read -r pruned; do log "pruned ${pruned}"; done || true
}

# Initial delay so we don't hammer the DB while the rest of the stack is
# still coming up on boot.
sleep 30

while :; do
  run_backup || true
  log "sleeping ${BACKUP_INTERVAL}s until next run"
  sleep "$BACKUP_INTERVAL"
done
