variable "deployment_config" {
  description = "Keyless image-publisher identity. It is absent until the owner approves the exact GitHub Workload Identity principal."
  type = object({
    enable_identity                       = bool
    workload_identity_principal           = string
    verified_provider_attribute_condition = string
  })
  default = {
    enable_identity                       = false
    workload_identity_principal           = ""
    verified_provider_attribute_condition = ""
  }
}

variable "cloud_run_jobs" {
  description = "Independently gated one-off database jobs. Definitions do not execute a job."
  type = object({
    deploy_migration_job              = bool
    deploy_rehearsal_job              = bool
    migration_database_user           = string
    migration_role                    = string
    migration_postgres_secret_version = string
    rehearsal_database_user           = string
    rehearsal_postgres_secret_version = string
    rehearsal_schema                  = string
    rehearsal_snapshot_bucket         = string
    rehearsal_snapshot_object         = string
  })
  default = {
    deploy_migration_job              = false
    deploy_rehearsal_job              = false
    migration_database_user           = ""
    migration_role                    = ""
    migration_postgres_secret_version = ""
    rehearsal_database_user           = ""
    rehearsal_postgres_secret_version = ""
    rehearsal_schema                  = ""
    rehearsal_snapshot_bucket         = ""
    rehearsal_snapshot_object         = ""
  }
}
