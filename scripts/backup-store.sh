#!/usr/bin/env bash
set -euo pipefail

# NanoClaw backup: store dir (messages.db + group data)
# Usage: ./scripts/backup-store.sh
# Override: ROOT=/custom/path ./scripts/backup-store.sh

ROOT="${ROOT:-/root/nanoclaw}"
STORE="${ROOT}/store"
DB="${STORE}/messages.db"
OUT="${ROOT}/backups"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
KEEP="${KEEP:-30}"

mkdir -p "$OUT"

# Fail-closed: DB must exist
if [[ ! -f "$DB" ]]; then
  echo "FAIL: database not found at $DB" >&2
  exit 1
fi

# Snapshot tar + gzip
tar -C "$ROOT" -czf "$OUT/store-${TS}.tgz" store

# Prune: keep last N
# shellcheck disable=SC2012
ls -1t "$OUT"/store-*.tgz 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f

echo "OK backup $OUT/store-${TS}.tgz"
