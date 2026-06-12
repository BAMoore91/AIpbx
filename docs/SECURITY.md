# AIpbx — Security Reference

## Secrets Management

### Secret Inventory

| Secret                | Where Stored                        | Rotation Impact                                      |
|-----------------------|-------------------------------------|------------------------------------------------------|
| `POSTGRES_PASSWORD`   | `.env`, Terraform tfvars            | Restart postgres + all services using DATABASE_URL   |
| `REDIS_PASSWORD`      | `.env`, Terraform tfvars            | Restart redis + api + ai-engine                      |
| `JWT_SECRET`          | `.env`, Terraform tfvars            | Invalidates all active access tokens immediately     |
| `JWT_REFRESH_SECRET`  | `.env`, Terraform tfvars            | Invalidates all refresh tokens (forces re-login)     |
| `ENCRYPTION_KEY`      | `.env`, Terraform tfvars            | Requires re-encrypting all SIP passwords in DB       |
| `ARI_PASSWORD`        | `.env`, Terraform tfvars            | Restart api + asterisk                               |
| `ANTHROPIC_API_KEY`   | `.env`, Terraform tfvars            | Restart ai-engine                                    |
| `DEEPGRAM_API_KEY`    | `.env`, Terraform tfvars            | Restart ai-engine                                    |
| `ELEVENLABS_API_KEY`  | `.env`, Terraform tfvars            | Restart ai-engine                                    |
| `S3_ACCESS_KEY`       | `.env`, Terraform tfvars            | Restart api + ai-engine                              |
| `SMTP_PASSWORD`       | `.env`, Terraform tfvars            | Restart api                                          |
| SIP extension passwords| PostgreSQL (encrypted at rest)     | Update via API — re-encryption is automatic          |
| SIP trunk secrets     | PostgreSQL (encrypted at rest)      | Update via API — re-encryption is automatic          |

### Rules

1. **Never commit `.env` or `terraform.tfvars`** — both are in `.gitignore`.
2. **Terraform sensitive variables** are marked `sensitive = true` — they are redacted from `plan`/`apply` output and state file display.
3. **The Terraform state file** (`terraform.tfstate`) contains secret values in plaintext. Store state in a backend (DO Spaces with encryption or Terraform Cloud) and restrict access:
   ```bash
   # If using local state, restrict permissions
   chmod 600 terraform.tfstate
   ```
4. **Generate strong secrets** before deploy:
   ```bash
   openssl rand -hex 32        # for passwords
   openssl rand -base64 32     # for ENCRYPTION_KEY
   ```
5. **Rotation procedure**:
   - Update `.env` on the server: `nano /opt/aipbx/.env`
   - Update `terraform.tfvars` to keep infrastructure in sync.
   - Restart affected services: `docker compose restart <service>`
   - For JWT rotation: all users are logged out automatically.

---

## SIP Hardening

### fail2ban

fail2ban monitors Asterisk logs and bans IPs that repeatedly fail SIP authentication.

```ini
# /etc/fail2ban/jail.d/aipbx-asterisk.conf
[asterisk]
enabled  = true
port     = 5060,5061
protocol = udp
filter   = asterisk
action   = ufw[name=ASTERISK, port="5060:5061", protocol=udp]
logpath  = %(asterisk_log)s
maxretry = 5
findtime = 600      # 10 minutes
bantime  = 86400    # 24 hours
```

Default SIP ban after 5 failures in 10 minutes → 24-hour ban.

### Strong SIP Passwords

All extension SIP passwords must meet:
- Minimum 16 characters
- Mix of uppercase, lowercase, digits, symbols
- No dictionary words

The API enforces password complexity on creation and update.

### IP Allowlists for Trunks

When your PSTN carrier has fixed IPs (recommended), set IP-based auth on trunks:

```json
{
  "authType": "ip",
  "host": "pstn.twilio.com"
}
```

This means no password is required from the carrier's registered IPs — reducing exposure to brute-force on those endpoints.

### Disable Unused Asterisk Modules

Edit `asterisk/modules.conf` to load only required modules:

```ini
[modules]
autoload=no

; Required
load => res_pjsip.so
load => res_pjsip_session.so
load => res_pjsip_transport_websocket.so
load => res_ari.so
load => res_stasis.so
load => app_audiosocket.so
load => codec_opus.so
load => format_wav.so

; Disable dangerous legacy modules
; noload => chan_sip.so        ; use chan_pjsip only
; noload => res_adsi.so
; noload => app_meetme.so      ; use ConfBridge
```

### Asterisk AMI

The AMI (Asterisk Manager Interface) is disabled by default. If you need it, restrict to `127.0.0.1` and use a strong password. Do not expose AMI publicly.

---

## Firewall

### Defense-in-Depth Architecture

Two firewall layers:

```
Internet → DigitalOcean Cloud Firewall → UFW on host → Docker network
```

1. **DigitalOcean Cloud Firewall** (managed, stateful): First line of defense. Drops packets before they reach the OS. Managed by Terraform.
2. **UFW** (host-level): Backup layer. Catches any traffic that bypasses the cloud firewall. Configured by cloud-init and bootstrap.sh.
3. **Docker network** (`aipbx` bridge): Internal services (postgres, redis, ARI) are not accessible from outside the container network.

### Open Ports and Justification

| Port / Proto     | Source       | Justification                                                    |
|------------------|--------------|------------------------------------------------------------------|
| 22/tcp           | Operator IPs | SSH management. Restrict to office/VPN CIDR in `terraform.tfvars`: `allowed_ssh_ips` |
| 80/tcp           | 0.0.0.0/0    | ACME HTTP challenge + redirect to HTTPS                         |
| 443/tcp          | 0.0.0.0/0    | HTTPS — web UI, API, WebSocket                                   |
| 5060/udp         | 0.0.0.0/0    | SIP signaling — carriers and softphones register here            |
| 5061/tcp         | 0.0.0.0/0    | SIP over TLS — encrypted SIP for carriers and softphones         |
| 8089/tcp         | 0.0.0.0/0    | WebRTC WSS — browsers connect here for web phone functionality   |
| 10000–10200/udp  | 0.0.0.0/0    | RTP media — audio packets for all calls                         |

**Ports NOT open** (internal only):
- 8088 (ARI) — accessed only by the `api` container on the Docker network
- 9092 (AudioSocket) — accessed only by the `asterisk` container on the Docker network
- 8080 (ai-engine HTTP) — accessed only by `api` on the Docker network
- 3000 (API) — proxied by nginx on Docker network; not exposed externally
- 5432 (PostgreSQL) — Docker network only
- 6379 (Redis) — Docker network only

### Restricting SIP Access (Optional)

If you only receive calls from known carrier IPs, restrict 5060/5061 to those IPs in the Cloud Firewall:

```hcl
# In deploy/terraform/main.tf
inbound_rule {
  protocol         = "udp"
  port_range       = "5060"
  source_addresses = [
    "54.172.60.0/23",   # Twilio US East
    "54.244.51.0/24",   # Twilio US West
    # ... carrier IP ranges
  ]
}
```

---

## TLS Configuration

### Cipher Suites

nginx is configured with Mozilla's "Intermediate" compatibility profile:

```nginx
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256;
ssl_prefer_server_ciphers off;
```

TLSv1.0 and TLSv1.1 are disabled.

### HSTS

nginx sends Strict-Transport-Security with a 2-year `max-age` and `includeSubDomains; preload`. Once activated, browsers will refuse HTTP connections to the domain.

### Certificate Transparency

Let's Encrypt certificates are automatically logged to CT logs. Monitor for unauthorized certificate issuance via [crt.sh](https://crt.sh/?q=DOMAIN).

### Asterisk WebRTC TLS

Port 8089 uses the same Let's Encrypt certificate as nginx (copied to `aipbx_asterisk_keys` volume by `init-letsencrypt.sh`). The certificate is refreshed on each renewal. Asterisk supports TLSv1.2 and TLSv1.3.

---

## RBAC (Role-Based Access Control)

### Roles

| Role          | Description                                                                 |
|---------------|-----------------------------------------------------------------------------|
| `superadmin`  | Platform-level admin. Can manage all tenants, create tenants.               |
| `admin`       | Tenant admin. Full access to all tenant resources.                          |
| `supervisor`  | Can view all calls, recordings, transcripts. Manage queues and agents.      |
| `agent`       | Own extension management, call history, voicemail.                          |
| `user`        | Web phone access only. Cannot modify configuration.                         |

### Permission Matrix

| Resource              | superadmin | admin | supervisor | agent | user  |
|-----------------------|-----------|-------|------------|-------|-------|
| Manage tenants        | R/W       | —     | —          | —     | —     |
| Manage users          | R/W       | R/W   | R          | —     | —     |
| Manage extensions     | R/W       | R/W   | R          | R(own)| —     |
| Manage trunks         | R/W       | R/W   | —          | —     | —     |
| Manage DID numbers    | R/W       | R/W   | R          | —     | —     |
| View all calls        | R         | R     | R          | R(own)| —     |
| View recordings       | R         | R     | R          | R(own)| —     |
| View transcripts      | R         | R     | R          | R(own)| —     |
| Manage AI agents      | R/W       | R/W   | R          | —     | —     |
| Originate calls       | R/W       | R/W   | R/W        | R/W   | R/W   |
| Manage webhooks       | R/W       | R/W   | —          | —     | —     |
| View audit logs       | R         | R     | R          | —     | —     |

### API Enforcement

The API middleware checks the JWT claim `role` against the required role for each endpoint. Tenant isolation is enforced separately — even a `superadmin` token from Tenant A cannot access Tenant B's resources via the standard API (separate tenant management API).

---

## Encryption at Rest

### SIP Passwords

Extension SIP passwords and trunk secrets are encrypted before storage using AES-256-GCM with a key derived from `ENCRYPTION_KEY`. The plaintext is never written to the database. The API decrypts the password when generating Asterisk PJSIP configuration.

**Key rotation**: Rotating `ENCRYPTION_KEY` requires re-encrypting all stored passwords:

```bash
# Built-in migration command (run after updating ENCRYPTION_KEY in .env)
cd /opt/aipbx && docker compose exec api node dist/cli/rotate-encryption-key.js \
    --old-key "OLD_ENCRYPTION_KEY" \
    --new-key "NEW_ENCRYPTION_KEY"
```

### Database

The PostgreSQL container stores data in the `pgdata` Docker volume on the droplet's local disk. DigitalOcean droplet volumes are encrypted at rest using AES-256 (hardware-level). No additional application-level database encryption is applied.

For extra security, use DigitalOcean Managed PostgreSQL which provides encryption at rest, automated backups, and optional private networking.

### DO Spaces (Recordings)

DigitalOcean Spaces encrypts all stored objects at rest using AES-256. The bucket is configured as `private` — objects are not publicly accessible. Pre-signed URLs (valid for 1 hour) are used to serve recordings to authenticated users.

Server-Side Encryption (SSE) is enabled by default on all Spaces objects.

---

## JWT Security

### Token Structure

- **Access token**: Short-lived (15 minutes by default, set by `JWT_ACCESS_TTL`). Signed with `JWT_SECRET`. Contains: `userId`, `tenantId`, `role`, `exp`, `iat`.
- **Refresh token**: Long-lived (30 days, `JWT_REFRESH_TTL`). Signed with `JWT_REFRESH_SECRET`. Stored in `refresh_tokens` table (hashed — only the hash is stored, not the plaintext token).

### Token Rotation

On every `/api/auth/refresh` call:
1. The provided refresh token is validated against its stored hash.
2. If valid: the old token is marked `revoked_at = now()` and a new pair is issued.
3. If the same token is used twice (replay attack): both tokens are revoked and the user must log in again.

### Revocation

- **Access tokens** cannot be revoked individually (stateless JWT). For immediate revocation, rotate `JWT_SECRET` (logs out all users).
- **Refresh tokens** are revoked by setting `revoked_at` in the `refresh_tokens` table.
- All refresh tokens for a user can be revoked: `DELETE FROM refresh_tokens WHERE user_id = '...'`.
- On logout, the current refresh token is revoked.

---

## Audit Logging

All significant actions are logged to the `audit_logs` table:

| Action              | Entity       | When                                    |
|---------------------|--------------|-----------------------------------------|
| `user.login`        | users        | Successful login                        |
| `user.login.failed` | users        | Failed login attempt                    |
| `user.created`      | users        | New user created                        |
| `extension.created` | extensions   | New extension provisioned               |
| `extension.deleted` | extensions   | Extension removed                       |
| `trunk.created`     | trunks       | New SIP trunk configured                |
| `did.routed`        | did_numbers  | DID routing changed                     |
| `agent.created`     | ai_agents    | New AI agent created                    |
| `call.originated`   | calls        | Outbound call manually originated       |
| `recording.accessed`| recordings   | Recording download URL generated        |
| `webhook.delivered` | webhooks     | Webhook event successfully delivered    |

Audit logs are append-only — no UPDATE or DELETE is performed on this table. Retention policy: logs are kept indefinitely by default. For compliance, configure a pg_dump → Spaces archival job with a longer retention than the database backup.

---

## Multi-Tenancy Isolation

### Database-Level Isolation

Every query includes `WHERE tenant_id = :currentTenantId` enforced by the API ORM layer. This is implemented as a required parameter in all repository methods — it is not possible to call a repository method without specifying a tenant ID.

```typescript
// Example: all queries require tenantId
const calls = await callRepo.findAll({ tenantId: req.user.tenantId });
```

### SIP Domain Isolation

Each tenant has a `domain` field in the `tenants` table (e.g., `tenant1.pbx.example.com`). Asterisk uses PJSIP's domain matching to route SIP requests to the correct tenant's endpoints. Endpoints from different tenants cannot call each other unless explicitly bridged.

### Data Leakage Prevention

- No cross-tenant API queries are possible via the standard API.
- Recordings and transcripts are scoped to the tenant at the database level.
- Pre-signed URLs for recordings include the tenant ID in the S3 key path.

---

## Vulnerability Management

### Update Cadence

- **OS packages**: Unattended upgrades are enabled by cloud-init for security patches.
- **Docker images**: Rebuild weekly (`docker compose pull && docker compose up -d --build`).
- **Dependencies**: Run `npm audit` and `pip install --upgrade` in a CI/CD pipeline.

### Scanning

```bash
# Scan Docker images for known CVEs
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
    aquasec/trivy image aipbx-api:latest

# Scan Node.js dependencies
cd services/api && npm audit

# Scan Python dependencies
cd services/ai-engine && pip-audit
```

### Reporting Security Issues

If you discover a security vulnerability in AIpbx, please report it privately to the maintainers rather than opening a public issue. Include a description of the vulnerability, reproduction steps, and potential impact.
