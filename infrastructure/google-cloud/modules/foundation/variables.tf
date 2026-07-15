variable "enable_core" {
  description = "Explicit workload bootstrap switch. False is safe before first activation; an activation lock blocks using it as an unreviewed teardown switch after apply."
  type        = bool
  default     = false
}

variable "enable_guardrails" {
  description = "Persistent budget and notification guardrails. Core activation requires true; keep true through the post-teardown billing-verification window."
  type        = bool
  default     = false
}

variable "deployment_stage" {
  description = "The isolated Google Cloud runtime stage. Development remains on Sites and cannot use this module."
  type        = string

  validation {
    condition     = contains(["staging", "production"], var.deployment_stage)
    error_message = "deployment_stage must be staging or production; Sites remains the development runtime."
  }
}

variable "owner_inputs" {
  description = "Non-secret owner decisions. Every field is required before enable_core may be true."
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

  validation {
    condition     = trimspace(var.owner_inputs.region) == "" || can(regex("^[a-z]+(?:-[a-z0-9]+)+[0-9]$", var.owner_inputs.region))
    error_message = "region must be empty while disabled or use a Google Cloud regional name such as us-central1."
  }
}

variable "network_config" {
  description = "Environment-specific, non-overlapping private network ranges."
  type = object({
    cloud_run_subnet_cidr               = string
    private_service_range_address       = string
    private_service_range_prefix_length = number
  })

  validation {
    condition = (
      can(regex("^([0-9]{1,3}\\.){3}[0-9]{1,3}/", var.network_config.cloud_run_subnet_cidr)) &&
      can(cidrhost(var.network_config.cloud_run_subnet_cidr, 1)) &&
      try(tonumber(split("/", var.network_config.cloud_run_subnet_cidr)[1]) <= 26, false) &&
      try(cidrhost(var.network_config.cloud_run_subnet_cidr, 0) == split("/", var.network_config.cloud_run_subnet_cidr)[0], false)
    )
    error_message = "cloud_run_subnet_cidr must be an aligned IPv4 CIDR with a /26 or larger address range."
  }

  validation {
    condition = (
      var.network_config.private_service_range_prefix_length >= 16 &&
      var.network_config.private_service_range_prefix_length <= 24 &&
      can(regex("^([0-9]{1,3}\\.){3}[0-9]{1,3}$", var.network_config.private_service_range_address)) &&
      can(cidrhost("${var.network_config.private_service_range_address}/${var.network_config.private_service_range_prefix_length}", 1)) &&
      try(cidrhost("${var.network_config.private_service_range_address}/${var.network_config.private_service_range_prefix_length}", 0) == var.network_config.private_service_range_address, false)
    )
    error_message = "The Private Service Access address must be an aligned /16-/24 network. Non-overlap is enforced by the separate reviewed network-approval reference."
  }
}

variable "cloud_sql_profile" {
  description = "Owner-selected profile. Leave null until standalone and regional HA cost/recovery evidence is reviewed."
  type        = string
  default     = null

  validation {
    condition     = var.cloud_sql_profile == null || contains(["standalone", "regional_ha"], var.cloud_sql_profile)
    error_message = "cloud_sql_profile must be null, standalone, or regional_ha."
  }
}

variable "cloud_sql_config" {
  description = "Shared sizing so the standalone and HA comparison differs only by availability."
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

  validation {
    condition     = var.cloud_sql_config.disk_size_gb >= 10 && var.cloud_sql_config.disk_autoresize_limit_gb >= var.cloud_sql_config.disk_size_gb
    error_message = "Cloud SQL storage must start at 10 GiB or more and the autoresize limit must not be smaller."
  }

  validation {
    condition     = can(regex("^(?:[01][0-9]|2[0-3]):[0-5][0-9]$", var.cloud_sql_config.backup_start_time_utc))
    error_message = "backup_start_time_utc must use 24-hour HH:MM UTC format."
  }

  validation {
    condition = (
      var.cloud_sql_config.retained_backups >= 7 &&
      var.cloud_sql_config.transaction_log_retention_days >= 1 &&
      var.cloud_sql_config.transaction_log_retention_days <= 7 &&
      var.cloud_sql_config.usable_connection_budget >= 0 &&
      (
        trimspace(var.cloud_sql_config.backup_location) == "" ||
        can(regex("^(?:us|eu|asia|[a-z]+(?:-[a-z0-9]+)+[0-9])$", var.cloud_sql_config.backup_location))
      )
    )
    error_message = "Retain at least seven backups, keep one to seven days of PostgreSQL transaction logs, use a recognized multi-region/regional backup-location shape, and never use a negative connection budget."
  }
}

variable "cloud_run_config" {
  description = "Bounded service and connection settings. Service deployment has its own switch because the current image is fail-closed."
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

  validation {
    condition     = var.cloud_run_config.min_instances == 0 && var.cloud_run_config.max_instances >= 1 && var.cloud_run_config.max_instances <= 2
    error_message = "Cloud Run must start at zero minimum instances and no more than two maximum instances."
  }

  validation {
    condition = (
      var.cloud_run_config.request_concurrency >= 1 &&
      var.cloud_run_config.request_concurrency <= 80 &&
      var.cloud_run_config.runtime_pool_max >= 1 &&
      var.cloud_run_config.runtime_pool_max <= 10 &&
      var.cloud_run_config.overlapping_revisions == 2 &&
      var.cloud_run_config.migration_connections == 1 &&
      var.cloud_run_config.rehearsal_connections == 1 &&
      var.cloud_run_config.admin_monitoring_reserve >= 10
    )
    error_message = "Concurrency must be 1-80, runtime pools 1-10, revision overlap fixed at two, migration/rehearsal fixed at one connection, and the administrator/monitoring reserve at least ten."
  }
}

variable "budget_amount_usd" {
  description = "Monthly alert threshold in USD. This is an alert, never a hard cap."
  type        = number

  validation {
    condition     = var.budget_amount_usd >= 0
    error_message = "budget_amount_usd cannot be negative."
  }
}

variable "optional_features" {
  description = "Feature-gated capabilities. Every value defaults false in each environment root."
  type = object({
    cloud_tasks       = bool
    cloud_scheduler   = bool
    gmail_pubsub      = bool
    calendar_webhooks = bool
    upload_quarantine = bool
    sms               = bool
    pgvector          = bool
  })
}

variable "optional_feature_approvals" {
  description = "Approval records required before an optional feature flag may be enabled."
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
  description = "Additional non-secret Google resource labels."
  type        = map(string)
  default     = {}
}
