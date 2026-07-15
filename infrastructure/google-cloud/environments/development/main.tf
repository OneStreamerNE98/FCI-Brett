# This root deliberately has no provider and no resources. The current
# development data plane remains Sites/Workers/D1/R2, and Brett's reported
# Google Cloud project remains inventory-only until owner review.

locals {
  boundary = {
    application_runtime          = "sites-workers-d1-r2"
    google_project_use           = "workspace-test-connector-only"
    persistent_cloud_sql_allowed = false
    real_client_data_allowed     = false
    additional_users_allowed     = false
    resource_creation_enabled    = false
  }
}

output "development_boundary" {
  value = local.boundary
}
