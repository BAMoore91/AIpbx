# AIpbx Terraform — DigitalOcean Infrastructure

Provisions a production-ready DigitalOcean environment for AIpbx:
- One droplet (Ubuntu, configurable size) with Docker Compose installed via cloud-init
- One reserved (floating) IP attached to the droplet
- One Spaces bucket for call recordings (private, versioned)
- DNS domain + A records for the PBX subdomain and a wildcard
- Cloud firewall with SIP, RTP, HTTPS, and SSH rules
- A DigitalOcean Project grouping all resources

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| [Terraform](https://developer.hashicorp.com/terraform/install) | >= 1.6 | `brew install terraform` |
| [doctl](https://docs.digitalocean.com/reference/doctl/how-to/install/) | latest | `brew install doctl` |
| SSH key pair | — | `ssh-keygen -t ed25519` |

Your SSH public key must be added to DigitalOcean before running Terraform:

```bash
doctl compute ssh-key import aipbx-key --public-key-file ~/.ssh/id_ed25519.pub
doctl compute ssh-key list   # note the Fingerprint column
```

You will also need:
- A DigitalOcean API token with read/write scope
- DigitalOcean Spaces access key + secret key (create in API → Spaces Keys)
- API keys for Anthropic, Deepgram, ElevenLabs
- SMTP credentials (for email notifications / password reset)

---

## Step-by-step Deployment

### 1. Copy and populate the variables file

```bash
cd deploy/terraform
cp terraform.tfvars.example terraform.tfvars
$EDITOR terraform.tfvars
```

Fill in every value. Sensitive values (passwords, API keys) are marked
`sensitive = true` in `variables.tf` and will not appear in plan output.

### 2. Initialise Terraform

```bash
terraform init
```

This downloads the `digitalocean/digitalocean` provider (~10 MB).

### 3. Review the plan

```bash
terraform plan -out=tfplan
```

Expect ~15 resources. Read through the plan before applying.

### 4. Apply

```bash
terraform apply tfplan
```

Apply takes 3–5 minutes. cloud-init on the droplet continues running for
another 5–10 minutes (Docker installation, repo clone, image pulls).

Monitor progress:

```bash
# SSH in once the droplet is up (usually ~60 s after apply)
ssh root@$(terraform output -raw floating_ip)

# Tail the cloud-init log
tail -f /var/log/cloud-init-output.log
```

### 5. Issue TLS certificates

Once DNS has propagated (verify with `dig +short pbx.example.com`) and
nginx is running, issue Let's Encrypt certificates:

```bash
ssh root@$(terraform output -raw floating_ip)
cd /opt/aipbx
export DOMAIN=pbx.example.com
export EMAIL=admin@example.com
bash deploy/scripts/init-letsencrypt.sh
```

The nginx configuration contains the placeholder `pbx.example.com` which
`bootstrap.sh` (called by cloud-init) automatically replaces with your
actual domain during first boot.

### 6. Verify the deployment

```bash
bash deploy/scripts/healthcheck.sh
```

Open `https://pbx.example.com` in your browser.

---

## TLS / Let's Encrypt

- Certificates are stored in the `certbot_certs` Docker volume (mounted at
  `/etc/letsencrypt` inside nginx).
- The ACME HTTP-01 challenge is served from the `certbot_www` volume via
  `location /.well-known/acme-challenge/` in nginx.
- Auto-renewal cron is printed by `init-letsencrypt.sh`. Add it to crontab:

  ```
  0 3 * * * cd /opt/aipbx && bash deploy/scripts/init-letsencrypt.sh >> /var/log/certbot-renew.log 2>&1
  ```

---

## Destroying the Infrastructure

```bash
terraform destroy
```

> **Warning:** `digitalocean_domain.aipbx` has `prevent_destroy = true`.
> Remove that lifecycle block from `main.tf` if you want Terraform to delete
> the domain, or delete it manually in the DigitalOcean control panel first.

The Spaces bucket has `force_destroy = false`. Delete all objects first or
change the flag before destroying.

---

## Remote State Backend (recommended for teams)

By default Terraform stores state locally in `terraform.tfstate`. For team
use, configure a backend. DigitalOcean Spaces is S3-compatible:

```hcl
# In versions.tf, add:
terraform {
  backend "s3" {
    endpoint                    = "https://nyc3.digitaloceanspaces.com"
    region                      = "us-east-1"   # required by AWS provider, ignored by DO
    bucket                      = "my-tfstate-bucket"
    key                         = "aipbx/terraform.tfstate"
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    force_path_style            = true
  }
}
```

Store `spaces_access_key` and `spaces_secret_key` in environment variables
(`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) — not in `terraform.tfvars`.

---

## Further Reading

- [Operations Runbook](../../docs/OPERATIONS.md) — day-2 operations
- [Architecture Overview](../../docs/ARCHITECTURE.md) — system design
- [Security Reference](../../docs/SECURITY.md) — hardening guide
