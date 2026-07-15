output "planning" {
  value = {
    resources_enabled      = module.foundation.resource_creation_enabled
    guardrails_enabled     = module.foundation.guardrails_enabled
    database_profile       = module.foundation.cloud_sql_profile
    availability_type      = module.foundation.cloud_sql_availability_type
    cloud_run_planned      = module.foundation.cloud_run_service_planned
    connection_budget      = module.foundation.connection_budget
    optional_features      = module.foundation.optional_features
    core_service_count     = module.foundation.core_service_count
    enabled_service_count  = module.foundation.enabled_service_count
    optional_service_count = module.foundation.optional_service_count
  }
}
