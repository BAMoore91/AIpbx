###############################################################################
# AIpbx — Terraform Outputs
###############################################################################

output "droplet_ip" {
  description = "Primary IPv4 address of the AIpbx droplet (ephemeral, changes if droplet is replaced)."
  value       = digitalocean_droplet.aipbx.ipv4_address
}

output "floating_ip" {
  description = "Reserved (floating) IP address assigned to the droplet. Use this for DNS."
  value       = digitalocean_reserved_ip.aipbx.ip_address
}

output "spaces_bucket_name" {
  description = "Name of the DigitalOcean Spaces bucket used for call recordings."
  value       = digitalocean_spaces_bucket.recordings.name
}

output "spaces_bucket_endpoint" {
  description = "HTTPS endpoint for the Spaces bucket (use as S3_ENDPOINT in .env)."
  value       = "https://${var.spaces_region}.digitaloceanspaces.com"
}

output "app_url" {
  description = "Public HTTPS URL of the AIpbx web interface."
  value       = "https://${local.fqdn}"
}

output "ssh_command" {
  description = "SSH command to connect to the AIpbx droplet."
  value       = "ssh root@${digitalocean_reserved_ip.aipbx.ip_address}"
}
