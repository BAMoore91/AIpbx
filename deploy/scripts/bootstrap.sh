#!/usr/bin/env bash
# =============================================================================
# AIpbx — idempotent host bootstrap script
# Run as root on a fresh Ubuntu 24.04 droplet (or re-run to update).
#
# Usage:
#   DOMAIN=pbx.example.com \
#   POSTGRES_PASSWORD=... \
#   REDIS_PASSWORD=... \
#   JWT_SECRET=... \
#   JWT_REFRESH_SECRET=... \
#   ENCRYPTION_KEY=... \
#   ARI_PASSWORD=... \
#   ANTHROPIC_API_KEY=... \
#   DEEPGRAM_API_KEY=... \
#   ELEVENLABS_API_KEY=... \
#   S3_ACCESS_KEY=... \
#   S3_SECRET_KEY=... \
#   REPO_URL=https://github.com/YOUR_ORG/AIpbx.git \
#   bash bootstrap.sh
# =============================================================================
set -euo pipefail

# -----------------------------------------------------------------------------
# Configuration — override via env vars
# -----------------------------------------------------------------------------
DEPLOY_DIR="${DEPLOY_DIR:-/opt/aipbx}"
REPO_URL="${REPO_URL:?REPO_URL is required (git clone URL)}"
REPO_BRANCH="${REPO_BRANCH:-main}"
COMPOSE_PROJECT="aipbx"

# Required application env vars — fail fast if any are missing
: "${DOMAIN:?DOMAIN is required (e.g. pbx.example.com)}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
: "${REDIS_PASSWORD:?REDIS_PASSWORD is required}"
: "${JWT_SECRET:?JWT_SECRET is required (64+ random chars)}"
: "${JWT_REFRESH_SECRET:?JWT_REFRESH_SECRET is required (64+ random chars)}"
: "${ENCRYPTION_KEY:?ENCRYPTION_KEY is required (32-byte base64)}"
: "${ARI_PASSWORD:?ARI_PASSWORD is required}"

# Optional secrets (empty string OK — features will be disabled)
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"
DEEPGRAM_API_KEY="${DEEPGRAM_API_KEY:-}"
ELEVENLABS_API_KEY="${ELEVENLABS_API_KEY:-}"
S3_ENDPOINT="${S3_ENDPOINT:-https://nyc3.digitaloceanspaces.com}"
S3_REGION="${S3_REGION:-nyc3}"
S3_BUCKET="${S3_BUCKET:-aipbx-recordings}"
S3_ACCESS_KEY="${S3_ACCESS_KEY:-}"
S3_SECRET_KEY="${S3_SECRET_KEY:-}"
SMTP_HOST="${SMTP_HOST:-}"
SMTP_PORT="${SMTP_PORT:-587}"
SMTP_USER="${SMTP_USER:-}"
SMTP_PASSWORD="${SMTP_PASSWORD:-}"
SMTP_FROM="${SMTP_FROM:-pbx@${DOMAIN}}"
LLM_MODEL="${LLM_MODEL:-claude-opus-4-8}"
LLM_EFFORT="${LLM_EFFORT:-low}"
STT_PROVIDER="${STT_PROVIDER:-deepgram}"
TTS_PROVIDER="${TTS_PROVIDER:-elevenlabs}"
ELEVENLABS_VOICE_ID="${ELEVENLABS_VOICE_ID:-21m00Tcm4TlvDq8ikWAM}"
PUBLIC_IP="${PUBLIC_IP:-}"

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
log()  { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"; }
ok()   { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] OK: $*"; }
die()  { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] ERROR: $*" >&2; exit 1; }

# -----------------------------------------------------------------------------
# 1. Install Docker CE (idempotent)
# -----------------------------------------------------------------------------
install_docker() {
    if command -v docker &>/dev/null; then
        ok "Docker already installed ($(docker --version))"
        return
    fi
    log "Installing Docker CE..."
    apt-get update -qq
    apt-get install -y --no-install-recommends \
        ca-certificates curl gnupg lsb-release

    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
        -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc

    echo \
        "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
        https://download.docker.com/linux/ubuntu \
        $(. /etc/os-release && echo "${VERSION_CODENAME}") stable" \
        | tee /etc/apt/sources.list.d/docker.list > /dev/null

    apt-get update -qq
    apt-get install -y docker-ce docker-ce-cli containerd.io \
        docker-buildx-plugin docker-compose-plugin

    systemctl enable docker
    systemctl start docker
    ok "Docker CE installed"
}

# -----------------------------------------------------------------------------
# 2. Clone or update the repository
# -----------------------------------------------------------------------------
setup_repo() {
    if [ -d "${DEPLOY_DIR}/.git" ]; then
        log "Repository already exists at ${DEPLOY_DIR}, pulling latest..."
        git -C "${DEPLOY_DIR}" fetch --all
        git -C "${DEPLOY_DIR}" checkout "${REPO_BRANCH}"
        git -C "${DEPLOY_DIR}" pull --ff-only origin "${REPO_BRANCH}"
        ok "Repository updated"
    else
        log "Cloning ${REPO_URL}#${REPO_BRANCH} → ${DEPLOY_DIR}..."
        mkdir -p "$(dirname "${DEPLOY_DIR}")"
        git clone --branch "${REPO_BRANCH}" "${REPO_URL}" "${DEPLOY_DIR}"
        ok "Repository cloned"
    fi
}

# -----------------------------------------------------------------------------
# 3. Write the .env file
# -----------------------------------------------------------------------------
write_env() {
    local env_file="${DEPLOY_DIR}/.env"
    log "Writing ${env_file}..."

    # Detect public IP if not provided
    if [ -z "${PUBLIC_IP}" ]; then
        PUBLIC_IP=$(curl -sf --max-time 5 https://checkip.amazonaws.com || \
                    curl -sf --max-time 5 https://api.ipify.org || \
                    echo "")
        log "Detected PUBLIC_IP: ${PUBLIC_IP}"
    fi

    cat > "${env_file}" << ENVEOF
# ============================================================================
# AIpbx — runtime environment
# Generated by bootstrap.sh on $(date -u '+%Y-%m-%dT%H:%M:%SZ')
# DO NOT COMMIT THIS FILE.
# ============================================================================

# ---- General ----
NODE_ENV=production
DOMAIN=${DOMAIN}
PUBLIC_IP=${PUBLIC_IP}
TZ=UTC

# ---- PostgreSQL ----
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_DB=aipbx
POSTGRES_USER=aipbx
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
DATABASE_URL=postgresql://aipbx:${POSTGRES_PASSWORD}@postgres:5432/aipbx

# ---- Redis ----
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=${REDIS_PASSWORD}
REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379

# ---- API service ----
API_PORT=3000
JWT_SECRET=${JWT_SECRET}
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
JWT_ACCESS_TTL=900
JWT_REFRESH_TTL=2592000
CORS_ORIGINS=https://${DOMAIN}
ENCRYPTION_KEY=${ENCRYPTION_KEY}

# ---- Asterisk ARI ----
ARI_URL=http://asterisk:8088
ARI_USERNAME=ariuser
ARI_PASSWORD=${ARI_PASSWORD}
ARI_APP=aipbx
ASTERISK_HOST=asterisk
ASTERISK_SIP_PORT=5060
ASTERISK_TLS_PORT=5061
ASTERISK_WSS_PORT=8089
RTP_START=10000
RTP_END=10200

# ---- AI Engine ----
AI_ENGINE_PORT=8080
AUDIOSOCKET_HOST=0.0.0.0
AUDIOSOCKET_PORT=9092

ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
LLM_MODEL=${LLM_MODEL}
LLM_EFFORT=${LLM_EFFORT}

STT_PROVIDER=${STT_PROVIDER}
DEEPGRAM_API_KEY=${DEEPGRAM_API_KEY}
OPENAI_API_KEY=

TTS_PROVIDER=${TTS_PROVIDER}
ELEVENLABS_API_KEY=${ELEVENLABS_API_KEY}
ELEVENLABS_VOICE_ID=${ELEVENLABS_VOICE_ID}
AZURE_TTS_KEY=
AZURE_TTS_REGION=

# ---- Object storage ----
S3_ENDPOINT=${S3_ENDPOINT}
S3_REGION=${S3_REGION}
S3_BUCKET=${S3_BUCKET}
S3_ACCESS_KEY=${S3_ACCESS_KEY}
S3_SECRET_KEY=${S3_SECRET_KEY}
S3_FORCE_PATH_STYLE=false

# ---- Email ----
SMTP_HOST=${SMTP_HOST}
SMTP_PORT=${SMTP_PORT}
SMTP_USER=${SMTP_USER}
SMTP_PASSWORD=${SMTP_PASSWORD}
SMTP_FROM=${SMTP_FROM}

# ---- Web frontend ----
WEB_PORT=80
VITE_API_URL=https://${DOMAIN}/api
VITE_WS_URL=wss://${DOMAIN}/ws
VITE_SIP_WSS_URL=wss://${DOMAIN}:8089/ws
ENVEOF

    chmod 600 "${env_file}"
    ok ".env written (mode 0600)"
}

# -----------------------------------------------------------------------------
# 4. Patch nginx config with real domain
# -----------------------------------------------------------------------------
patch_nginx_config() {
    local nginx_conf="${DEPLOY_DIR}/deploy/nginx/conf.d/aipbx.conf"
    if [ -f "${nginx_conf}" ]; then
        log "Patching nginx config with domain: ${DOMAIN}..."
        sed -i "s/pbx\.example\.com/${DOMAIN}/g" "${nginx_conf}"
        ok "nginx config patched"
    else
        log "WARN: nginx config not found at ${nginx_conf}, skipping patch"
    fi
}

# -----------------------------------------------------------------------------
# 5. Start/update the Docker Compose stack
# -----------------------------------------------------------------------------
start_stack() {
    log "Starting AIpbx stack via Docker Compose..."
    cd "${DEPLOY_DIR}"

    # Pull latest images (non-fatal — custom builds still work)
    docker compose pull --quiet || true

    # Build and start all services
    docker compose up -d --build --remove-orphans

    ok "Docker Compose stack started"
}

# -----------------------------------------------------------------------------
# 6. Install systemd service for auto-start on reboot
# -----------------------------------------------------------------------------
install_systemd_service() {
    if ! command -v systemctl &>/dev/null; then
        log "systemd not available, skipping service install"
        return
    fi

    local service_file="/etc/systemd/system/aipbx.service"
    if [ -f "${service_file}" ]; then
        ok "systemd service already installed"
        return
    fi

    log "Installing systemd service..."
    cat > "${service_file}" << SVCEOF
[Unit]
Description=AIpbx Docker Compose Stack
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${DEPLOY_DIR}
ExecStart=/usr/bin/docker compose up -d --remove-orphans
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
SVCEOF

    systemctl daemon-reload
    systemctl enable aipbx.service
    ok "systemd service installed and enabled"
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
main() {
    log "=== AIpbx Bootstrap starting ==="
    log "  DEPLOY_DIR  : ${DEPLOY_DIR}"
    log "  REPO_URL    : ${REPO_URL}"
    log "  REPO_BRANCH : ${REPO_BRANCH}"
    log "  DOMAIN      : ${DOMAIN}"

    install_docker
    setup_repo
    write_env
    patch_nginx_config
    start_stack
    install_systemd_service

    log "=== Bootstrap complete ==="
    echo ""
    echo "  Stack is starting at https://${DOMAIN}"
    echo ""
    echo "  Next step: obtain TLS certificate:"
    echo "    DOMAIN=${DOMAIN} EMAIL=admin@${DOMAIN} bash ${DEPLOY_DIR}/deploy/scripts/init-letsencrypt.sh"
    echo ""
    echo "  Monitor logs:"
    echo "    cd ${DEPLOY_DIR} && docker compose logs -f"
    echo ""
}

main "$@"
