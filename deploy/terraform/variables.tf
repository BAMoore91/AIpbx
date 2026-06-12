# ============================================================================
# AIpbx — Terraform variable definitions
# ============================================================================

# ----------------------------------------------------------------------------
# DigitalOcean authentication
# ----------------------------------------------------------------------------
variable "do_token" {
  description = "DigitalOcean personal access token (read+write scopes required)."
  type        = string
  sensitive   = true
}

variable "spaces_access_key" {
  description = "DigitalOcean Spaces access key ID (for Terraform provider + recordings bucket)."
  type        = string
  sensitive   = true
}

variable "spaces_secret_key" {
  description = "DigitalOcean Spaces secret access key."
  type        = string
  sensitive   = true
}

# ----------------------------------------------------------------------------
# Infrastructure sizing
# ----------------------------------------------------------------------------
variable "region" {
  description = "DigitalOcean region slug."
  type        = string
  default     = "nyc3"

  validation {
    condition     = contains(["nyc1", "nyc3", "ams3", "sfo3", "sgp1", "lon1", "fra1", "tor1", "blr1", "syd1"], var.region)
    error_message = "Region must be a valid DigitalOcean region slug."
  }
}

variable "droplet_size" {
  description = "Droplet size slug. s-4vcpu-8gb is recommended minimum for production PBX load."
  type        = string
  default     = "s-4vcpu-8gb"
}

variable "ubuntu_image" {
  description = "Droplet image slug. Ubuntu 24.04 LTS (noble)."
  type        = string
  default     = "ubuntu-24-04-x64"
}

# ----------------------------------------------------------------------------
# Networking / DNS
# ----------------------------------------------------------------------------
variable "domain" {
  description = "Root domain name (e.g. example.com). An A record for 'pbx.<domain>' will be created."
  type        = string
}

variable "subdomain" {
  description = "Subdomain to expose the PBX on. Final FQDN = '<subdomain>.<domain>'."
  type        = string
  default     = "pbx"
}

# ----------------------------------------------------------------------------
# SSH access
# ----------------------------------------------------------------------------
variable "ssh_key_fingerprint" {
  description = "Fingerprint of an SSH key already registered in your DigitalOcean account."
  type        = string
}

variable "allowed_ssh_ips" {
  description = "List of CIDR blocks allowed to SSH into the droplet. Set to your office/VPN IP. Empty list means 0.0.0.0/0 (not recommended)."
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"]
}

# ----------------------------------------------------------------------------
# Application / repo
# ----------------------------------------------------------------------------
variable "project_name" {
  description = "DigitalOcean Project name to group all resources."
  type        = string
  default     = "AIpbx"
}

variable "repo_url" {
  description = "Git repository URL that cloud-init will clone. Use HTTPS or SSH (supply a deploy key via user_data if private)."
  type        = string
  default     = "https://github.com/YOUR_ORG/AIpbx.git"
}

variable "repo_branch" {
  description = "Branch to check out."
  type        = string
  default     = "main"
}

# ----------------------------------------------------------------------------
# Application secrets injected via cloud-init → .env
# These are marked sensitive so Terraform never prints them in plan output.
# ----------------------------------------------------------------------------
variable "postgres_password" {
  description = "PostgreSQL password for the aipbx user."
  type        = string
  sensitive   = true
}

variable "redis_password" {
  description = "Redis AUTH password."
  type        = string
  sensitive   = true
}

variable "jwt_secret" {
  description = "64-character random secret for JWT access tokens."
  type        = string
  sensitive   = true
}

variable "jwt_refresh_secret" {
  description = "64-character random secret for JWT refresh tokens."
  type        = string
  sensitive   = true
}

variable "encryption_key" {
  description = "32-byte base64 key used to encrypt SIP secrets at rest."
  type        = string
  sensitive   = true
}

variable "ari_password" {
  description = "Asterisk ARI password."
  type        = string
  sensitive   = true
}

variable "anthropic_api_key" {
  description = "Anthropic API key for Claude (LLM brain)."
  type        = string
  sensitive   = true
  default     = ""
}

variable "deepgram_api_key" {
  description = "Deepgram API key for STT."
  type        = string
  sensitive   = true
  default     = ""
}

variable "elevenlabs_api_key" {
  description = "ElevenLabs API key for TTS."
  type        = string
  sensitive   = true
  default     = ""
}

variable "smtp_host" {
  description = "SMTP relay host for voicemail-to-email."
  type        = string
  default     = ""
}

variable "smtp_user" {
  description = "SMTP username."
  type        = string
  sensitive   = true
  default     = ""
}

variable "smtp_password" {
  description = "SMTP password."
  type        = string
  sensitive   = true
  default     = ""
}

variable "smtp_from" {
  description = "From address for outbound email."
  type        = string
  default     = ""
}

# ----------------------------------------------------------------------------
# Recordings bucket
# ----------------------------------------------------------------------------
variable "spaces_bucket_name" {
  description = "Name for the DO Spaces bucket that stores call recordings."
  type        = string
  default     = "aipbx-recordings"
}

variable "spaces_region" {
  description = "Region for the DO Spaces bucket (must support Spaces; defaults to nyc3)."
  type        = string
  default     = "nyc3"
}
