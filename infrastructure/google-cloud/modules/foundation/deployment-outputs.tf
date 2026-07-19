output "deployment_identity_planned" {
  description = "Whether the keyless, repository-scoped image-publisher identity is in the approved plan."
  value       = var.enable_core && var.deployment_config.enable_identity
}

output "deployment_identity_email" {
  description = "Null until the deployment identity gate is enabled."
  value       = var.enable_core && var.deployment_config.enable_identity ? google_service_account.deployment[0].email : null
}

output "migration_job_planned" {
  description = "Whether the one-task migration Job definition is in the approved plan. This does not execute the Job."
  value       = local.migration_job_enabled
}

output "migration_job_name" {
  description = "Null until the migration Job definition gate is enabled. A name does not indicate an execution."
  value       = local.migration_job_enabled ? google_cloud_run_v2_job.migration[0].name : null
}

output "rehearsal_job_planned" {
  description = "Whether the staging-only test-data rehearsal Job definition is in the approved plan. This does not execute the Job."
  value       = local.rehearsal_job_enabled
}

output "rehearsal_job_name" {
  description = "Null until the staging rehearsal Job definition gate is enabled. A name does not indicate an execution."
  value       = local.rehearsal_job_enabled ? google_cloud_run_v2_job.rehearsal[0].name : null
}
