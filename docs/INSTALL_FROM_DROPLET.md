# Install AIpbx on a Running DigitalOcean Droplet

Start here when the droplet already exists (fresh **Ubuntu 24.04**, ≥ 4 vCPU / 8 GB,
root/sudo access). This installs the whole stack with one bootstrap script, then
issues TLS. Everything runs in Docker under `/opt/aipbx`.

> Repo: `https://github.com/BAMoore91/AIpbx` · branch
> `claude/3cx-ai-asterisk-core-p9fnd6`. Private repo? Use a tokened clone URL:
> `https://<GITHUB_TOKEN>@github.com/BAMoore91/AIpbx.git`.

---

## 0. Prerequisites (do these first)

1. **DNS** — add an A record `pbx.<your-domain>` → the droplet's public IP.
   TLS will not issue until this resolves. Verify: `dig +short pbx.<domain>`.
2. **Firewall** — open these inbound ports (DO Cloud Firewall *or* the droplet's
   `ufw`). Restrict 22 to your IP:

   | Port | Proto | Purpose |
   |---|---|---|
   | 22 | TCP | SSH (your IP only) |
   | 80, 443 | TCP | console + API (HTTP→HTTPS, TLS) |
   | 5060 | UDP | SIP |
   | 5061 | TCP | SIP-TLS |
   | 8089 | TCP | WebRTC (WSS) |
   | 10000–10200 | UDP | RTP media |

3. **Keys on hand** (optional but needed for AI/recordings): `ANTHROPIC_API_KEY`,
   `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`, and DO **Spaces** keys + bucket.

---

## 1. SSH in and generate secrets

```bash
ssh root@<droplet-ip>

# Generate strong secrets once and keep this block's output safe.
cat <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 24)
REDIS_PASSWORD=$(openssl rand -hex 24)
ARI_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 48)
JWT_REFRESH_SECRET=$(openssl rand -hex 48)
ENCRYPTION_KEY=$(openssl rand -base64 32)
INTERNAL_API_KEY=$(openssl rand -hex 32)
SEED_SIP_PASSWORD=$(openssl rand -hex 16)
EOF
```

> `ENCRYPTION_KEY` must be 32-byte base64 (ends in `=`). Use DB-safe values
> (the generators above are hex/base64 — fine).

---

## 2. Run the bootstrap (installs Docker, clones repo, writes `.env`, starts the stack)

Paste your real values into the `export`s, then run. The script is idempotent —
re-run it to update. **Required:** `REPO_URL, DOMAIN, POSTGRES_PASSWORD,
REDIS_PASSWORD, JWT_SECRET, JWT_REFRESH_SECRET, ENCRYPTION_KEY, ARI_PASSWORD`.

```bash
export DOMAIN="pbx.example.com"
export PUBLIC_IP="$(curl -fsSL https://ifconfig.me)"   # or your reserved IP
export REPO_URL="https://github.com/BAMoore91/AIpbx.git"
export REPO_BRANCH="claude/3cx-ai-asterisk-core-p9fnd6"

# Secrets from step 1
export POSTGRES_PASSWORD="..." REDIS_PASSWORD="..." ARI_PASSWORD="..."
export JWT_SECRET="..." JWT_REFRESH_SECRET="..." ENCRYPTION_KEY="..."
export INTERNAL_API_KEY="..." SEED_SIP_PASSWORD="..."

# First-run console superadmin (so you can log in immediately)
export BOOTSTRAP_ADMIN_EMAIL="admin@pbx.example.com"
export BOOTSTRAP_ADMIN_PASSWORD="<a strong password>"

# AI providers (optional — AI voice agents need these)
export ANTHROPIC_API_KEY="..." DEEPGRAM_API_KEY="..." ELEVENLABS_API_KEY="..."

# Recordings → DO Spaces (optional)
export S3_ENDPOINT="https://nyc3.digitaloceanspaces.com" S3_REGION="nyc3" \
       S3_BUCKET="aipbx-recordings" S3_ACCESS_KEY="..." S3_SECRET_KEY="..."

# Data retention defaults to 90 days (override: export RETENTION_DAYS=...)

curl -fsSL "https://raw.githubusercontent.com/BAMoore91/AIpbx/${REPO_BRANCH}/deploy/scripts/bootstrap.sh" -o /root/bootstrap.sh
bash /root/bootstrap.sh
```

For a **private** repo (raw fetch needs auth), clone first, then run the local copy:

```bash
apt-get update -y && apt-get install -y git
git clone --branch "$REPO_BRANCH" "https://<TOKEN>@github.com/BAMoore91/AIpbx.git" /opt/aipbx
bash /opt/aipbx/deploy/scripts/bootstrap.sh
```

The script: installs Docker CE, clones to `/opt/aipbx`, writes `/opt/aipbx/.env`
(0600) with all your values, seeds a self-signed placeholder cert so nginx’s
`:443` starts on first boot, runs `docker compose up -d --build`, and installs a
`systemd` unit so the stack restarts on reboot. Postgres applies the app schema,
the PJSIP realtime schema, and migrations on first init; the API auto-creates
your superadmin from `BOOTSTRAP_ADMIN_*`.

---

## 3. Issue the TLS certificate (after DNS resolves)

```bash
cd /opt/aipbx
DOMAIN="pbx.example.com" EMAIL="you@example.com" bash deploy/scripts/init-letsencrypt.sh
# Test against LE staging first if you like:
# STAGING=1 DOMAIN=pbx.example.com EMAIL=you@example.com bash deploy/scripts/init-letsencrypt.sh
```

This obtains the Let's Encrypt cert via the nginx webroot, installs it for the
console/API (443), and copies it into the Asterisk keys volume as
`asterisk.crt`/`asterisk.key` for WebRTC WSS (8089), then reloads nginx + Asterisk.

---

## 4. Verify

```bash
cd /opt/aipbx
docker compose ps                                              # all services Up/healthy
curl -fsS https://pbx.example.com/api/healthz                  # {"status":"ok",...}
docker compose exec -T asterisk asterisk -rx "odbc show"       # DSN 'asterisk' Connected
docker compose logs api | grep -i superadmin | tail -1         # "superadmin created"
```

Open **`https://pbx.example.com`** and log in with `BOOTSTRAP_ADMIN_EMAIL` /
`BOOTSTRAP_ADMIN_PASSWORD`. If login fails:

```bash
docker compose exec -T api node dist/scripts/create-admin.js admin@pbx.example.com 'StrongPass!'
```

---

## 5. First configuration (in the console)

1. **Trunks → Connect Twilio** (Account SID + Auth Token) to auto-import numbers,
   or add a generic SIP trunk.
2. **Extensions → New** — provisions into Asterisk live via PJSIP realtime.
   Confirm: `docker compose exec -T asterisk asterisk -rx "pjsip show endpoints"`.
3. **AI Agents** — build a receptionist; under **Routing**, point a DID at it,
   an extension, an IVR, or a queue.
4. **Acceptance test:** register a softphone (or use the browser softphone) and
   place a call; point a DID at the AI agent and confirm it answers.

---

## Day-2

```bash
cd /opt/aipbx
docker compose logs -f api asterisk ai-engine     # logs
git pull && docker compose up -d --build          # update
make create-admin EMAIL=.. PASSWORD=..            # add/reset an admin
bash deploy/scripts/backup.sh                      # pg_dump → Spaces
```

Production tuning (resource limits, Asterisk host-networking for NAT):
`docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d`
(see `docker-compose.prod.yml`). Full runbook: `docs/OPERATIONS.md`.

## Troubleshooting

| Symptom | Check |
|---|---|
| Console won't load | `docker compose ps`; `docker compose logs nginx web api` |
| No TLS | `dig +short pbx.<domain>` matches the droplet, port 80 open, then re-run `init-letsencrypt.sh` |
| Extension not in `pjsip show endpoints` | `asterisk -rx "odbc show"` must show DSN connected; confirm `db/asterisk_realtime.sql` applied |
| Can't log in | confirm `BOOTSTRAP_ADMIN_*` were set, or run `make create-admin`; `docker compose logs api` |
| Softphone won't register | 5060/udp + 10000–10200/udp open; `PUBLIC_IP` in `.env` = the droplet/reserved IP |
| AI agent silent | `docker compose logs ai-engine`; confirm `ANTHROPIC_API_KEY` + STT/TTS keys |
