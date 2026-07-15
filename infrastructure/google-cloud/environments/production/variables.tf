variable "enable_core" {
  description = "False by default. True requires explicit production provisioning approval and every owner input."
  type        = bool
  default     = false
}

variable "enable_guardrails" {
  description = "False before initial approval. Must be true with production core and remains a separately protected persistent control."
  type        = bool
  default     = false
}

variable "owner_inputs" {
  description = "Approved non-secret production inputs. Empty defaults deliberately block provisioning."
  type = object({
    approval_reference                      = string
    project_id                              = string
    project_number                          = string
    project_parent                          = string
    billing_account_id                      = string
    region                                  = string
    hostname                                = string
    dns_owner                               = string
    alert_emails                            = set(string)
    rpo_hours                               = number
    rto_hours                               = number
    deployment_approver                     = string
    rollback_owner                          = string
    guardrail_verification_reference        = string
    network_approval_reference              = string
    regional_outage_policy                  = string
    regional_ha_exercise_approval_reference = string
    regional_ha_failover_evidence_reference = string
    maintenance_day_utc                     = number
    maintenance_hour_utc                    = number
  })
  default = {
    approval_reference                      = ""
    project_id                              = ""
    project_number                          = ""
    project_parent                          = ""
    billing_account_id                      = ""
    region                                  = ""
    hostname                                = ""
    dns_owner                               = ""
    alert_emails                            = []
    rpo_hours                               = 0
    rto_hours                               = 0
    deployment_approver                     = ""
    rollback_owner                          = ""
    guardrail_verification_reference        = ""
    network_approval_reference              = ""
    regional_outage_policy                  = ""
    regional_ha_exercise_approval_reference = ""
    regional_ha_failover_evidence_reference = ""
    maintenance_day_utc                     = 0
    maintenance_hour_utc                    = 0
  }
}

variable "network_config" {
  description = "Example-only production ranges; review for collision before an approved plan."
  type = object({
    cloud_run_subnet_cidr               = string
    private_service_range_address       = string
    private_service_range_prefix_length = number
  })
  default = {
    cloud_run_subnet_cidr               = "10.40.0.0/26"
    private_service_range_address       = "10.41.0.0"
    private_service_range_prefix_length = 16
  }
}

variable "cloud_sql_profile" {
  description = "No default. Owner selects standalone or regional_ha after cost, RPO/RTO, and restore review."
  type        = string
  default     = null
}

variable "cloud_sql_config" {
  description = "Shared sizing for an honest standalone-versus-HA comparison."
  type = object({
    tier                           = string
    disk_size_gb                   = number
    disk_autoresize_limit_gb       = number
    backup_location                = string
    backup_start_time_utc          = string
    retained_backups               = number
    transaction_log_retention_days = number
    usable_connection_budget       = number
  })
  default = {
    tier                           = "db-custom-1-3840"
    disk_size_gb                   = 20
    disk_autoresize_limit_gb       = 100
    backup_location                = ""
    backup_start_time_utc          = "06:00"
    retained_backups               = 14
    transaction_log_retention_days = 7
    usable_connection_budget       = 0
  }
}

variable "cloud_run_config" {
  description = "The current fail-closed source image is not approved for production deployment."
  type = object({
    deploy_service           = bool
    image                    = string
    runtime_database_user    = string
    postgres_secret_version  = string
    cpu                      = string
    memory                   = string
    request_concurrency      = number
    min_instances            = number
    max_instances            = number
    runtime_pool_max         = number
    overlapping_revisions    = number
    migration_connections    = number
    rehearsal_connections    = number
    admin_monitoring_reserve = number
  })
  default = {
    deploy_service           = false
    image                    = ""
    runtime_database_user    = ""
    postgres_secret_version  = ""
    cpu                      = "1"
    memory                   = "512Mi"
    request_concurrency      = 40
    min_instances            = 0
    max_instances            = 2
    runtime_pool_max         = 5
    overlapping_revisions    = 2
    migration_connections    = 1
    rehearsal_connections    = 1
    admin_monitoring_reserve = 10
  }
}

variable "budget_amount_usd" {
  description = "No production default. Set to the separately approved estimate-based alert amount; it is not a cap."
  type        = number
  default     = 0
}

variable "optional_features" {
  description = "Optional capabilities create no APIs or resources by default."
  type = object({
    cloud_tasks       = bool
    cloud_scheduler   = bool
    gmail_pubsub      = bool
    calendar_webhooks = bool
    upload_quarantine = bool
    sms               = bool
    pgvector          = bool
  })
  default = {
    cloud_tasks       = false
    cloud_scheduler   = false
    gmail_pubsub      = false
    calendar_webhooks = false
    upload_quarantine = false
    sms               = false
    pgvector          = false
  }
}

variable "optional_feature_approvals" {
  description = "Future activation evidence; empty while all optional capabilities are off."
  type = map(object({
    owner              = string
    approval_reference = string
    monthly_cost_usd   = number
    monitoring_plan    = string
    failure_replay     = string
    disable_rollback   = string
  }))
  default = {}
}

variable "labels" {
  type    = map(string)
  default = {}
}
