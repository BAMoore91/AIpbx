# AIpbx — Operations Runbook

## Initial Deployment

### Path A: Terraform (Recommended)

1. **Prerequisites**
   ```bash
   # Install Terraform >= 1.7.0
   brew install terraform   # macOS
   # or: https://developer.hashicorp.com/terraform/install

   # Install doctl (DigitalOcean CLI)
   brew install doctl
   doctl auth init

   # Get your SSH key fingerprint
   doctl compute ssh-key list
   ```

2. **Configure Terraform**
   ```bash
   cd deploy/terraform
   cp terraform.tfvars.example terraform.tfvars
   # Edit terraform.tfvars with real values (see README.md in that directory)
   ```

3. **Deploy infrastructure**
   ```bash
   terraform init
   terraform plan   # review what will be created
   terraform apply  # provision DigitalOcean resources
   ```
   
   This creates: Droplet, Reserved IP, Spaces bucket, Cloud Firewall, DNS records, Project.
   Cloud-init runs automatically on first boot: installs Docker, clones repo, writes `.env`, starts stack, issues TLS cert.

4. **Monitor first-boot**
   ```bash
   # SSH to the droplet (IP shown in terraform output)
   ssh root@$(terraform output -raw floating_ip)
   
   # Tail cloud-init log
   tail -f /var/log/cloud-init-output.log
   
   # Once complete, check the stack
   cd /opt/aipbx && docker compose ps
   ```

### Path B: Manual Bootstrap

For existing servers or custom setups:

```bash
# Export all required env vars (see .env.example for full list)
export DOMAIN=pbx.example.com
export REPO_URL=https://github.com/YOUR_ORG/AIpbx.git
export POSTGRES_PASSWORD=$(openssl rand -hex 32)
export REDIS_PASSWORD=$(openssl rand -hex 32)
export JWT_SECRET=$(openssl rand -hex 32)
export JWT_REFRESH_SECRET=$(openssl rand -hex 32)
export ENCRYPTION_KEY=$(openssl rand -base64 32)
export ARI_PASSWORD=$(openssl rand -hex 16)
export ANTHROPIC_API_KEY=sk-ant-...
export DEEPGRAM_API_KEY=...
export ELEVENLABS_API_KEY=...
export S3_BUCKET=aipbx-recordings
export S3_ENDPOINT=https://nyc3.digitaloceanspaces.com
export S3_ACCESS_KEY=...
export S3_SECRET_KEY=...

# Run bootstrap (as root)
bash <(curl -fsSL https://raw.githubusercontent.com/YOUR_ORG/AIpbx/main/deploy/scripts/bootstrap.sh)

# Or from a cloned repo:
sudo bash deploy/scripts/bootstrap.sh
```

Bootstrap handles: Docker CE install, repo clone, .env write, nginx domain patching, docker compose up, systemd service.

---

## TLS Certificate Management

### Initial Issuance

Run after the stack is up and DNS is pointing to the server:

```bash
DOMAIN=pbx.example.com \
EMAIL=ops@example.com \
bash /opt/aipbx/deploy/scripts/init-letsencrypt.sh
```

Use `STAGING=1` first to test without hitting Let's Encrypt rate limits:

```bash
STAGING=1 DOMAIN=pbx.example.com EMAIL=ops@example.com \
bash /opt/aipbx/deploy/scripts/init-letsencrypt.sh
```

Then re-run without `STAGING=1` for the production certificate.

### Automatic Renewal

Add to `/etc/cron.d/aipbx-certbot`:

```cron
# Attempt renewal twice daily. certbot only renews when < 30 days remain.
0 0,12 * * * root docker run --rm \
    -v aipbx_certbot_certs:/etc/letsencrypt \
    -v aipbx_certbot_www:/var/www/certbot \
    certbot/certbot renew --quiet \
    && cd /opt/aipbx && docker compose exec nginx nginx -s reload \
    >> /var/log/aipbx-certbot.log 2>&1
```

### Certificate Rotation (Manual)

```bash
# Force renewal regardless of expiry
docker run --rm \
    -v aipbx_certbot_certs:/etc/letsencrypt \
    -v aipbx_certbot_www:/var/www/certbot \
    certbot/certbot renew --force-renewal

# Reload nginx and Asterisk
cd /opt/aipbx
docker compose exec nginx nginx -s reload
docker compose exec asterisk asterisk -rx "module reload http"
```

### Asterisk WSS Certificate

The `init-letsencrypt.sh` script copies the cert to the `aipbx_asterisk_keys` Docker volume automatically. Verify:

```bash
docker run --rm -v aipbx_asterisk_keys:/keys alpine ls -la /keys
# Should show fullchain.pem and privkey.pem
```

---

## Backups and Restore

### Schedule Backups

Add to `/etc/cron.d/aipbx-backup`:

```cron
# Daily database backup at 02:30 UTC
30 2 * * * root cd /opt/aipbx && bash deploy/scripts/backup.sh >> /var/log/aipbx-backup.log 2>&1
```

The script reads `.env` for credentials automatically when run from `DEPLOY_DIR`.

### Manual Backup

```bash
cd /opt/aipbx
source .env
bash deploy/scripts/backup.sh
```

### Restore

```bash
# Restore the most recent backup
BACKUP_FILE=latest bash /opt/aipbx/deploy/scripts/restore.sh

# Restore a specific backup
BACKUP_FILE=db-backups/aipbx_20240115T023000Z.sql.gz \
bash /opt/aipbx/deploy/scripts/restore.sh
```

The restore script will prompt for confirmation before dropping the database.

### Recording Backup

Call recordings are written directly to DO Spaces by the api/ai-engine services. No additional backup is needed if Spaces is configured — DO Spaces has 99.99% durability. For extra protection, enable Spaces Object Versioning (already configured in Terraform via `versioning { enabled = true }`).

---

## Updating AIpbx

```bash
cd /opt/aipbx

# Pull latest code
git pull origin main

# Rebuild and restart services
docker compose up -d --build --remove-orphans

# Apply any new DB schema migrations
# (AIpbx schema is append-only; re-running schema.sql is safe with IF NOT EXISTS)
docker compose exec -T postgres psql -U aipbx -d aipbx < db/schema.sql

# Check logs
docker compose logs --tail=50 -f
```

---

## Logs

### View Service Logs

```bash
cd /opt/aipbx

# All services
docker compose logs -f

# Specific service
docker compose logs -f api
docker compose logs -f ai-engine
docker compose logs -f asterisk
docker compose logs -f nginx

# Last 100 lines
docker compose logs --tail=100 api
```

### Log Files on Host

| File                           | Content                          |
|--------------------------------|----------------------------------|
| `/var/log/cloud-init-output.log` | First-boot provisioning output |
| `/var/log/aipbx-backup.log`    | Backup cron output               |
| `/var/log/aipbx-certbot.log`   | Certificate renewal output       |
| `/var/log/ufw.log`             | Firewall block events            |
| `/var/log/auth.log`            | SSH authentication attempts      |
| `/var/log/fail2ban.log`        | fail2ban ban/unban events        |

### Log Rotation

Docker's default `json-file` driver rotates at 10 MB / 3 files (configured in `docker-compose.yml`). For centralized logging, consider Loki + Grafana:

```yaml
# Add to docker-compose.yml services
x-logging: &loki-logging
  driver: loki
  options:
    loki-url: "http://loki:3100/loki/api/v1/push"
    loki-external-labels: "job=aipbx,host=${HOSTNAME}"
```

---

## Monitoring

### Health Check

```bash
# Run the health check script
bash /opt/aipbx/deploy/scripts/healthcheck.sh

# JSON output (for Nagios/Prometheus scraping)
bash /opt/aipbx/deploy/scripts/healthcheck.sh --json
```

### API Health Endpoint

```bash
curl -sf https://DOMAIN/api/healthz
```

Expected: `{"status":"ok","version":"...","uptime":12345,"db":"ok","redis":"ok","asterisk":"ok"}`

### Prometheus Metrics

Each service exposes metrics if the Prometheus exporter is configured:

- API: `GET /api/metrics` (prometheus text format)
- Asterisk: install `prometheus_exporter.so` module
- PostgreSQL: deploy `postgres_exporter` sidecar
- Redis: deploy `redis_exporter` sidecar

### Suggested Alerting Rules

| Alert                  | Condition                                      | Severity |
|------------------------|------------------------------------------------|----------|
| Service down           | healthcheck.sh returns fail for any service    | Critical |
| Cert expiry < 14 days  | Let's Encrypt cert near expiry                 | Warning  |
| Disk > 80%             | `df -h /` shows > 80% used                    | Warning  |
| DB connections > 80%   | `pg_stat_activity` count near `max_connections`| Warning  |
| SIP registration loss  | No `extension.registered` events for 5 min    | Warning  |
| High call failure rate | disposition = 'failed' > 5% of calls          | Warning  |

---

## Scaling Asterisk

### Vertical Scaling

The fastest path for most deployments:

1. Update `terraform.tfvars`: `droplet_size = "s-8vcpu-16gb"`
2. `terraform apply` (causes a droplet replace — schedule maintenance window)
3. Stack restarts automatically via systemd service.

### Expanding RTP Port Range

Each concurrent call leg needs 2 UDP ports (one for RTP, one for RTCP). The default 10000–10200 allows 100 port pairs (~50 concurrent calls with bridging overhead).

To support 200 concurrent calls:

```bash
# In .env
RTP_START=10000
RTP_END=20000

# Update Cloud Firewall in Terraform (variables.tf)
# inbound_rule udp 10000-20000

# Update UFW on host
ufw delete allow 10000:10200/udp
ufw allow 10000:20000/udp comment 'RTP media'

# Restart Asterisk
cd /opt/aipbx && docker compose restart asterisk
```

### Horizontal Scaling (Advanced)

For >300 concurrent calls or multi-region deployments:

1. Deploy RTPEngine (rtpengine) as a media proxy between SIP trunks and Asterisk. This decouples RTP from the Asterisk process and allows Asterisk to be stateless.
2. Deploy multiple Asterisk nodes behind a SIP proxy (Kamailio or OpenSIPS).
3. Use a shared PostgreSQL (DigitalOcean managed DB) and Redis (DigitalOcean managed Redis) for session state.
4. The `aipbx_certbot_certs` and `aipbx_asterisk_keys` volumes must be replicated or replaced with a shared filesystem (NFS or DigitalOcean Volumes).

---

## Troubleshooting SIP / NAT

### Symptom: One-way audio (caller hears nothing or agent hears nothing)

**Cause**: Asterisk is advertising the Docker container's internal IP in SDP instead of the public IP.

**Fix**: Ensure `PUBLIC_IP` is set correctly in `.env`:
```bash
PUBLIC_IP=$(curl -sf https://checkip.amazonaws.com)
# Add to .env, then:
docker compose restart asterisk
```

In Asterisk's `pjsip.conf`, ensure:
```ini
[transport-udp]
type=transport
protocol=udp
bind=0.0.0.0
external_media_address=PUBLIC_IP
external_signaling_address=PUBLIC_IP
```

### Symptom: Calls fail with "no codec in common"

**Cause**: The SIP trunk or softphone is advertising codecs not in Asterisk's allow list.

**Fix**: Check the `codecs` field on the extension or trunk and ensure it includes at least one codec the carrier supports (usually `ulaw`/`alaw`).

### Symptom: Registration fails from softphone

**Check**:
```bash
# See registered endpoints
docker compose exec asterisk asterisk -rx "pjsip show endpoints"
docker compose exec asterisk asterisk -rx "pjsip show registrations"

# Check for errors
docker compose logs --tail=100 asterisk | grep ERROR
```

### Symptom: SIP INVITE rejected with 403

**Cause**: IP-based auth failing, or the trunk is sending to the wrong domain.

**Fix**: Check the trunk configuration and compare against what the carrier expects. Verify `from_domain` on the trunk matches the carrier's expected host.

---

## Troubleshooting WebRTC

### Symptom: Browser cannot connect to wss://DOMAIN:8089/ws

**Checks**:
1. Port 8089 is open in Cloud Firewall and UFW.
2. Asterisk TLS is configured and certs are valid:
   ```bash
   openssl s_client -connect DOMAIN:8089 -servername DOMAIN
   # Should show a valid Let's Encrypt certificate
   ```
3. Asterisk HTTP service is running:
   ```bash
   docker compose exec asterisk asterisk -rx "http show status"
   ```

### Symptom: WebRTC call connects but no audio (ICE failure)

**Cause**: ICE negotiation failed — Asterisk cannot reach the browser or vice versa.

**Fix**:
1. Enable STUN in Asterisk's `rtp.conf`:
   ```ini
   [general]
   stunaddr=stun.l.google.com:19302
   ```
2. For callers behind symmetric NAT, deploy a TURN server (coturn) and configure it in the web SPA's SIP UA:
   ```javascript
   iceServers: [
     { urls: 'stun:stun.l.google.com:19302' },
     { urls: 'turn:TURN_SERVER:3478', username: '...', credential: '...' }
   ]
   ```

### Symptom: DTLS handshake fails

**Cause**: The TLS certificate in Asterisk's keys volume does not match the domain the browser is connecting to.

**Fix**:
```bash
# Verify the cert CN/SAN
docker run --rm -v aipbx_asterisk_keys:/keys alpine \
    openssl x509 -in /keys/fullchain.pem -noout -subject -ext subjectAltName
```

Re-run `init-letsencrypt.sh` to refresh the cert in the Asterisk keys volume.

---

## Security Hardening

### fail2ban

fail2ban is installed and started by cloud-init. Verify it is running:

```bash
systemctl status fail2ban
fail2ban-client status
```

Add an Asterisk SIP jail (if not already present):

```ini
# /etc/fail2ban/jail.d/aipbx-sip.conf
[asterisk]
enabled  = true
port     = 5060,5061
protocol = udp
filter   = asterisk
action   = iptables-allports[name=ASTERISK, protocol=all]
logpath  = /opt/aipbx/asterisk-logs/messages
maxretry = 5
findtime = 21600
bantime  = 86400
```

### Rotating Secrets

When rotating secrets (JWT keys, passwords):

1. Update `.env` on the server.
2. Update `terraform.tfvars` (so the next `terraform apply` doesn't revert).
3. Restart services that use the secret:
   ```bash
   cd /opt/aipbx
   docker compose restart api ai-engine asterisk
   ```
4. Invalidate all active sessions (rotating `JWT_SECRET` invalidates all access tokens immediately — users will need to log in again).

### Checking for Unauthorized Access

```bash
# Recent SSH logins
last -n 20

# fail2ban bans
fail2ban-client status asterisk
fail2ban-client status sshd

# UFW recent blocks
grep "UFW BLOCK" /var/log/ufw.log | tail -20

# Asterisk security events
docker compose exec asterisk asterisk -rx "security show blacklist"

# Failed API auth attempts
docker compose logs --tail=500 api | grep "401\|403\|Unauthorized"
```
