#!/usr/bin/env bash
# =============================================================================
# AIpbx — Database Restore from DigitalOcean Spaces
# =============================================================================
# Downloads a backup from Spaces and restores it into the PostgreSQL container.
#
# Usage:
#   # Restore the latest backup automatically:
#   BACKUP_FILE=latest bash restore.sh
#
#   # Restore a specific backup by S3 key:
#   BACKUP_FILE=db-backups/aipbx_20240115T032210Z.sql.gz bash restore.sh
#
# Required environment variables (loaded from .env or exported):
#   BACKUP_FILE, S3_BUCKET, S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY
#   POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD
#
# Optional:
#   DEPLOY_DIR   — repo root (default /opt/aipbx)
#
# WARNING: This script DROPS and RECREATES the database. All current data
# will be permanently lost. You will be prompted to confirm.
# =============================================================================
set -euo pipefail

# -----------------------------------------------------------------------------
# Load .env if env vars are not already set
# -----------------------------------------------------------------------------
DEPLOY_DIR="${DEPLOY_DIR:-/opt/aipbx}"
ENV_FILE="${DEPLOY_DIR}/.env"

if [[ -f "${ENV_FILE}" ]]; then
    # shellcheck disable=SC1090
    set -a; source "${ENV_FILE}"; set +a
fi

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------
: "${S3_BUCKET:?S3_BUCKET is required}"
: "${S3_ENDPOINT:?S3_ENDPOINT is required}"
: "${S3_ACCESS_KEY:?S3_ACCESS_KEY is required}"
: "${S3_SECRET_KEY:?S3_SECRET_KEY is required}"
: "${S3_REGION:?S3_REGION is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"

BACKUP_FILE="${BACKUP_FILE:-latest}"
BACKUP_PREFIX="db-backups"
TMP_RESTORE="/tmp/aipbx-restore-$$.sql.gz"
TMP_SQL="/tmp/aipbx-restore-$$.sql"

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
log()  { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] INFO  $*"; }
ok()   { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] OK    $*"; }
warn() { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] WARN  $*"; }
die()  { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] ERROR $*" >&2; exit 1; }

cleanup() {
    rm -f "${TMP_RESTORE}" "${TMP_SQL}"
    log "Temporary files cleaned up."
}
trap cleanup EXIT

# Configure AWS CLI for DigitalOcean Spaces
aws_cmd() {
    AWS_ACCESS_KEY_ID="${S3_ACCESS_KEY}" \
    AWS_SECRET_ACCESS_KEY="${S3_SECRET_KEY}" \
    aws --endpoint-url "${S3_ENDPOINT}" --region "${S3_REGION}" "$@"
}

# -----------------------------------------------------------------------------
# 1. Resolve backup file — find the latest if BACKUP_FILE=latest
# -----------------------------------------------------------------------------
resolve_backup() {
    if [[ "${BACKUP_FILE}" == "latest" ]]; then
        log "Finding the most recent backup in s3://${S3_BUCKET}/${BACKUP_PREFIX}/..."

        local latest
        latest=$(aws_cmd s3 ls "s3://${S3_BUCKET}/${BACKUP_PREFIX}/" \
                 | grep '\.sql\.gz$' \
                 | sort -k1,2 \
                 | tail -n1 \
                 | awk '{print $4}' || true)

        if [[ -z "${latest}" ]]; then
            die "No .sql.gz backups found in s3://${S3_BUCKET}/${BACKUP_PREFIX}/"
        fi

        BACKUP_FILE="${BACKUP_PREFIX}/${latest}"
        log "Latest backup: ${BACKUP_FILE}"
    fi

    # If caller passed just a filename without prefix, add it
    if [[ "${BACKUP_FILE}" != "${BACKUP_PREFIX}/"* ]] && \
       [[ "${BACKUP_FILE}" != "s3://"* ]]; then
        BACKUP_FILE="${BACKUP_PREFIX}/${BACKUP_FILE}"
    fi

    log "Will restore from: s3://${S3_BUCKET}/${BACKUP_FILE}"
}

# -----------------------------------------------------------------------------
# 2. Download the backup file
# -----------------------------------------------------------------------------
download_backup() {
    log "Downloading s3://${S3_BUCKET}/${BACKUP_FILE}..."

    aws_cmd s3 cp \
        "s3://${S3_BUCKET}/${BACKUP_FILE}" \
        "${TMP_RESTORE}"

    local size
    size=$(du -sh "${TMP_RESTORE}" | cut -f1)
    ok "Downloaded: ${TMP_RESTORE} (${size})"
}

# -----------------------------------------------------------------------------
# 3. Confirm with the operator before destroying current data
# -----------------------------------------------------------------------------
confirm_restore() {
    echo ""
    echo "  =================================================================="
    echo "  WARNING: DATABASE RESTORE"
    echo "  =================================================================="
    echo "  Backup file : s3://${S3_BUCKET}/${BACKUP_FILE}"
    echo "  Database    : ${POSTGRES_DB}"
    echo "  Deploy dir  : ${DEPLOY_DIR}"
    echo ""
    echo "  This will DROP all tables in '${POSTGRES_DB}' and restore from"
    echo "  the backup. ALL CURRENT DATA WILL BE PERMANENTLY LOST."
    echo ""
    echo "  Type the word 'RESTORE' (all caps) to confirm, or anything else"
    echo "  to abort:"
    echo "  =================================================================="
    echo ""

    local answer
    read -r -p "  Confirmation: " answer

    if [[ "${answer}" != "RESTORE" ]]; then
        log "Restore aborted by operator."
        exit 0
    fi
    log "Restore confirmed."
}

# -----------------------------------------------------------------------------
# 4. Stop application services (keep postgres running)
# -----------------------------------------------------------------------------
stop_app_services() {
    log "Stopping application services (keeping postgres running)..."
    cd "${DEPLOY_DIR}"

    # Stop all services except postgres to prevent writes during restore
    local services_to_stop
    services_to_stop=$(docker compose config --services \
                       | grep -v "^postgres$" | tr '\n' ' ' || true)

    if [[ -n "${services_to_stop}" ]]; then
        # shellcheck disable=SC2086
        docker compose stop ${services_to_stop} 2>/dev/null || true
        log "Stopped: ${services_to_stop}"
    fi
}

# -----------------------------------------------------------------------------
# 5. Perform the restore
# -----------------------------------------------------------------------------
restore_database() {
    log "Decompressing backup..."
    gunzip -c "${TMP_RESTORE}" > "${TMP_SQL}"

    local sql_size
    sql_size=$(du -sh "${TMP_SQL}" | cut -f1)
    log "Decompressed SQL size: ${sql_size}"

    log "Dropping and recreating database '${POSTGRES_DB}'..."
    cd "${DEPLOY_DIR}"

    # Drop all objects in the public schema (cleaner than DROP/CREATE DATABASE
    # which would disconnect users) — works even with active connections
    docker compose exec -T postgres \
        psql \
            --username="${POSTGRES_USER}" \
            --dbname="postgres" \
            --no-password \
            --command="SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${POSTGRES_DB}' AND pid <> pg_backend_pid();" \
        2>/dev/null || true

    docker compose exec -T postgres \
        psql \
            --username="${POSTGRES_USER}" \
            --dbname="postgres" \
            --no-password \
            --command="DROP DATABASE IF EXISTS \"${POSTGRES_DB}\";"

    docker compose exec -T postgres \
        psql \
            --username="${POSTGRES_USER}" \
            --dbname="postgres" \
            --no-password \
            --command="CREATE DATABASE \"${POSTGRES_DB}\" OWNER \"${POSTGRES_USER}\";"

    log "Restoring SQL dump..."
    PGPASSWORD="${POSTGRES_PASSWORD}" \
    docker compose exec -T postgres \
        psql \
            --username="${POSTGRES_USER}" \
            --dbname="${POSTGRES_DB}" \
            --no-password \
            --quiet \
        < "${TMP_SQL}"

    ok "Database restored."
}

# -----------------------------------------------------------------------------
# 6. Verify the restore with basic row counts
# -----------------------------------------------------------------------------
verify_restore() {
    log "Verifying restore..."
    cd "${DEPLOY_DIR}"

    echo ""
    echo "  Row counts after restore:"
    docker compose exec -T postgres \
        psql \
            --username="${POSTGRES_USER}" \
            --dbname="${POSTGRES_DB}" \
            --no-password \
            --tuples-only \
            --command="
                SELECT
                    relname AS table_name,
                    n_live_tup AS approx_rows
                FROM pg_stat_user_tables
                ORDER BY n_live_tup DESC;
            " | grep -v '^\s*$' | sed 's/^/    /' || true
    echo ""

    local tenant_count
    tenant_count=$(docker compose exec -T postgres \
        psql --username="${POSTGRES_USER}" --dbname="${POSTGRES_DB}" \
             --no-password --tuples-only \
             --command="SELECT count(*) FROM tenants;" 2>/dev/null | tr -d ' ' || echo 0)

    if [[ "${tenant_count}" -ge 1 ]]; then
        ok "Restore verified — ${tenant_count} tenant(s) present."
    else
        warn "Tenant count is 0 — verify the restore completed correctly."
    fi
}

# -----------------------------------------------------------------------------
# 7. Restart all services
# -----------------------------------------------------------------------------
restart_stack() {
    log "Restarting full Docker Compose stack..."
    cd "${DEPLOY_DIR}"
    docker compose up -d --remove-orphans
    ok "Stack restarted."
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
main() {
    log "=== AIpbx Database Restore ==="
    log "  BACKUP_FILE : ${BACKUP_FILE}"
    log "  S3 Bucket   : ${S3_BUCKET}"
    log "  Database    : ${POSTGRES_DB}"
    log "  Deploy dir  : ${DEPLOY_DIR}"

    resolve_backup
    download_backup
    confirm_restore
    stop_app_services
    restore_database
    verify_restore
    restart_stack

    log "=== Restore Complete ==="
    echo ""
    echo "  Database restored from: s3://${S3_BUCKET}/${BACKUP_FILE}"
    echo "  Stack is restarting — check logs with:"
    echo "    cd ${DEPLOY_DIR} && docker compose logs -f"
    echo ""
}

main "$@"
