#!/usr/bin/env bash
# =============================================================================
# AIpbx — Let's Encrypt certificate issuance via certbot webroot
#
# Run this after the nginx container is up and DNS is pointing to the server.
#
# Usage:
#   DOMAIN=pbx.example.com EMAIL=ops@example.com bash init-letsencrypt.sh
#
# Staging test (won't hit rate limits):
#   STAGING=1 DOMAIN=pbx.example.com EMAIL=ops@example.com bash init-letsencrypt.sh
#
# Environment variables:
#   DOMAIN       — required, FQDN (e.g. pbx.example.com)
#   EMAIL        — required, contact email for Let's Encrypt
#   STAGING      — set to 1 to use LE staging (default: 0)
#   DEPLOY_DIR   — path to the repo (default: /opt/aipbx)
# =============================================================================
set -euo pipefail

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------
DOMAIN="${DOMAIN:?DOMAIN is required (e.g. pbx.example.com)}"
EMAIL="${EMAIL:?EMAIL is required for Let's Encrypt registration}"
STAGING="${STAGING:-0}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/aipbx}"

# Docker Compose project name (matches 'name: aipbx' in docker-compose.yml)
COMPOSE_PROJECT="aipbx"

# Volume names as created by docker compose
CERTS_VOLUME="${COMPOSE_PROJECT}_certbot_certs"
WEBROOT_VOLUME="${COMPOSE_PROJECT}_certbot_www"

# Certbot docker image
CERTBOT_IMAGE="certbot/certbot:latest"

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
log()  { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"; }
ok()   { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] OK: $*"; }
die()  { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] ERROR: $*" >&2; exit 1; }

# -----------------------------------------------------------------------------
# Pre-flight checks
# -----------------------------------------------------------------------------
preflight() {
    log "Running pre-flight checks..."

    # Ensure Docker is available
    command -v docker >/dev/null || die "docker not found"

    # Ensure the nginx container is running
    local nginx_status
    nginx_status=$(cd "${DEPLOY_DIR}" && docker compose ps --status running --services 2>/dev/null || true)
    if ! echo "${nginx_status}" | grep -q "^nginx"; then
        log "nginx container is not running — starting it now..."
        cd "${DEPLOY_DIR}" && docker compose up -d nginx
        log "Waiting 5 seconds for nginx to start..."
        sleep 5
    fi

    # Verify the webroot volume exists (created by docker compose)
    if ! docker volume inspect "${WEBROOT_VOLUME}" &>/dev/null; then
        die "Volume ${WEBROOT_VOLUME} does not exist. Is the stack running? Run: cd ${DEPLOY_DIR} && docker compose up -d"
    fi

    ok "Pre-flight checks passed"
}

# -----------------------------------------------------------------------------
# Request/renew certificate
# -----------------------------------------------------------------------------
issue_cert() {
    local staging_flag=""
    if [ "${STAGING}" = "1" ]; then
        staging_flag="--staging"
        log "STAGING mode — certificate will NOT be trusted by browsers"
    fi

    log "Requesting certificate for ${DOMAIN} (email: ${EMAIL})..."

    # Pull latest certbot image
    docker pull --quiet "${CERTBOT_IMAGE}" || true

    # Run certbot with webroot authenticator
    # - /var/www/certbot inside certbot maps to certbot_www volume (served by nginx at /.well-known/acme-challenge/)
    # - /etc/letsencrypt inside certbot maps to certbot_certs volume (shared with nginx for ssl_certificate)
    docker run --rm \
        --name "certbot-${DOMAIN//./-}" \
        -v "${CERTS_VOLUME}:/etc/letsencrypt" \
        -v "${WEBROOT_VOLUME}:/var/www/certbot" \
        "${CERTBOT_IMAGE}" certonly \
            --webroot \
            --webroot-path /var/www/certbot \
            --email "${EMAIL}" \
            --domains "${DOMAIN}" \
            --agree-tos \
            --non-interactive \
            --expand \
            --rsa-key-size 4096 \
            ${staging_flag}

    ok "Certificate issued for ${DOMAIN}"
}

# -----------------------------------------------------------------------------
# Copy cert to Asterisk keys dir (for WebRTC WSS on port 8089)
# -----------------------------------------------------------------------------
copy_cert_to_asterisk() {
    log "Copying certificate to Asterisk keys volume..."

    # Asterisk volume is named aipbx_asterisk_keys
    local asterisk_keys_vol="${COMPOSE_PROJECT}_asterisk_keys"

    # Use a helper container to copy the cert into the Asterisk keys volume
    # The cert lives in certbot_certs volume at /etc/letsencrypt/live/DOMAIN/
    docker run --rm \
        -v "${CERTS_VOLUME}:/etc/letsencrypt:ro" \
        -v "${asterisk_keys_vol}:/etc/asterisk/keys" \
        alpine:3 sh -c "
            set -e
            LIVE=/etc/letsencrypt/live/${DOMAIN}
            KEYS=/etc/asterisk/keys
            cp \"\${LIVE}/fullchain.pem\" \"\${KEYS}/fullchain.pem\"
            cp \"\${LIVE}/privkey.pem\"   \"\${KEYS}/privkey.pem\"
            chmod 640 \"\${KEYS}/fullchain.pem\" \"\${KEYS}/privkey.pem\"
            echo 'Certificates copied to Asterisk keys volume'
        " || log "WARN: Could not copy cert to Asterisk keys volume (Asterisk may not be running yet)"

    ok "Cert copied to Asterisk keys"
}

# -----------------------------------------------------------------------------
# Reload nginx to pick up the new certificate
# -----------------------------------------------------------------------------
reload_nginx() {
    log "Reloading nginx..."
    cd "${DEPLOY_DIR}"

    if docker compose ps --status running --services 2>/dev/null | grep -q "^nginx"; then
        docker compose exec nginx nginx -s reload
        ok "nginx reloaded"
    else
        log "nginx not running, performing a fresh start..."
        docker compose up -d nginx
        ok "nginx started"
    fi
}

# -----------------------------------------------------------------------------
# Reload Asterisk HTTP module (for WebRTC WSS)
# -----------------------------------------------------------------------------
reload_asterisk_http() {
    log "Reloading Asterisk HTTP module..."
    cd "${DEPLOY_DIR}"

    if docker compose ps --status running --services 2>/dev/null | grep -q "^asterisk"; then
        docker compose exec asterisk asterisk -rx "module reload http" || \
            log "WARN: Could not reload Asterisk HTTP module"
        ok "Asterisk HTTP reloaded"
    else
        log "Asterisk not running, skipping reload"
    fi
}

# -----------------------------------------------------------------------------
# Print renewal instructions
# -----------------------------------------------------------------------------
print_renewal_instructions() {
    echo ""
    echo "============================================================"
    echo "  Certificate issued successfully!"
    echo ""
    echo "  Certificate path (inside nginx/certbot containers):"
    echo "    /etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
    echo "    /etc/letsencrypt/live/${DOMAIN}/privkey.pem"
    echo ""
    echo "  Set up automatic renewal with cron (runs twice daily):"
    echo ""
    echo "  Add to /etc/cron.d/aipbx-certbot:"
    echo "  0 0,12 * * * root DOMAIN=${DOMAIN} EMAIL=${EMAIL} DEPLOY_DIR=${DEPLOY_DIR} bash ${DEPLOY_DIR}/deploy/scripts/init-letsencrypt.sh >> /var/log/aipbx-certbot.log 2>&1"
    echo ""
    echo "  Or use the certbot renew command directly:"
    echo "  0 0,12 * * * root docker run --rm \\"
    echo "    -v ${CERTS_VOLUME}:/etc/letsencrypt \\"
    echo "    -v ${WEBROOT_VOLUME}:/var/www/certbot \\"
    echo "    ${CERTBOT_IMAGE} renew --quiet"
    echo ""
    if [ "${STAGING}" = "1" ]; then
        echo "  IMPORTANT: This was a STAGING certificate. Re-run without STAGING=1"
        echo "  to get a trusted production certificate."
    fi
    echo "============================================================"
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
main() {
    log "=== AIpbx Let's Encrypt initialization ==="
    log "  DOMAIN     : ${DOMAIN}"
    log "  EMAIL      : ${EMAIL}"
    log "  STAGING    : ${STAGING}"
    log "  DEPLOY_DIR : ${DEPLOY_DIR}"

    preflight
    issue_cert
    copy_cert_to_asterisk
    reload_nginx
    reload_asterisk_http
    print_renewal_instructions
}

main "$@"
