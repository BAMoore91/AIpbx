# Deploying AIpbx to DigitalOcean

Two paths:

- **A — Terraform (recommended):** one `apply` provisions the droplet, a
  reserved IP, the recordings bucket (Spaces), a cloud firewall, DNS records,
  and runs the whole stack with TLS. ~10 minutes.
- **B — Manual droplet:** create a droplet yourself and run the bootstrap
  script. Use this if your DNS/infra lives elsewhere.

Both run the same Docker Compose stack from `docker-compose.yml`.

---

## 0. Prerequisites

- A **DigitalOcean account** and a **domain** you control (you'll expose the PBX
  at `pbx.<your-domain>`).
- **API keys**: `ANTHROPIC_API_KEY` (Claude — the AI brain), and optionally
  `DEEPGRAM_API_KEY` (STT) and `ELEVENLABS_API_KEY` (TTS) for AI voice agents.
- Local tools: `git`, and for path A **`terraform`** (≥ 1.5) plus optionally
  **`doctl`**. For path B just an SSH client.
- An **SSH key** registered in DigitalOcean (Settings → Security → SSH Keys).
  Get its fingerprint: `doctl compute ssh-key list`.
- **Spaces keys**: API → Spaces Keys → *Generate New Key* (used both as the
  Terraform Spaces provider creds and as the app's recordings-bucket creds).
- A **DigitalOcean API token**: API → Tokens → *Generate New Token* (read+write).

Generate the app secrets you'll need:
```bash
openssl rand -hex 32      # postgres_password, redis_password, ari_password
openssl rand -hex 32      # jwt_secret   (use a fresh value)
openssl rand -hex 32      # jwt_refresh_secret (another fresh value)
openssl rand -base64 32   # encryption_key (32-byte base64)
```

---

## Path A — Terraform (recommended)

### 1. Get the code and point it at your repo
```bash
git clone https://github.com/YOUR_ORG/AIpbx.git && cd AIpbx/deploy/terraform
```
The droplet's cloud-init **clones the repo itself**, so set `repo_url`/`repo_branch`
below to a URL the droplet can reach (a public repo, or a private one with a
deploy token baked into the URL).

### 2. Fill in variables
```bash
cp terraform.tfvars.example terraform.tfvars
$EDITOR terraform.tfvars
```
Key values (see `variables.tf` for the full list):

| Variable | What it is |
|---|---|
| `do_token` | DigitalOcean API token |
| `spaces_access_key` / `spaces_secret_key` | Spaces keys (provider + recordings bucket) |
| `region` | e.g. `nyc3` (keep droplet, Spaces, and reserved IP in one region) |
| `droplet_size` | `s-4vcpu-8gb` recommended minimum for production call load |
| `domain` / `subdomain` | DNS root + subdomain → FQDN `pbx.example.com` |
| `acme_email` | contact email for Let's Encrypt |
| `admin_email` / `admin_password` | **your console superadmin — created automatically on first boot** |
| `ssh_key_fingerprint` | from `doctl compute ssh-key list` |
| `allowed_ssh_ips` | lock SSH to your office/VPN CIDR (don't leave `0.0.0.0/0`) |
| `repo_url` / `repo_branch` | where cloud-init clones from |
| `postgres_password`, `redis_password`, `jwt_secret`, `jwt_refresh_secret`, `encryption_key`, `ari_password` | app secrets (generated above) |
| `anthropic_api_key`, `deepgram_api_key`, `elevenlabs_api_key` | AI providers |
| `smtp_*` | optional, for voicemail-to-email |

> **DNS prerequisite:** Terraform creates the A records inside a
> `digitalocean_domain` resource, which requires your domain's **nameservers to
> point at DigitalOcean** (`ns1/ns2/ns3.digitalocean.com`). Set that at your
> registrar first. If you keep DNS elsewhere, remove the `digitalocean_domain`
> / `digitalocean_record` resources from `main.tf` and create an A record for
> `pbx.<domain>` → the reserved IP (from `terraform output`) manually.

### 3. Apply
```bash
terraform init
terraform plan      # review what will be created
terraform apply     # type 'yes'
```
This provisions: reserved IP → droplet (Ubuntu 24.04) → Spaces bucket →
cloud firewall (22, 80, 443, 5060/udp, 5061, 8089, 10000-10200/udp) → DNS →
a DO Project grouping them.

### 4. Wait for cloud-init (~3–5 min after apply returns)
`apply` finishes when the droplet exists; the stack then builds **on the
droplet**. Watch it:
```bash
terraform output                      # droplet_ip, floating_ip, app_url
ssh root@$(terraform output -raw floating_ip)
tail -f /var/log/cloud-init-output.log   # build + TLS progress
cd /opt/aipbx && docker compose ps        # all services 'running'/'healthy'
```
cloud-init installs Docker, writes `/opt/aipbx/.env` (FQDN + your secrets),
runs `docker compose up -d --build`, installs a `systemd` unit so the stack
restarts on reboot, **creates your superadmin** from `admin_email`/`admin_password`,
and issues the Let's Encrypt cert. Extensions/trunks you create later provision
into Asterisk live via PJSIP realtime (no config edits or reloads needed).

### 5. Open the console
Browse to **`https://pbx.<your-domain>`** (also `terraform output app_url`) and
**log in with `admin_email` / `admin_password`** — it works out of the box. Then
do the **Post-deploy** steps below.

---

## Path B — Manual droplet

1. **Create** an Ubuntu 24.04 droplet (≥ 4 vCPU / 8 GB), add your SSH key.
   A **reserved IP** is recommended so the SIP/media address is stable.
2. **DNS:** add an A record `pbx.<domain>` → the droplet's (reserved) IP.
3. **Firewall:** open `22, 80, 443, 5060/udp, 5061/tcp, 8089/tcp,
   10000-10200/udp` (DO cloud firewall or `ufw`).
4. **Bootstrap** (installs Docker, clones, writes `.env`, brings the stack up):
   ```bash
   ssh root@<droplet-ip>
   curl -fsSL https://raw.githubusercontent.com/YOUR_ORG/AIpbx/main/deploy/scripts/bootstrap.sh -o bootstrap.sh
   DOMAIN=pbx.example.com \
   REPO_URL=https://github.com/YOUR_ORG/AIpbx.git \
   POSTGRES_PASSWORD=... REDIS_PASSWORD=... \
   JWT_SECRET=... JWT_REFRESH_SECRET=... ENCRYPTION_KEY=... ARI_PASSWORD=... \
   ANTHROPIC_API_KEY=... DEEPGRAM_API_KEY=... ELEVENLABS_API_KEY=... \
   S3_ACCESS_KEY=... S3_SECRET_KEY=... \
   BOOTSTRAP_ADMIN_EMAIL=admin@pbx.example.com BOOTSTRAP_ADMIN_PASSWORD='StrongPass!' \
   bash bootstrap.sh
   ```
   (Setting `BOOTSTRAP_ADMIN_*` creates a working superadmin on startup. If you
   skip them, create one later with `make create-admin EMAIL=.. PASSWORD=..`.)
5. **TLS:**
   ```bash
   cd /opt/aipbx
   DOMAIN=pbx.example.com EMAIL=ops@example.com bash deploy/scripts/init-letsencrypt.sh
   # test against LE staging first if you like:  STAGING=1 DOMAIN=... EMAIL=... bash ...
   ```

---

## Post-deploy (both paths)

Run from the droplet, in `/opt/aipbx`.

1. **Schema is applied automatically** on a fresh DB (the main schema **and** the
   Asterisk PJSIP realtime schema are mounted into Postgres init). Upgrading an
   **existing** DB? Apply the deltas:
   ```bash
   make migrate                                   # main schema
   make realtime                                  # Asterisk ps_* realtime tables
   docker compose exec -T postgres psql -U aipbx -d aipbx < db/migrations/002_departments_rbac.sql
   ```
2. **Admin login already works** — use the `admin_email`/`admin_password` you set
   (Terraform) or `BOOTSTRAP_ADMIN_*` (manual). The bootstrap creates a platform
   **superadmin**, so multi-tenant management is enabled out of the box. To add
   or reset one later:
   ```bash
   make create-admin EMAIL=admin@pbx.example.com PASSWORD='StrongPass!'
   ```
   *(Optional)* `make seed` adds demo extensions + a demo AI agent if you want
   sample data to explore.
3. **Health check:** `bash deploy/scripts/healthcheck.sh` (or `--json`).
4. **Verify realtime is connected** (so API-created endpoints register):
   ```bash
   docker compose exec -T asterisk asterisk -rx "odbc show"          # DSN 'asterisk' connected
   docker compose exec -T asterisk asterisk -rx "pjsip show endpoints"
   ```
5. **Log in** at `https://pbx.<domain>`, then:
   - **Trunks → Connect Twilio** (or add a SIP trunk) — see `INTEGRATIONS.md`.
   - Create extensions — they provision into Asterisk **live**; register a
     softphone at `pbx.<domain>:5060` (TLS 5061 / WSS 8089) or use the browser
     softphone. Confirm with `pjsip show endpoints` that your new extension appears.
   - Point your DID at an extension/IVR/queue/AI agent under **Routing**.

---

## Ports & networking

| Port | Proto | Purpose |
|---|---|---|
| 80, 443 | TCP | HTTP→HTTPS + console/API (nginx) |
| 5060 | UDP | SIP signaling |
| 5061 | TCP | SIP over TLS |
| 8089 | TCP | WebRTC (WSS) — browser softphone, **not** proxied through nginx (DTLS terminates at Asterisk) |
| 10000–10200 | UDP | RTP media |
| 22 | TCP | SSH (restrict to your CIDR) |

- The **reserved/floating IP** is set as `PUBLIC_IP` in `.env`, so Asterisk
  advertises a stable address for NAT — important for SIP/RTP.
- WebRTC needs 8089 reachable directly; keep it open on the firewall.

## Updating
```bash
ssh root@<ip> && cd /opt/aipbx
git pull
docker compose up -d --build
make migrate    # if the schema changed
```

## Backups
`deploy/scripts/backup.sh` runs `pg_dump` → Spaces with rotation; `restore.sh`
restores. Schedule via cron. Recordings already live in Spaces (durable).

## Troubleshooting

| Symptom | Check |
|---|---|
| Console won't load | `cd /opt/aipbx && docker compose ps` / `docker compose logs nginx web api`; `cat /var/log/cloud-init-output.log` |
| No TLS cert | Rerun `DOMAIN=pbx.<d> EMAIL=<e> bash deploy/scripts/init-letsencrypt.sh`; confirm `pbx.<domain>` resolves to the droplet first (`dig +short pbx.<domain>`) and 80 is open for the ACME challenge |
| `terraform apply` DNS error | Domain nameservers aren't pointed at DigitalOcean (see DNS note in step 2) |
| Softphone won't register | Open 5060/udp + 10000–10200/udp; verify `PUBLIC_IP` in `.env` equals the reserved IP; `docker compose exec asterisk asterisk -rx 'pjsip show endpoints'` |
| API-created extension doesn't appear in `pjsip show endpoints` | Realtime/ODBC not connected: `docker compose exec asterisk asterisk -rx 'odbc show'` should show DSN `asterisk` connected; confirm `db/asterisk_realtime.sql` was applied (`\dt ps_*` in `make db-shell`) and the Asterisk container can reach `postgres` |
| Can't log in | Confirm `BOOTSTRAP_ADMIN_*` (or Terraform `admin_*`) were set; otherwise `make create-admin EMAIL=.. PASSWORD=..`; check `docker compose logs api` for the "superadmin created/updated" line |
| AI agent silent | `docker compose logs ai-engine`; confirm `ANTHROPIC_API_KEY` + STT/TTS keys are set |

See `docs/OPERATIONS.md` for scaling, monitoring, and the full runbook, and
`docs/SECURITY.md` for hardening (fail2ban, SIP allowlists, secret rotation).
