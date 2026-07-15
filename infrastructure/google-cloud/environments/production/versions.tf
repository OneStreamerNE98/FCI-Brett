terraform {
  required_version = "= 1.15.8"

  backend "gcs" {}

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "= 7.40.0"
    }
  }
}

provider "google" {
  project = trimspace(var.owner_inputs.project_id) == "" ? null : var.owner_inputs.project_id
  region  = trimspace(var.owner_inputs.region) == "" ? null : var.owner_inputs.region
}
