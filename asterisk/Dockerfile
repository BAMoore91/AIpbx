# =============================================================================
# AIpbx — Asterisk 20 LTS Docker image
#
# Base: andrius/asterisk:20-current (Debian-based, pre-compiled with most
#       modules including chan_pjsip, res_ari*, app_audiosocket,
#       chan_audiosocket, res_http_websocket, app_queue, app_confbridge,
#       res_musiconhold).
#
# Build: docker build -t aipbx-asterisk .
# Run:   see docker-compose.yml
# =============================================================================
FROM andrius/asterisk:20-current

LABEL org.opencontainers.image.title="AIpbx Asterisk"
LABEL org.opencontainers.image.description="Asterisk 20 LTS — PJSIP, ARI, AudioSocket, WebRTC"
LABEL org.opencontainers.image.version="20"

# ---------------------------------------------------------------------------
# System tools needed at runtime by entrypoint.sh:
#   - gettext-base  → envsubst
#   - openssl       → self-signed DTLS cert generation
#   - uuid-runtime  → uuidgen (for per-call AudioSocket UUIDs in shell tests)
# ---------------------------------------------------------------------------
RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends \
        gettext-base \
        openssl \
        uuid-runtime \
    && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
# Copy the template configuration tree.
# entrypoint.sh will run envsubst over every *.conf file before Asterisk
# starts, expanding ${VAR} placeholders with live environment values.
# ---------------------------------------------------------------------------
COPY etc/asterisk/ /etc/asterisk/

# ---------------------------------------------------------------------------
# Copy and set executable bit on the entrypoint script.
# ---------------------------------------------------------------------------
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# ---------------------------------------------------------------------------
# Persistent directories:
#   /var/spool/asterisk  – voicemail, recordings, CDR files   (volume mount)
#   /etc/asterisk/keys   – DTLS cert + key pair                (volume mount)
#
# Create directories that might not exist in the base image.
# ---------------------------------------------------------------------------
RUN mkdir -p \
    /var/spool/asterisk/voicemail \
    /var/spool/asterisk/monitor \
    /var/spool/asterisk/outgoing \
    /etc/asterisk/keys

# Expose ports (documentation only — actual publishing via compose)
# SIP UDP / SIP TLS / ARI HTTP / WebRTC WSS / RTP range
EXPOSE 5060/udp 5061/tcp 8088/tcp 8089/tcp 10000-10200/udp

ENTRYPOINT ["/entrypoint.sh"]
