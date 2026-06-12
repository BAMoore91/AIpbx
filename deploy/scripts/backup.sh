#!/usr/bin/env bash
# =============================================================================
# AIpbx — Database Backup to DigitalOcean Spaces
# =============================================================================
# Creates a gzipped PostgreSQL dump, uploads it to Spaces (S3-compatible),
# then prunes backups older than BACKUP_RETENTION_DAYS.
#
# Usage:
#   Run manually:
#     bash backup.sh
#
#   Or schedule via cron (as root, from DEPLOY_DIR):
#     0 2 * * * cd /opt/aipbx && bash deploy/scripts/backup.sh >> /var/log/aipbx-backup.log 2>&1
#
# Required environment variables (loaded from .env or exported before running):
#   S3_BUCKET, S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_REGION
#   POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD
#
# Optional:
#   DEPLOY_DIR              — repo root (default /opt/aipbx)
#   BACKUP_RETENTION_DAYS   — days to keep backups (default 30)
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
# Configuration — all required
# -----------------------------------------------------------------------------
: "${S3_BUCKET:?S3_BUCKET is required}"
: "${S3_ENDPOINT:?S3_ENDPOINT is required}"
: "${S3_ACCESS_KEY:?S3_ACCESS_KEY is required}"
: "${S3_SECRET_KEY:?S3_SECRET_KEY is required}"
: "${S3_REGION:?S3_REGION is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"

BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
BACKUP_PREFIX="db-backups"
TIMESTAMP=$(date -u '+%Y%m%dT%H%M%SZ')
BACKUP_FILENAME="aipbx_${TIMESTAMP}.sql.gz"
BACKUP_S3_KEY="${BACKUP_PREFIX}/${BACKUP_FILENAME}"
TMP_BACKUP="/tmp/${BACKUP_FILENAME}"

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
log()  { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] INFO  $*"; }
ok()   { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] OK    $*"; }
warn() { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] WARN  $*"; }
die()  { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] ERROR $*" >&2; exit 1; }

# Configure AWS CLI for DigitalOcean Spaces
aws_cmd() {
    AWS_ACCESS_KEY_ID="${S3_ACCESS_KEY}" \
    AWS_SECRET_ACCESS_KEY="${S3_SECRET_KEY}" \
    aws --endpoint-url "${S3_ENDPOINT}" --region "${S3_REGION}" "$@"
}

# -----------------------------------------------------------------------------
# 1. Create the database dump
# -----------------------------------------------------------------------------
create_dump() {
    log "Creating PostgreSQL dump of '${POSTGRES_DB}'..."

    cd "${DEPLOY_DIR}"

    # pg_dump runs inside the postgres container, piped through gzip, saved to host /tmp
    PGPASSWORD="${POSTGRES_PASSWORD}" \
    docker compose exec -T postgres \
        pg_dump \
            --username="${POSTGRES_USER}" \
            --dbname="${POSTGRES_DB}" \
            --format=plain \
            --no-password \
            --verbose \
        | gzip -9 > "${TMP_BACKUP}"

    local dump_size
    dump_size=$(du -sh "${TMP_BACKUP}" | cut -f1)
    ok "Dump created: ${TMP_BACKUP} (${dump_size})"
}

# -----------------------------------------------------------------------------
# 2. Upload to Spaces
# -----------------------------------------------------------------------------
upload_dump() {
    log "Uploading to s3://${S3_BUCKET}/${BACKUP_S3_KEY}..."

    aws_cmd s3 cp \
        "${TMP_BACKUP}" \
        "s3://${S3_BUCKET}/${BACKUP_S3_KEY}" \
        --storage-class STANDARD \
        --metadata "created-by=aipbx-backup,hostname=$(hostname),db=${POSTGRES_DB}"

    ok "Uploaded: s3://${S3_BUCKET}/${BACKUP_S3_KEY}"
}

# -----------------------------------------------------------------------------
# 3. Clean up local temp file
# -----------------------------------------------------------------------------
cleanup_local() {
    if [[ -f "${TMP_BACKUP}" ]]; then
        rm -f "${TMP_BACKUP}"
        log "Local temp file removed: ${TMP_BACKUP}"
    fi
}

# -----------------------------------------------------------------------------
# 4. Prune old backups from Spaces
# -----------------------------------------------------------------------------
prune_old_backups() {
    log "Pruning backups older than ${BACKUP_RETENTION_DAYS} days..."

    local cutoff_epoch
    cutoff_epoch=$(date -u -d "${BACKUP_RETENTION_DAYS} days ago" '+%s' 2>/dev/null || \
                   date -u -v-"${BACKUP_RETENTION_DAYS}"d '+%s')  # macOS fallback

    local deleted=0

    # List all objects in the backup prefix, parse LastModified and Key
    while IFS= read -r line; do
        local obj_date obj_key obj_epoch
        # aws s3 ls output: "2024-01-15 03:22:10  12345678 db-backups/aipbx_20240115T032210Z.sql.gz"
        obj_date=$(echo "${line}" | awk '{print $1 " " $2}')
        obj_key=$(echo "${line}" | awk '{print $4}')

        # Skip empty lines or lines without a key
        [[ -z "${obj_key}" ]] && continue

        # Convert object date to epoch
        obj_epoch=$(date -u -d "${obj_date}" '+%s' 2>/dev/null || \
                    date -u -j -f "%Y-%m-%d %H:%M:%S" "${obj_date}" '+%s' 2>/dev/null || echo 0)

        if [[ "${obj_epoch}" -lt "${cutoff_epoch}" ]]; then
            log "Deleting old backup: ${obj_key} (date: ${obj_date})"
            aws_cmd s3 rm "s3://${S3_BUCKET}/${obj_key}" || warn "Failed to delete ${obj_key}"
            ((deleted++)) || true
        fi
    done < <(aws_cmd s3 ls "s3://${S3_BUCKET}/${BACKUP_PREFIX}/" 2>/dev/null || true)

    ok "Pruning complete — deleted ${deleted} old backup(s)."
}

# -----------------------------------------------------------------------------
# 5. Verify upload integrity (optional HEAD check)
# -----------------------------------------------------------------------------
verify_upload() {
    log "Verifying upload..."

    local etag
    etag=$(aws_cmd s3api head-object \
               --bucket "${S3_BUCKET}" \
               --key "${BACKUP_S3_KEY}" \
               --query 'ETag' \
               --output text 2>/dev/null || echo "")

    if [[ -n "${etag}" ]]; then
        ok "Upload verified — ETag: ${etag}"
    else
        warn "Could not verify upload (HEAD request failed) — check manually."
    fi
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
main() {
    log "=== AIpbx Backup Starting ==="
    log "  Database   : ${POSTGRES_DB}"
    log "  S3 Bucket  : ${S3_BUCKET}"
    log "  S3 Key     : ${BACKUP_S3_KEY}"
    log "  Retention  : ${BACKUP_RETENTION_DAYS} days"

    # Ensure cleanup on exit (even on error)
    trap cleanup_local EXIT

    create_dump
    upload_dump
    verify_upload
    prune_old_backups

    log "=== Backup Complete ==="
    log "  Backup: s3://${S3_BUCKET}/${BACKUP_S3_KEY}"
}

main "$@"
