output "resource_creation_enabled" {
  description = "Workload core activation. False by default; the separate guardrail output must also be false for an initial zero-resource plan."
  value       = var.enable_core
}

output "guardrails_enabled" {
  description = "Persistent budget/notification controls, protected separately from the ephemeral workload core."
  value       = var.enable_guardrails
}

output "deployment_stage" {
  value = var.deployment_stage
}

output "cloud_sql_profile" {
  description = "Null until the owner explicitly selects a reviewed profile."
  value       = var.cloud_sql_profile
}

output "cloud_sql_availability_type" {
  value = var.cloud_sql_profile == null ? null : (var.cloud_sql_profile == "regional_ha" ? "REGIONAL" : "ZONAL")
}

output "connection_budget" {
  value = {
    runtime_ceiling       = local.runtime_connection_ceiling
    controlled_jobs       = local.controlled_job_connections
    admin_monitor_reserve = var.cloud_run_config.admin_monitoring_reserve
    planned_total         = local.planned_connection_total
    reviewed_usable       = var.cloud_sql_config.usable_connection_budget
    fits                  = local.planned_connection_total <= var.cloud_sql_config.usable_connection_budget
  }
}

output "optional_features" {
  value = local.optional_enabled
}

output "core_service_count" {
  value = var.enable_core ? length(local.core_services) : 0
}

output "enabled_service_count" {
  value = length(local.enabled_services)
}

output "optional_service_count" {
  value = var.enable_core ? length(local.optional_services) : 0
}

output "cloud_run_service_planned" {
  value = var.enable_core && var.cloud_run_config.deploy_service
}

output "secret_contracts" {
  description = "Secret container purposes only. Terraform never manages secret payload versions."
  value       = local.secret_purposes
}

output "cloud_sql_instance_connection_name" {
  value = var.enable_core ? google_sql_database_instance.application[0].connection_name : null
}

output "cloud_run_uri" {
  value = var.enable_core && var.cloud_run_config.deploy_service ? google_cloud_run_v2_service.application[0].uri : null
}
