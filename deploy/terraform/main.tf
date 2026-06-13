###############################################################################
# AIpbx — DigitalOcean Infrastructure
# Terraform main configuration
###############################################################################

locals {
  fqdn = "${var.subdomain}.${var.domain}"

  # Cloud-init template variables — must match cloud-init.yaml templatefile vars exactly
  cloud_init_vars = {
    domain             = var.domain
    fqdn               = local.fqdn
    acme_email         = var.acme_email
    public_ip          = digitalocean_reserved_ip.aipbx.ip_address
    postgres_password  = var.postgres_password
    redis_password     = var.redis_password
    jwt_secret         = var.jwt_secret
    jwt_refresh_secret = var.jwt_refresh_secret
    encryption_key     = var.encryption_key
    ari_password       = var.ari_password
    anthropic_api_key  = var.anthropic_api_key
    deepgram_api_key   = var.deepgram_api_key
    elevenlabs_api_key = var.elevenlabs_api_key
    spaces_region      = var.spaces_region
    spaces_bucket      = var.spaces_bucket_name
    spaces_access_key  = var.spaces_access_key
    spaces_secret_key  = var.spaces_secret_key
    smtp_host          = var.smtp_host
    smtp_user          = var.smtp_user
    smtp_password      = var.smtp_password
    smtp_from          = var.smtp_from
    repo_branch        = var.repo_branch
    repo_url           = var.repo_url
  }
}

###############################################################################
# Reserved (Floating) IP
# Created first so its address is known when building the droplet user-data.
###############################################################################
resource "digitalocean_reserved_ip" "aipbx" {
  region = var.region
}

###############################################################################
# Droplet
###############################################################################
resource "digitalocean_droplet" "aipbx" {
  name      = var.project_name
  image     = var.ubuntu_image
  size      = var.droplet_size
  region    = var.region
  ssh_keys  = [var.ssh_key_fingerprint]
  user_data = templatefile("${path.module}/cloud-init.yaml", local.cloud_init_vars)

  # Ensure the reserved IP exists before we reference its address in cloud-init
  depends_on = [digitalocean_reserved_ip.aipbx]

  lifecycle {
    ignore_changes = [
      # Prevent replacement when user_data rendered value changes due to
      # downstream resource changes; the bootstrap script is idempotent.
      user_data,
    ]
  }
}

###############################################################################
# Reserved IP Assignment
###############################################################################
resource "digitalocean_reserved_ip_assignment" "aipbx" {
  ip_address = digitalocean_reserved_ip.aipbx.ip_address
  droplet_id = digitalocean_droplet.aipbx.id
}

###############################################################################
# Spaces (S3-compatible) Bucket — call recordings
###############################################################################
resource "digitalocean_spaces_bucket" "recordings" {
  name          = var.spaces_bucket_name
  region        = var.spaces_region
  acl           = "private"
  force_destroy = false

  versioning {
    enabled = true
  }

  lifecycle_rule {
    enabled = true
    id      = "delete-old-temp-uploads"

    expiration {
      # Remove incomplete multipart uploads after 7 days
      days = 7
    }
  }
}

###############################################################################
# Spaces CORS — allow the web UI to download recordings via pre-signed URLs
###############################################################################
resource "digitalocean_spaces_bucket_cors_configuration" "recordings" {
  bucket = digitalocean_spaces_bucket.recordings.name
  region = var.spaces_region

  cors_rule {
    allowed_headers = ["Authorization", "Content-Type", "Range"]
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = ["https://${var.domain}", "https://${local.fqdn}"]
    expose_headers  = ["Content-Length", "Content-Range", "ETag"]
    max_age_seconds = 3600
  }
}

###############################################################################
# Cloud Firewall
###############################################################################
resource "digitalocean_firewall" "aipbx" {
  name        = "${var.project_name}-fw"
  droplet_ids = [digitalocean_droplet.aipbx.id]

  # ----- Inbound -----

  # SSH — restricted to operator IPs
  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = var.allowed_ssh_ips
  }

  # HTTP — for Let's Encrypt ACME challenges + redirect to HTTPS
  inbound_rule {
    protocol         = "tcp"
    port_range       = "80"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  # HTTPS — web UI + REST API + WebSocket (WSS)
  inbound_rule {
    protocol         = "tcp"
    port_range       = "443"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  # SIP over UDP — PSTN trunks and softphone registrations
  inbound_rule {
    protocol         = "udp"
    port_range       = "5060"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  # SIP over TLS (SIPS) — encrypted trunk and softphone transport
  inbound_rule {
    protocol         = "tcp"
    port_range       = "5061"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  # Asterisk WebRTC WSS — browsers connect here for WebRTC SIP
  inbound_rule {
    protocol         = "tcp"
    port_range       = "8089"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  # RTP media — audio streams for all calls
  inbound_rule {
    protocol         = "udp"
    port_range       = "10000-10200"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  # ----- Outbound — unrestricted -----

  outbound_rule {
    protocol              = "tcp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "udp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "icmp"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
}

###############################################################################
# DNS Domain
###############################################################################
resource "digitalocean_domain" "aipbx" {
  name = var.domain

  lifecycle {
    prevent_destroy = true
  }
}

# pbx.example.com → reserved IP
resource "digitalocean_record" "pbx_a" {
  domain = digitalocean_domain.aipbx.name
  type   = "A"
  name   = var.subdomain
  value  = digitalocean_reserved_ip.aipbx.ip_address
  ttl    = 300
}

# *.example.com → reserved IP (catch-all for future subdomains on this droplet)
resource "digitalocean_record" "wildcard_a" {
  domain = digitalocean_domain.aipbx.name
  type   = "A"
  name   = "*"
  value  = digitalocean_reserved_ip.aipbx.ip_address
  ttl    = 300
}

###############################################################################
# DigitalOcean Project — groups all resources for billing / visibility
###############################################################################
resource "digitalocean_project" "aipbx" {
  name        = var.project_name
  description = "AIpbx — AI-native cloud PBX"
  purpose     = "Web Application"
  environment = "Production"

  resources = [
    digitalocean_droplet.aipbx.urn,
    digitalocean_spaces_bucket.recordings.urn,
    digitalocean_reserved_ip.aipbx.urn,
  ]
}

###############################################################################
# ALTERNATIVE: Managed PostgreSQL (uncomment to use instead of the containerised
# postgres service; also remove the postgres service from docker-compose.yml and
# update DATABASE_URL in .env / cloud-init accordingly).
###############################################################################
# resource "digitalocean_database_cluster" "postgres" {
#   name       = "${var.project_name}-pg"
#   engine     = "pg"
#   version    = "16"
#   size       = "db-s-1vcpu-1gb"
#   region     = var.region
#   node_count = 1
#
#   maintenance_window {
#     day  = "sunday"
#     hour = "02:00:00"
#   }
# }
#
# resource "digitalocean_database_firewall" "postgres" {
#   cluster_id = digitalocean_database_cluster.postgres.id
#   rule {
#     type  = "droplet"
#     value = digitalocean_droplet.aipbx.id
#   }
# }

###############################################################################
# ALTERNATIVE: Managed Redis (uncomment alongside managed postgres above)
###############################################################################
# resource "digitalocean_database_cluster" "redis" {
#   name       = "${var.project_name}-redis"
#   engine     = "redis"
#   version    = "7"
#   size       = "db-s-1vcpu-1gb"
#   region     = var.region
#   node_count = 1
# }
#
# resource "digitalocean_database_firewall" "redis" {
#   cluster_id = digitalocean_database_cluster.redis.id
#   rule {
#     type  = "droplet"
#     value = digitalocean_droplet.aipbx.id
#   }
# }
