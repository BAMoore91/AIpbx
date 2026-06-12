#!/usr/bin/env bash
# =============================================================================
# AIpbx — Asterisk container entrypoint
#
# Responsibilities
# ----------------
#  1. Validate required environment variables.
#  2. Run envsubst over every *.conf template in /etc/asterisk so that
#     ${VAR} placeholders are replaced with live values from the environment.
#  3. Generate a self-signed DTLS certificate/key pair if one is not already
#     present in /etc/asterisk/keys/  (needed for WebRTC DTLS-SRTP).
#  4. Exec asterisk in the foreground so Docker can manage the process.
#
# Environment variables consumed
# --------------------------------
#  PUBLIC_IP      — server's public IP (NAT traversal for PJSIP transports)
#  RTP_START      — first RTP UDP port  (default 10000)
#  RTP_END        — last  RTP UDP port  (default 10200)
#  ARI_USERNAME   — ARI / AMI username
#  ARI_PASSWORD   — ARI / AMI password  (also used for AMI user in manager.conf)
#  ARI_APP        — Stasis application name (default "aipbx")
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
# 3. envsubst — expand ${VAR} placeholders in all *.conf files
#
#    We work on copies so the originals (baked into the image) stay clean.
#    envsubst is given the explicit list of variables it should replace so
#    that Asterisk's own ${...} syntax (e.g. dialplan variables) is not
#    accidentally touched — we only substitute the env vars we own.
# ---------------------------------------------------------------------------
CONF_DIR="/etc/asterisk"
OWN_VARS='$PUBLIC_IP $RTP_START $RTP_END $ARI_USERNAME $ARI_PASSWORD $ARI_APP'

echo "[entrypoint] Applying envsubst to ${CONF_DIR}/*.conf ..."
for tmpl in "${CONF_DIR}"/*.conf; do
    # Substitute in place (write to a temp file first, then move)
    tmp=$(mktemp)
    envsubst "${OWN_VARS}" < "${tmpl}" > "${tmp}"
    mv "${tmp}" "${tmpl}"
done
echo "[entrypoint] envsubst done."

# ---------------------------------------------------------------------------
# 4. DTLS certificate generation
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
# 5. Ensure Asterisk spool directories exist (volumes may be empty on first run)
# ---------------------------------------------------------------------------
mkdir -p \
    /var/spool/asterisk/voicemail/default \
    /var/spool/asterisk/monitor \
    /var/spool/asterisk/outgoing \
    /var/spool/asterisk/tmp

# ---------------------------------------------------------------------------
# 6. Exec Asterisk in the foreground
#    -f  : run in foreground (don't fork)
#    -C  : config directory
#    -vvv: verbosity level 3 (adjust as needed; use -vvvvv for deep debug)
# ---------------------------------------------------------------------------
echo "[entrypoint] Starting Asterisk 20 ..."
exec asterisk -f -C "${CONF_DIR}" -vvv
