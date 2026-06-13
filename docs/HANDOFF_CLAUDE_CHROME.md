# Handoff: Deploy AIpbx to DigitalOcean (for Claude for Chrome)

You are **Claude for Chrome**. Your job: stand up a working AIpbx instance on
DigitalOcean **entirely through the browser** — the DigitalOcean web console plus
a droplet **user-data (cloud-init)** script that does the build at first boot.
You do not have a local terminal or SSH; everything happens in the DO web UI and,
if needed, the droplet's in-browser **Console**.

> **Repo:** `https://github.com/BAMoore91/AIpbx` · branch
> `claude/3cx-ai-asterisk-core-p9fnd6`. If the repo is **private**, you must use a
> clone URL with a token: `https://<GITHUB_TOKEN>@github.com/BAMoore91/AIpbx.git`.

---

## 0. Before you touch anything — collect from the human

Ask the human for these and **wait** for answers. Do not invent or skip. Confirm
they accept the spend (~$48/mo for the droplet + a few $ for Spaces).

1. **DigitalOcean** — they must be logged in (you'll drive their account), with
   billing enabled.
2. **Domain name** you'll serve at `pbx.<domain>` (e.g. `pbx.acme.com`). Confirm
   whether its DNS is managed at DigitalOcean or elsewhere.
3. **Region** (e.g. `nyc3`, `lon1`, `fra1`). Use the same region for everything.
4. **AI provider keys** (optional but needed for AI voice agents):
   `ANTHROPIC_API_KEY` (Claude), `DEEPGRAM_API_KEY` (STT), `ELEVENLABS_API_KEY` (TTS).
5. **Repo access** — is the repo public? If private, get a GitHub token.
6. **Admin login** they want for the console: an email + a strong password.
7. **A root password** for the droplet (so you can use the browser Console later).

### Secrets you generate yourself

Produce strong random values (≥32 chars, mixed) for each and **record them in
your working notes** so you can paste consistently:

- `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `ARI_PASSWORD`
- `JWT_SECRET`, `JWT_REFRESH_SECRET` (64+ chars each)
- `ENCRYPTION_KEY` — a 32-byte base64 string (44 chars ending in `=`), e.g.
  generate 32 random bytes and base64-encode them.

Keep every secret only in this session's notes; never paste them into a page
other than the DO forms described below.

---

## 1. Create a Spaces bucket + keys (recordings storage)

1. Go to **https://cloud.digitalocean.com/spaces** → **Create a Spaces Bucket**.
2. Region = your chosen region; name = `aipbx-recordings` (or note the name you
   pick). Create it.
3. Go to **https://cloud.digitalocean.com/account/api/spaces** (API → **Spaces Keys**)
   → **Generate New Key**. Name it `aipbx`. **Copy the access key and secret now**
   (the secret is shown once). Record both as `S3_ACCESS_KEY` / `S3_SECRET_KEY`.
4. Note the endpoint: `https://<region>.digitaloceanspaces.com`.

---

## 2. (Recommended) Reserve a floating IP

A stable IP matters for SIP/RTP. Go to **Networking → Reserved IPs**
(`https://cloud.digitalocean.com/networking/reserved_ips`). You can create one now
and assign it after the droplet exists, **or** skip and use the droplet's own IP.
If you use a reserved IP, that is the IP you put in DNS and in `PUBLIC_IP`.

---

## 3. Create the Droplet with user-data

Go to **https://cloud.digitalocean.com/droplets/new**.

- **Image:** Ubuntu **24.04 (LTS) x64**.
- **Size:** Shared CPU → **Premium**, **4 vCPU / 8 GB** (`s-4vcpu-8gb`) minimum.
- **Region:** your chosen region.
- **Authentication:** pick **Password** and set the root password the human gave
  you (or add an SSH key if they provided one — the user-data also sets the root
  password so the in-browser Console works regardless).
- **Advanced options → Add Initialization scripts (user data):** paste the
  **User-data script** from §6 below, with every `__PLACEHOLDER__` replaced by the
  real value. **Double-check there are no remaining `__...__` placeholders.**
- **Hostname:** `aipbx`.
- Click **Create Droplet**. Note the droplet's **public IPv4** once it appears
  (or assign your reserved IP from §2 now and use that IP).

---

## 4. Create a Cloud Firewall

Go to **Networking → Firewalls → Create Firewall**
(`https://cloud.digitalocean.com/networking/firewalls/new`). Add **inbound** rules,
then attach it to the `aipbx` droplet:

| Type | Protocol | Port range | Sources |
|---|---|---|---|
| SSH | TCP | 22 | your IP only (recommended) |
| HTTP | TCP | 80 | All IPv4 + IPv6 |
| HTTPS | TCP | 443 | All IPv4 + IPv6 |
| Custom | UDP | 5060 | All |
| Custom | TCP | 5061 | All |
| Custom | TCP | 8089 | All |
| Custom | UDP | 10000-10200 | All |

Leave outbound rules at default (allow all). Attach the firewall to the droplet.

---

## 5. Point DNS at the droplet

The droplet/user-data will request a TLS certificate **once `pbx.<domain>`
resolves to the droplet's IP**, so do this right after creating the droplet.

- **If DNS is at DigitalOcean:** Networking → **Domains** → add the domain (if not
  present) → add an **A record**: hostname `pbx`, will direct to the droplet (or
  reserved IP), TTL 3600.
- **If DNS is elsewhere:** the human must add an A record `pbx.<domain>` → the
  droplet IP at their registrar. Tell them the exact IP and wait for confirmation.

Verify resolution (browser): open `https://dnschecker.org/#A/pbx.<domain>` and
confirm it shows the droplet IP before expecting TLS to succeed.

---

## 6. User-data script (paste into §3)

Replace every `__PLACEHOLDER__`. For a **private** repo, put a token in
`REPO_URL` (`https://<TOKEN>@github.com/...`).

```bash
#!/bin/bash
set -eux
exec > /var/log/aipbx-init.log 2>&1

# Console fallback login (so the human/you can use the DO droplet Console).
echo "root:__ROOT_PASSWORD__" | chpasswd

# ---- values you collected ----
export DOMAIN="pbx.__DOMAIN__"
export ACME_EMAIL="__ADMIN_OR_OPS_EMAIL__"
export REPO_URL="https://github.com/BAMoore91/AIpbx.git"   # private: https://<TOKEN>@github.com/BAMoore91/AIpbx.git
export REPO_BRANCH="claude/3cx-ai-asterisk-core-p9fnd6"

export POSTGRES_PASSWORD="__POSTGRES_PASSWORD__"
export REDIS_PASSWORD="__REDIS_PASSWORD__"
export JWT_SECRET="__JWT_SECRET__"
export JWT_REFRESH_SECRET="__JWT_REFRESH_SECRET__"
export ENCRYPTION_KEY="__ENCRYPTION_KEY_BASE64__"
export ARI_PASSWORD="__ARI_PASSWORD__"

export ANTHROPIC_API_KEY="__ANTHROPIC_API_KEY__"
export DEEPGRAM_API_KEY="__DEEPGRAM_API_KEY__"
export ELEVENLABS_API_KEY="__ELEVENLABS_API_KEY__"

export S3_ENDPOINT="https://__REGION__.digitaloceanspaces.com"
export S3_REGION="__REGION__"
export S3_BUCKET="aipbx-recordings"
export S3_ACCESS_KEY="__SPACES_ACCESS_KEY__"
export S3_SECRET_KEY="__SPACES_SECRET_KEY__"

export BOOTSTRAP_ADMIN_EMAIL="__ADMIN_EMAIL__"
export BOOTSTRAP_ADMIN_PASSWORD="__ADMIN_PASSWORD__"

export PUBLIC_IP="$(curl -fsSL https://ifconfig.me || hostname -I | awk '{print $1}')"
# If you assigned a RESERVED IP, hardcode it instead:
# export PUBLIC_IP="__RESERVED_IP__"

# ---- build & run ----
apt-get update -y && apt-get install -y git curl
git clone --branch "$REPO_BRANCH" "$REPO_URL" /opt/aipbx || (cd /opt/aipbx && git pull --ff-only)
bash /opt/aipbx/deploy/scripts/bootstrap.sh    # installs Docker, writes .env, compose up, systemd unit

# ---- TLS once DNS points here (retries ~20 min) ----
MYIP="$(curl -fsSL https://ifconfig.me)"
for i in $(seq 1 40); do
  RES="$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || true)"
  if [ "$RES" = "$MYIP" ] || [ "$RES" = "${PUBLIC_IP}" ]; then
    DOMAIN="$DOMAIN" EMAIL="$ACME_EMAIL" bash /opt/aipbx/deploy/scripts/init-letsencrypt.sh && break
  fi
  sleep 30
done
echo "AIpbx init finished"
```

What this does: installs Docker, clones the repo, runs `bootstrap.sh` (writes
`/opt/aipbx/.env` with all secrets incl. the admin bootstrap, then
`docker compose up -d --build`), and issues a Let's Encrypt cert as soon as DNS
resolves. The API auto-creates your superadmin on startup from
`BOOTSTRAP_ADMIN_*`. PostgreSQL applies both the app schema and the Asterisk
PJSIP realtime schema on first init.

---

## 7. Wait, then verify (browser-only)

First boot build takes **~5–10 minutes**. Then:

1. Open **`https://pbx.<domain>`**. Expect the AIpbx login page over valid HTTPS.
   - If you see a cert warning, TLS hasn't issued yet — DNS may still be
     propagating. Re-check §5 and wait; the script retries for ~20 min.
2. **Log in** with `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`. You should
   land on the dashboard. ✅ This is the primary success signal.
3. Open the **droplet Console** (Droplet page → top-right **Console** /
   "Launch Droplet Console"), log in as `root` with `__ROOT_PASSWORD__`, and run:
   ```bash
   cd /opt/aipbx
   docker compose ps                                   # all services Up
   docker compose exec -T asterisk asterisk -rx "odbc show"        # DSN 'asterisk' connected
   tail -n 40 /var/log/aipbx-init.log                  # init log / any errors
   ```

If login fails, in the Console run:
```bash
cd /opt/aipbx && docker compose logs api | tail -50    # look for "superadmin created/updated"
docker compose exec -T api node dist/scripts/create-admin.js __ADMIN_EMAIL__ '__ADMIN_PASSWORD__'
```

---

## 8. First configuration (in the console UI, after login)

1. **Trunks → Connect Twilio** — paste a Twilio Account SID + Auth Token to
   auto-import numbers, or add a generic SIP trunk.
2. **Extensions → New** — create an extension (it provisions into Asterisk live
   via PJSIP realtime). Confirm in the droplet Console:
   `docker compose exec -T asterisk asterisk -rx "pjsip show endpoints"`.
3. **AI Agents** — build an AI receptionist; under **Routing**, point a DID at it,
   an extension, an IVR, or a queue.
4. **The real acceptance test:** register a softphone (or use the built-in browser
   softphone) and place a call; point a DID at the AI agent and confirm it answers.

---

## 9. Stop / ask-the-human triggers

- Any **payment/billing** prompt, or creating resources beyond one droplet +
  bucket + firewall + reserved IP → confirm with the human first.
- A **destructive** action (destroy/rebuild droplet, delete data) → confirm first.
- Repo is **private** and you don't have a token → ask for one (or ask them to
  make the build branch public).
- DNS is **not** at DigitalOcean → you cannot create the A record; give the human
  the exact record to add and wait.
- TLS still failing after ~20 min with DNS confirmed correct → report the tail of
  `/var/log/aipbx-init.log` and `docker compose logs nginx` and ask how to proceed.

---

## 10. Quick reference

- **App URL:** `https://pbx.<domain>`
- **Repo on droplet:** `/opt/aipbx` · **env file:** `/opt/aipbx/.env` (root-only)
- **Logs:** `docker compose logs -f api asterisk ai-engine` · init: `/var/log/aipbx-init.log`
- **Re-issue TLS:** `DOMAIN=pbx.<domain> EMAIL=<e> bash /opt/aipbx/deploy/scripts/init-letsencrypt.sh`
- **Create/reset admin:** `make create-admin EMAIL=.. PASSWORD=..` (in `/opt/aipbx`)
- Full ops runbook: `docs/OPERATIONS.md`; deploy details: `docs/DEPLOY_DIGITALOCEAN.md`.
