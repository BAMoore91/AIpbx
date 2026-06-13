# AIpbx — Asterisk 20 LTS Container

This directory contains the Asterisk 20 Docker image and all PJSIP/dialplan/ARI
configuration files for the AIpbx telephony core.

---

## Directory layout

```
asterisk/
├── Dockerfile              # Image build (based on andrius/asterisk:20-current)
├── entrypoint.sh           # Container start: envsubst → ODBC → DTLS cert → exec asterisk
└── etc/
    ├── odbcinst.ini        # ODBC driver registration template (→ /etc/odbcinst.ini)
    ├── odbc.ini            # ODBC DSN template (→ /etc/odbc.ini)
    └── asterisk/           # All config files (copied into /etc/asterisk in image)
        ├── asterisk.conf   # Core process settings
        ├── modules.conf    # Module load/noload directives
        ├── pjsip.conf      # PJSIP transports, endpoints, trunks (WebRTC + UDP)
        ├── http.conf       # HTTP server: ARI on :8088, WebRTC WSS on :8089
        ├── ari.conf        # ARI credentials and CORS
        ├── rtp.conf        # RTP port range, ICE/STUN, DTLS-SRTP settings
        ├── extensions.conf # Dialplan (internal, Stasis, AI bridge, outbound, trunks)
        ├── res_odbc.conf   # ODBC connection pool (DSN "asterisk" → "asterisk-pg")
        ├── extconfig.conf  # Realtime family → ODBC backend mappings (ps_* tables)
        ├── sorcery.conf    # Sorcery wizard mappings: PJSIP objects → realtime
        ├── voicemail.conf  # Voicemail mailboxes and settings
        ├── queues.conf     # ACD queue definitions (api manages members dynamically)
        ├── confbridge.conf # ConfBridge conference profiles
        ├── musiconhold.conf# MOH classes
        ├── manager.conf    # AMI: api service connects on :5038
        ├── acl.conf        # Named network ACLs
        ├── logger.conf     # Logging: console + file
        ├── cdr.conf        # Call detail record settings
        └── features.conf   # In-call DTMF features (transfer, park, record)
```

---

## Environment variables

All `${VAR}` placeholders in `etc/asterisk/*.conf` are substituted by
`entrypoint.sh` using `envsubst` before Asterisk starts.

| Variable        | Default   | Description                                 |
|-----------------|-----------|---------------------------------------------|
| `PUBLIC_IP`     | 127.0.0.1 | Server public IP for PJSIP NAT traversal    |
| `RTP_START`     | 10000     | First UDP port in the RTP range             |
| `RTP_END`       | 10200     | Last UDP port in the RTP range              |
| `ARI_USERNAME`  | (required)| ARI and AMI username                        |
| `ARI_PASSWORD`  | (required)| ARI and AMI password                        |
| `ARI_APP`       | aipbx     | Stasis application name                     |
| `DATABASE_URL`  | (required for realtime) | `postgresql://USER:PASS@HOST:PORT/DB` — parsed into PG_* vars |

`entrypoint.sh` parses `DATABASE_URL` and exports:
`PG_USER`, `PG_PASSWORD`, `PG_HOST` (default `postgres`), `PG_PORT` (default `5432`), `PG_DB` (default `aipbx`).

Set these in `.env` (project root) and they are passed to the container via
`docker-compose.yml`.

---

## Ports

| Port            | Protocol | Purpose                                      |
|-----------------|----------|----------------------------------------------|
| 5060            | UDP      | SIP signalling (softphones, carriers)        |
| 5061            | TCP      | SIP-TLS (encrypted signalling)               |
| 8088            | TCP      | ARI REST API + WebSocket events              |
| 8089            | TCP      | WebRTC WSS (browser phones via JsSIP/SIP.js) |
| 10000–10200     | UDP      | RTP media streams (~100 concurrent calls)    |
| 5038            | TCP      | AMI (internal Docker network only)           |

---

## How the pieces connect

### 1. ARI — api service controls call routing

```
Browser/Phone → Asterisk PJSIP → dialplan [aipbx-stasis]
                                        │
                             Stasis(aipbx) ──WebSocket──► api service (Node/TS)
                                                           │
                                          ARI REST: answer, playback, bridge,
                                          queue, record, transfer, hangup
```

The dialplan `[aipbx-stasis]` context immediately calls `Stasis(${ARI_APP})`.
This suspends the dialplan and fires a `StasisStart` WebSocket event to the api
service.  The api service has full control until it calls
`/channels/{id}/continue` (to resume the dialplan) or the call hangs up.

The api service connects to the ARI event WebSocket at:
```
ws://asterisk:8088/ari/events?api_key=<ARI_USERNAME>:<ARI_PASSWORD>&app=aipbx
```

### 2. AudioSocket — streaming call audio to the AI engine

```
Caller ─── Asterisk ─── AudioSocket() ─── TCP/9092 ─── ai-engine (Python)
                                                              │
                                                    STT → Claude → TTS
```

The `[aipbx-ai]` dialplan context (used as a Gosub subroutine) bridges any
channel to the AI engine using Asterisk's `AudioSocket()` application:

```ini
exten => s,1,AudioSocket(${AI_UUID},ai-engine:9092)
```

**AudioSocket wire framing** — each TCP frame:

```
 0        1        2        3
 ┌────────┬────────┬────────┬──────────────────────┐
 │  type  │  len (big-endian uint16)  │  payload…  │
 └────────┴────────┴────────┴──────────────────────┘
```

| Type byte | Meaning        | Payload                                    |
|-----------|----------------|--------------------------------------------|
| `0x01`    | UUID           | 16-byte binary UUID (sent once on connect) |
| `0x10`    | Audio          | 8 kHz, mono, signed 16-bit little-endian PCM (160 samples = 320 bytes = 20 ms per frame) |
| `0x00`    | Hangup / close | Empty (length = 0); close the connection   |

The **UUID** in the `AudioSocket()` call is generated by the api service for
each call and passed to the dialplan via a channel variable before executing
the subroutine.  The ai-engine looks up the UUID in Redis to find the
associated ARI channel and call context.

**Typical flow** (api service → dialplan → ai-engine):

1. `StasisStart` fires → api service answers the call via ARI.
2. api service generates a UUID, stores it in Redis keyed to the channel ID.
3. api service issues `POST /channels/{id}/variable` to set `AI_UUID=<uuid>`.
4. api service issues `POST /channels/{id}/continue` with context=`aipbx-ai`.
5. Asterisk executes `Gosub(aipbx-ai,s,1(${AI_UUID}))`.
6. `AudioSocket(${AI_UUID},ai-engine:9092)` opens TCP → ai-engine receives
   the UUID frame and starts the STT/LLM/TTS pipeline.
7. When the AI session ends, ai-engine sends type `0x00` → Asterisk returns
   from `AudioSocket()` → subroutine returns → api service regains control.

### 3. PJSIP Realtime (ODBC → Postgres)

The control-plane (api service) creates and updates SIP endpoints, credentials,
and address-of-records by writing rows directly to Postgres tables (`ps_endpoints`,
`ps_auths`, `ps_aors`, `ps_contacts`, `ps_endpoint_id_ips`, `ps_registrations`).
Asterisk reads these tables live via the following chain:

```
api service
    │  INSERT/UPDATE ps_endpoints, ps_auths, ps_aors, ...
    ▼
PostgreSQL (aipbx database)
    │  ODBC connection via DSN "asterisk-pg"
    ▼
res_odbc.so  (connection pool [asterisk] in res_odbc.conf)
    │  realtime driver translates object reads/writes to SQL
    ▼
res_config_odbc.so  (extconfig.conf: ps_endpoints => odbc,asterisk)
    │  sorcery "realtime" wizard
    ▼
res_sorcery_realtime.so  (sorcery.conf: endpoint = realtime,ps_endpoints)
    │
    ▼
res_pjsip.so — endpoints/auths/aors are resolved live from DB
```

**Static vs. realtime coexistence** — Asterisk merges both sources.  The
transports (`transport-udp`, `transport-tcp`, `transport-tls`, `transport-wss`)
and seed endpoints (1001, 1002, anonymous) remain in `pjsip.conf` and are loaded
by the default sorcery "config" wizard.  Realtime objects from Postgres are merged
in alongside them — there is no conflict.

**Contact registration** — when a UA sends a REGISTER, Asterisk writes the
contact record back to `ps_contacts` via the same realtime path.  This means
contacts survive Asterisk restarts (the DB persists them) and multiple Asterisk
nodes can share the contact table for horizontal scaling.

**DSN templating chain:**
```
DATABASE_URL (env)
    │  parsed by entrypoint.sh
    ▼
PG_USER / PG_PASSWORD / PG_HOST / PG_PORT / PG_DB (exported)
    │  envsubst
    ▼
/etc/odbc.ini           ← [asterisk-pg] Servername=${PG_HOST} Port=${PG_PORT} ...
/etc/odbcinst.ini       ← [PostgreSQL] Driver=/usr/lib/.../psqlodbcw.so
/etc/asterisk/res_odbc.conf  ← [asterisk] dsn=asterisk-pg username=${PG_USER} ...
```

#### Debugging realtime

```bash
# Verify the ODBC connection pool is up
docker compose exec asterisk asterisk -rx "odbc show"

# List all endpoints (static + realtime merged)
docker compose exec asterisk asterisk -rx "pjsip show endpoints"

# Show a specific realtime endpoint
docker compose exec asterisk asterisk -rx "pjsip show endpoint <id>"

# Show registered contacts (from ps_contacts)
docker compose exec asterisk asterisk -rx "pjsip show contacts"

# Show AORs and their current registrations
docker compose exec asterisk asterisk -rx "pjsip show aors"

# Force Asterisk to re-read realtime config (no restart needed)
docker compose exec asterisk asterisk -rx "module reload res_pjsip.so"

# Inspect a realtime family directly
docker compose exec asterisk asterisk -rx "realtime show ps_endpoints"

# Test the ODBC DSN from the command line inside the container
docker compose exec asterisk isql -v asterisk-pg "${PG_USER}" "${PG_PASSWORD}"
```

#### Module load order

The following load order in `modules.conf` is critical:

1. `res_odbc.so` (preload) — establishes the ODBC connection pool
2. `res_config_odbc.so` (preload) — registers the odbc realtime driver
3. `res_sorcery_realtime.so` (preload) — provides the "realtime" wizard
4. `res_pjsip.so` (load) — reads sorcery.conf and begins querying realtime

If `res_odbc` is not ready before `res_pjsip` initialises, the realtime
families will fail to register and endpoints will not be found in the DB.

### 4. WebRTC softphone (JsSIP / SIP.js)

Browser phones connect over WSS:

```
Browser (JsSIP) ──WSS:8089──► Asterisk (transport-wss / HTTP server)
                              DTLS-SRTP for media
                              ICE for NAT traversal
```

The PJSIP endpoint `1002` demonstrates the WebRTC configuration:
```ini
transport  = transport-wss
webrtc     = yes          ; enables DTLS-SRTP, ICE, AVPF, RTCP-mux
allow      = !all,opus,ulaw
```

The frontend `VITE_SIP_WSS_URL` environment variable should be set to
`wss://<your-domain>:8089/ws`.

---

## DTLS certificate

`entrypoint.sh` auto-generates a self-signed certificate at startup if none
exists in `/etc/asterisk/keys/` (mounted as the `asterisk_keys` Docker volume):

```
/etc/asterisk/keys/asterisk.key   — RSA 2048-bit private key
/etc/asterisk/keys/asterisk.crt   — Self-signed X.509 certificate
```

For production, mount a real certificate (e.g. from Let's Encrypt):

```yaml
# docker-compose.yml
volumes:
  - /etc/letsencrypt/live/your.domain/privkey.pem:/etc/asterisk/keys/asterisk.key:ro
  - /etc/letsencrypt/live/your.domain/fullchain.pem:/etc/asterisk/keys/asterisk.crt:ro
```

---

## Adding extensions and trunks

### Add an extension (static config)

1. Add auth, aor, and endpoint sections to `pjsip.conf` following the `1001`/`1002` pattern.
2. Add a mailbox entry to `voicemail.conf` `[default]`.
3. Reload: `docker exec aipbx-asterisk asterisk -rx "core reload"`

### Add an extension (dynamic — api service)

The api service writes directly to the `ps_endpoints`, `ps_auths`, `ps_aors`
PostgreSQL tables (Asterisk PJSIP realtime) and calls:

```
AMI Action: UpdateConfig
AMI Action: reload (module=res_pjsip.so)
```

See `services/api/src/sip/` for the provisioning code.

### Add a SIP trunk

Uncomment and fill in the trunk template at the bottom of `pjsip.conf`.
At minimum you need:
- `[trunk-X-auth]` — carrier credentials
- `[trunk-X]` (AOR) — carrier SIP URI
- `[trunk-X-endpoint]` — context=from-trunk, outbound_auth, transport
- `[trunk-X-registration]` — if carrier requires REGISTER
- `[trunk-X-identify]` — match inbound INVITEs from carrier IPs

---

## Verifying the setup

```bash
# Check Asterisk is running
docker compose exec asterisk asterisk -rx "core show version"

# Show registered endpoints
docker compose exec asterisk asterisk -rx "pjsip show endpoints"

# Show active channels
docker compose exec asterisk asterisk -rx "core show channels"

# Check ARI is reachable
curl -u "${ARI_USERNAME}:${ARI_PASSWORD}" http://localhost:8088/ari/asterisk/info

# Tail Asterisk logs
docker compose logs -f asterisk
```

---

## Assumptions and design decisions

- **andrius/asterisk:20-current** is used as the base image. It includes all
  required modules compiled in. If this image becomes unavailable, the
  Dockerfile can be adapted to build from debian:bookworm using the official
  Asterisk 20 source tarball.

- **Passwords from environment only** — no secrets are hardcoded.  The seed
  endpoints (1001, 1002) share `${ARI_PASSWORD}` as their SIP credential for
  simplicity; production deployments should give each extension its own
  password managed via the api service.

- **envsubst variable scoping** — `entrypoint.sh` passes an explicit variable
  list to `envsubst`, so Asterisk's own `${EXTEN}`, `${CALLERID}`, etc. in
  `extensions.conf` are left untouched.

- **ICE/STUN** — `rtp.conf` points at Google's public STUN server for
  development.  For production, run `coturn` or use a commercial STUN/TURN
  service and update `stunaddr`/`turnaddr`.

- **AMI and ARI share the same password** (`${ARI_PASSWORD}`) for operational
  simplicity.  You can use separate `ARI_PASSWORD` and `AMI_PASSWORD` env vars
  by extending `entrypoint.sh` and adding a second AMI user in `manager.conf`.

- **RTP concurrency** — 200 ports (10000–10200) supports ~100 simultaneous
  calls.  For higher concurrency increase `RTP_END` and update the
  `docker-compose.yml` port mapping accordingly.
