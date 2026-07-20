output "planning" {
  value = {
    resources_enabled      = module.foundation.resource_creation_enabled
    guardrails_enabled     = module.foundation.guardrails_enabled
    database_profile       = module.foundation.cloud_sql_profile
    availability_type      = module.foundation.cloud_sql_availability_type
    cloud_run_planned      = module.foundation.cloud_run_service_planned
    deployment_identity    = module.foundation.deployment_identity_planned
    deployment_email       = module.foundation.deployment_identity_email
    migration_job_planned  = module.foundation.migration_job_planned
    migration_job_name     = module.foundation.migration_job_name
    rehearsal_job_planned  = module.foundation.rehearsal_job_planned
    rehearsal_job_name     = module.foundation.rehearsal_job_name
    connection_budget      = module.foundation.connection_budget
    optional_features      = module.foundation.optional_features
    core_service_count     = module.foundation.core_service_count
    enabled_service_count  = module.foundation.enabled_service_count
    optional_service_count = module.foundation.optional_service_count
  }
}
