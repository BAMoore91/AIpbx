#!/usr/bin/env bash
# =============================================================================
# AIpbx — Asterisk container entrypoint
#
# Responsibilities
# ----------------
#  1. Validate required environment variables.
#  2. Parse DATABASE_URL into PG_USER / PG_PASSWORD / PG_HOST / PG_PORT / PG_DB.
#  3. Install ODBC driver and DSN files (envsubst → /etc/odbcinst.ini and
#     /etc/odbc.ini) so res_odbc can connect to Postgres before Asterisk starts.
#  4. Optionally wait for Postgres to be reachable (best-effort, non-fatal).
#  5. Run envsubst over every *.conf template in /etc/asterisk so that
#     ${VAR} placeholders are replaced with live values from the environment.
#  6. Generate a self-signed DTLS certificate/key pair if one is not already
#     present in /etc/asterisk/keys/  (needed for WebRTC DTLS-SRTP).
#  7. Exec asterisk in the foreground so Docker can manage the process.
#
# Environment variables consumed
# --------------------------------
#  PUBLIC_IP      — server's public IP (NAT traversal for PJSIP transports)
#  RTP_START      — first RTP UDP port  (default 10000)
#  RTP_END        — last  RTP UDP port  (default 10200)
#  ARI_USERNAME   — ARI / AMI username
#  ARI_PASSWORD   — ARI / AMI password  (also used for AMI user in manager.conf)
#  ARI_APP        — Stasis application name (default "aipbx")
#  DATABASE_URL   — postgresql://USER:PASSWORD@HOST:PORT/DB
#                   (PG_USER/PG_PASSWORD/PG_HOST/PG_PORT/PG_DB are derived from this)
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# 1. Defaults for optional vars
# ---------------------------------------------------------------------------
export RTP_START="${RTP_START:-10000}"
export RTP_END="${RTP_END:-10200}"
export ARI_APP="${ARI_APP:-aipbx}"
export PUBLIC_IP="${PUBLIC_IP:-127.0.0.1}"

# ---------------------------------------------------------------------------
# 2. Validate required vars
# ---------------------------------------------------------------------------
: "${ARI_USERNAME:?ARI_USERNAME env var must be set}"
: "${ARI_PASSWORD:?ARI_PASSWORD env var must be set}"

echo "[entrypoint] PUBLIC_IP=${PUBLIC_IP}  RTP=${RTP_START}-${RTP_END}  ARI_APP=${ARI_APP}"

# ---------------------------------------------------------------------------
# 3. Parse DATABASE_URL → PG_USER PG_PASSWORD PG_HOST PG_PORT PG_DB
#
#    Expected format: postgresql://USER:PASSWORD@HOST:PORT/DB
#    (postgres:// scheme is also accepted as an alias)
#
#    We use a sed-based approach that works with bash's built-in string ops.
#    URL-decoding of special chars in credentials is NOT performed — keep
#    passwords as plain alphanumeric strings (or encode them separately).
# ---------------------------------------------------------------------------
DATABASE_URL="${DATABASE_URL:-}"

if [[ -n "${DATABASE_URL}" ]]; then
    # Strip the scheme prefix (postgresql:// or postgres://)
    _url="${DATABASE_URL#postgresql://}"
    _url="${_url#postgres://}"

    # Split user:password@host:port/db
    # userinfo is everything before the first @
    _userinfo="${_url%%@*}"
    # hostinfo is everything after the first @
    _hostinfo="${_url#*@}"

    # PG_USER and PG_PASSWORD from userinfo (user:password)
    export PG_USER="${_userinfo%%:*}"
    export PG_PASSWORD="${_userinfo#*:}"

    # host:port/db from hostinfo
    _hostport="${_hostinfo%%/*}"
    _dbpath="${_hostinfo#*/}"

    # Strip query string from db name (e.g. aipbx?sslmode=require → aipbx)
    # In bash glob patterns inside ${...%%...}, '?' is a wildcard — use [?] to
    # match a literal question-mark character.
    export PG_DB="${_dbpath%%[?]*}"
    export PG_DB="${PG_DB%%&*}"

    # HOST and PORT from _hostport
    if [[ "${_hostport}" == *:* ]]; then
        export PG_HOST="${_hostport%%:*}"
        export PG_PORT="${_hostport##*:}"
    else
        export PG_HOST="${_hostport}"
        export PG_PORT="5432"
    fi
else
    # Fallback defaults if DATABASE_URL is not provided
    export PG_USER="${PG_USER:-aipbx}"
    export PG_PASSWORD="${PG_PASSWORD:-}"
    export PG_HOST="${PG_HOST:-postgres}"
    export PG_PORT="${PG_PORT:-5432}"
    export PG_DB="${PG_DB:-aipbx}"
fi

echo "[entrypoint] Postgres: ${PG_USER}@${PG_HOST}:${PG_PORT}/${PG_DB}"

# ---------------------------------------------------------------------------
# 4. Install ODBC driver and DSN configuration files
#
#    The Dockerfile COPYs template files into /etc/asterisk/odbc/.
#    We envsubst PG_* variables into them and write the results to the
#    system-wide locations that unixodbc expects:
#      /etc/odbcinst.ini  — driver registration (path to psqlodbcw.so)
#      /etc/odbc.ini      — DSN definitions (asterisk-pg DSN → Postgres)
# ---------------------------------------------------------------------------
ODBC_STAGING="/etc/asterisk/odbc"
ODBC_VARS='$PG_HOST $PG_PORT $PG_DB $PG_USER $PG_PASSWORD'

if [[ -f "${ODBC_STAGING}/odbcinst.ini" ]]; then
    echo "[entrypoint] Installing /etc/odbcinst.ini ..."
    envsubst "${ODBC_VARS}" < "${ODBC_STAGING}/odbcinst.ini" > /etc/odbcinst.ini
else
    echo "[entrypoint] WARNING: ${ODBC_STAGING}/odbcinst.ini not found — skipping."
fi

if [[ -f "${ODBC_STAGING}/odbc.ini" ]]; then
    echo "[entrypoint] Installing /etc/odbc.ini ..."
    envsubst "${ODBC_VARS}" < "${ODBC_STAGING}/odbc.ini" > /etc/odbc.ini
else
    echo "[entrypoint] WARNING: ${ODBC_STAGING}/odbc.ini not found — skipping."
fi

# ---------------------------------------------------------------------------
# 5. Wait for Postgres to be reachable (best-effort, non-fatal)
#
#    We give Postgres up to 30 seconds to accept connections.  If it is not
#    reachable we log a warning and continue — Asterisk's res_odbc has its own
#    reconnect logic (backoff_time / sanitysql) and will retry at runtime.
# ---------------------------------------------------------------------------
_pg_wait_seconds=30
_pg_waited=0
echo "[entrypoint] Waiting for Postgres at ${PG_HOST}:${PG_PORT} (up to ${_pg_wait_seconds}s) ..."
while true; do
    if command -v pg_isready >/dev/null 2>&1; then
        if pg_isready -h "${PG_HOST}" -p "${PG_PORT}" -U "${PG_USER}" -d "${PG_DB}" -q 2>/dev/null; then
            echo "[entrypoint] Postgres is ready."
            break
        fi
    else
        # Fallback: TCP reachability check via /dev/tcp (bash built-in)
        if (echo >/dev/tcp/"${PG_HOST}"/"${PG_PORT}") 2>/dev/null; then
            echo "[entrypoint] Postgres TCP port is open."
            break
        fi
    fi
    if [[ ${_pg_waited} -ge ${_pg_wait_seconds} ]]; then
        echo "[entrypoint] WARNING: Postgres not reachable after ${_pg_wait_seconds}s — continuing anyway."
        break
    fi
    sleep 1
    (( _pg_waited++ )) || true
done

# ---------------------------------------------------------------------------
# 6. envsubst — expand ${VAR} placeholders in all *.conf files
#
#    We work on copies so the originals (baked into the image) stay clean.
#    envsubst is given the explicit list of variables it should replace so
#    that Asterisk's own ${...} syntax (e.g. dialplan variables) is not
#    accidentally touched — we only substitute the env vars we own.
# ---------------------------------------------------------------------------
CONF_DIR="/etc/asterisk"
OWN_VARS='$PUBLIC_IP $RTP_START $RTP_END $ARI_USERNAME $ARI_PASSWORD $ARI_APP $PG_USER $PG_PASSWORD $PG_HOST $PG_PORT $PG_DB'

echo "[entrypoint] Applying envsubst to ${CONF_DIR}/*.conf ..."
for tmpl in "${CONF_DIR}"/*.conf; do
    # Substitute in place (write to a temp file first, then move)
    tmp=$(mktemp)
    envsubst "${OWN_VARS}" < "${tmpl}" > "${tmp}"
    mv "${tmp}" "${tmpl}"
done
echo "[entrypoint] envsubst done."

# ---------------------------------------------------------------------------
# 7. DTLS certificate generation
#
#    Asterisk uses DTLS-SRTP for WebRTC media negotiation.  We generate a
#    self-signed cert that is valid for 10 years.  In production you would
#    mount a real cert here via the asterisk_keys volume.
#
#    Files created:
#      /etc/asterisk/keys/asterisk.key  — RSA private key (2048-bit)
#      /etc/asterisk/keys/asterisk.crt  — self-signed X.509 certificate
# ---------------------------------------------------------------------------
KEYS_DIR="${CONF_DIR}/keys"
KEY_FILE="${KEYS_DIR}/asterisk.key"
CRT_FILE="${KEYS_DIR}/asterisk.crt"

mkdir -p "${KEYS_DIR}"

if [[ ! -f "${KEY_FILE}" ]] || [[ ! -f "${CRT_FILE}" ]]; then
    echo "[entrypoint] Generating self-signed DTLS certificate for ${PUBLIC_IP} ..."
    openssl req -newkey rsa:2048 -nodes \
        -keyout "${KEY_FILE}" \
        -x509 -days 3650 \
        -out "${CRT_FILE}" \
        -subj "/CN=${PUBLIC_IP}/O=AIpbx/OU=Asterisk" \
        -addext "subjectAltName=IP:${PUBLIC_IP}"
    chmod 600 "${KEY_FILE}"
    echo "[entrypoint] DTLS cert generated: ${CRT_FILE}"
else
    echo "[entrypoint] DTLS cert already present, skipping generation."
fi

# ---------------------------------------------------------------------------
# 8. Ensure Asterisk spool directories exist (volumes may be empty on first run)
# ---------------------------------------------------------------------------
mkdir -p \
    /var/spool/asterisk/voicemail/default \
    /var/spool/asterisk/monitor \
    /var/spool/asterisk/outgoing \
    /var/spool/asterisk/tmp

# ---------------------------------------------------------------------------
# 9. Exec Asterisk in the foreground
#    -f  : run in foreground (don't fork)
#    -C  : config directory
#    -vvv: verbosity level 3 (adjust as needed; use -vvvvv for deep debug)
# ---------------------------------------------------------------------------
echo "[entrypoint] Starting Asterisk 20 ..."
exec asterisk -f -C "${CONF_DIR}" -vvv
