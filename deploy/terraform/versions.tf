terraform {
  required_version = ">= 1.7.0"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.40"
    }
  }

  # Recommended: store state in DO Spaces so the team shares it.
  # Uncomment and fill in after running `terraform init` the first time
  # to create the bucket manually (chicken-and-egg).
  #
  # backend "s3" {
  #   endpoint                    = "https://nyc3.digitaloceanspaces.com"
  #   region                      = "us-east-1"   # DO Spaces ignores this but S3 backend requires it
  #   bucket                      = "aipbx-tfstate"
  #   key                         = "aipbx/terraform.tfstate"
  #   skip_credentials_validation = true
  #   skip_metadata_api_check     = true
  #   skip_region_validation      = true
  #   force_path_style            = true
  # }
}

provider "digitalocean" {
  token             = var.do_token
  spaces_access_id  = var.spaces_access_key
  spaces_secret_key = var.spaces_secret_key
}
