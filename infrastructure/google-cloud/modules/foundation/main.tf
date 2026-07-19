locals {
  stage_code = var.deployment_stage == "production" ? "prd" : "stg"
  name       = "fci-ops-${local.stage_code}"

  guardrail_services = toset([
    "billingbudgets.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "monitoring.googleapis.com",
    "serviceusage.googleapis.com",
  ])

  workload_services = toset([
    "artifactregistry.googleapis.com",
    "compute.googleapis.com",
    "iam.googleapis.com",
    "logging.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "servicenetworking.googleapis.com",
    "sqladmin.googleapis.com",
  ])

  deployment_services = toset(concat(
    var.deployment_config.enable_identity ? [
      "iamcredentials.googleapis.com",
      "sts.googleapis.com",
    ] : [],
    var.cloud_run_jobs.deploy_rehearsal_job ? ["storage.googleapis.com"] : [],
  ))

  core_services = setunion(
    local.guardrail_services,
    local.workload_services,
    local.deployment_services,
  )
  enabled_services = (
    var.enable_core ? local.core_services :
    var.enable_guardrails ? local.guardrail_services : toset([])
  )

  optional_enabled = {
    cloud_tasks       = var.optional_features.cloud_tasks
    cloud_scheduler   = var.optional_features.cloud_scheduler
    gmail_pubsub      = var.optional_features.gmail_pubsub
    calendar_webhooks = var.optional_features.calendar_webhooks
    upload_quarantine = var.optional_features.upload_quarantine
    sms               = var.optional_features.sms
    pgvector          = var.optional_features.pgvector
  }

  optional_service_map = {
    cloud_tasks       = ["cloudtasks.googleapis.com"]
    cloud_scheduler   = ["cloudscheduler.googleapis.com"]
    gmail_pubsub      = ["pubsub.googleapis.com"]
    calendar_webhooks = []
    upload_quarantine = ["storage.googleapis.com", "eventarc.googleapis.com"]
    sms               = []
    pgvector          = []
  }

  optional_services = toset(flatten([
    for feature, services in local.optional_service_map : local.optional_enabled[feature] ? services : []
  ]))

  runtime_secret_purposes = {
    postgres-runtime-password      = "Cloud SQL runtime password"
    session-secret                 = "Employee application session signing and encryption"
    employee-oidc-client-secret    = "Employee Workspace OIDC login client secret"
    workspace-oauth-client-secret  = "Company Workspace data-connector OAuth secret"
    workspace-token-encryption-key = "Workspace refresh-token encryption key"
  }

  migration_secret_purposes = {
    postgres-migration-password = "Cloud SQL migration password"
  }

  rehearsal_secret_purposes = var.deployment_stage == "staging" ? {
    postgres-rehearsal-password = "Cloud SQL staging rehearsal password"
  } : {}

  secret_purposes = merge(
    local.runtime_secret_purposes,
    local.migration_secret_purposes,
    local.rehearsal_secret_purposes,
  )

  common_labels = merge(var.labels, {
    application = "fci-operations"
    environment = local.stage_code
    foundation  = "minimum-core"
    managed_by  = "terraform"
  })

  approval_values = [
    var.owner_inputs.approval_reference,
    var.owner_inputs.project_id,
    var.owner_inputs.project_number,
    var.owner_inputs.project_parent,
    var.owner_inputs.billing_account_id,
    var.owner_inputs.region,
    var.owner_inputs.hostname,
    var.owner_inputs.dns_owner,
    var.owner_inputs.deployment_approver,
    var.owner_inputs.rollback_owner,
  ]

  approval_values_complete = alltrue([
    for value in local.approval_values :
    trimspace(value) != "" && !can(regex("(?i)(tbd|pending|placeholder|replace[-_ ]?me|example)", value))
  ])

  optional_approvals_complete = alltrue([
    for feature, enabled in local.optional_enabled :
    !enabled || try(
      var.optional_feature_approvals[feature].monthly_cost_usd >= 0 &&
      alltrue([
        for value in [
          var.optional_feature_approvals[feature].owner,
          var.optional_feature_approvals[feature].approval_reference,
          var.optional_feature_approvals[feature].monitoring_plan,
          var.optional_feature_approvals[feature].failure_replay,
          var.optional_feature_approvals[feature].disable_rollback,
        ] : trimspace(value) != "" && !can(regex("(?i)(tbd|pending|placeholder|replace[-_ ]?me|example)", value))
      ]),
      false,
    )
  ])

  runtime_connection_ceiling = (
    var.cloud_run_config.runtime_pool_max *
    var.cloud_run_config.max_instances *
    var.cloud_run_config.overlapping_revisions
  )
  controlled_job_connections = (
    var.cloud_run_config.migration_connections +
    (var.deployment_stage == "staging" ? var.cloud_run_config.rehearsal_connections : 0)
  )
  planned_connection_total = (
    local.runtime_connection_ceiling +
    local.controlled_job_connections +
    var.cloud_run_config.admin_monitoring_reserve
  )

  sql_alerts = {
    cpu = {
      display_name = "Cloud SQL CPU above 80%"
      metric       = "cloudsql.googleapis.com/database/cpu/utilization"
      threshold    = 0.80
    }
    disk = {
      display_name = "Cloud SQL disk above 80%"
      metric       = "cloudsql.googleapis.com/database/disk/utilization"
      threshold    = 0.80
    }
    connections = {
      display_name = "Cloud SQL connections above 80% of reviewed usable budget"
      metric       = "cloudsql.googleapis.com/database/postgresql/num_backends"
      threshold    = floor(var.cloud_sql_config.usable_connection_budget * 0.80)
    }
  }
}

data "google_project" "target" {
  count = var.enable_core || var.enable_guardrails ? 1 : 0

  project_id = var.owner_inputs.project_id
}

locals {
  actual_project_parent = var.enable_core || var.enable_guardrails ? (
    trimspace(data.google_project.target[0].folder_id) != "" ?
    "folders/${data.google_project.target[0].folder_id}" :
    "organizations/${data.google_project.target[0].org_id}"
  ) : null
}

resource "terraform_data" "approval_gate" {
  count = var.enable_core || var.enable_guardrails ? 1 : 0

  input = {
    approval_reference = var.owner_inputs.approval_reference
    deployment_stage   = var.deployment_stage
    database_profile   = var.cloud_sql_profile
  }

  lifecycle {
    precondition {
      condition     = local.approval_values_complete
      error_message = "Environment activation is blocked until every named non-secret owner input is approved and no placeholder remains."
    }

    precondition {
      condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.owner_inputs.project_id)) && can(regex("^[0-9]+$", var.owner_inputs.project_number))
      error_message = "An approved immutable Google project ID and numeric project number are required."
    }

    precondition {
      condition     = data.google_project.target[0].number == var.owner_inputs.project_number
      error_message = "The approved project number does not match the project resolved from project_id."
    }

    precondition {
      condition     = can(regex("^(?:organizations|folders)/[0-9]+$", var.owner_inputs.project_parent)) && local.actual_project_parent == var.owner_inputs.project_parent
      error_message = "The target project must resolve to the exact approved organizations/ID or folders/ID parent."
    }

    precondition {
      condition = (
        can(regex("^[0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{6}$", upper(var.owner_inputs.billing_account_id))) &&
        upper(trimprefix(data.google_project.target[0].billing_account, "billingAccounts/")) == upper(var.owner_inputs.billing_account_id)
      )
      error_message = "billing_account_id must use the non-secret XXXXXX-XXXXXX-XXXXXX format and match the target project's billing account."
    }

    precondition {
      condition     = length(var.owner_inputs.alert_emails) > 0 && alltrue([for email in var.owner_inputs.alert_emails : can(regex("^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$", email))])
      error_message = "At least one valid owner-approved alert email is required."
    }

    precondition {
      condition     = !var.enable_core || (var.owner_inputs.rpo_hours >= 0 && var.owner_inputs.rto_hours > 0)
      error_message = "Approved non-negative RPO and positive RTO values are required."
    }

    precondition {
      condition     = var.budget_amount_usd > 0
      error_message = "An owner-approved positive monthly budget-alert amount is required; budgets alert but do not cap spend."
    }

    precondition {
      condition     = !var.enable_core || (var.owner_inputs.maintenance_day_utc >= 1 && var.owner_inputs.maintenance_day_utc <= 7 && var.owner_inputs.maintenance_hour_utc >= 0 && var.owner_inputs.maintenance_hour_utc <= 23)
      error_message = "The approved maintenance window must use Cloud SQL day 1-7 and UTC hour 0-23."
    }

    precondition {
      condition     = !var.enable_core || var.cloud_sql_profile != null
      error_message = "No Cloud SQL profile is selected by default. The owner must explicitly choose standalone or regional_ha after cost and recovery review."
    }

    precondition {
      condition = !var.enable_core || var.cloud_sql_profile != "regional_ha" || (
        var.deployment_stage == "staging" ? (
          trimspace(var.owner_inputs.regional_ha_exercise_approval_reference) != "" &&
          !can(regex("(?i)(tbd|pending|placeholder|replace[-_ ]?me|example)", var.owner_inputs.regional_ha_exercise_approval_reference))
          ) : (
          trimspace(var.owner_inputs.regional_outage_policy) != "" &&
          trimspace(var.owner_inputs.regional_ha_failover_evidence_reference) != "" &&
          !can(regex("(?i)(tbd|pending|placeholder|replace[-_ ]?me|example)", var.owner_inputs.regional_outage_policy)) &&
          !can(regex("(?i)(tbd|pending|placeholder|replace[-_ ]?me|example)", var.owner_inputs.regional_ha_failover_evidence_reference))
        )
      )
      error_message = "regional_ha requires a staging exercise approval; production additionally requires an accepted regional-outage policy and completed staging failover evidence."
    }

    precondition {
      condition = !var.enable_core || (
        var.cloud_sql_config.usable_connection_budget > 0 &&
        local.planned_connection_total <= var.cloud_sql_config.usable_connection_budget
      )
      error_message = "The runtime, overlapping-revision, controlled-job, administrator, and monitoring connection total exceeds the reviewed usable Cloud SQL connection budget."
    }

    precondition {
      condition     = !var.enable_core || local.optional_approvals_complete
      error_message = "Every enabled optional feature needs an owner, approval reference, cost, monitoring, failure/replay, and disable/rollback plan."
    }

    precondition {
      condition = !var.enable_core || (
        trimspace(var.cloud_sql_config.backup_location) != "" &&
        !can(regex("(?i)(tbd|pending|placeholder|replace[-_ ]?me|example)", var.cloud_sql_config.backup_location))
      )
      error_message = "Core provisioning requires an explicit reviewed Cloud SQL backup location."
    }

    precondition {
      condition     = !var.enable_core || var.enable_guardrails
      error_message = "Core activation requires the separately protected budget and notification guardrails."
    }

    precondition {
      condition = !var.enable_core || (
        trimspace(var.owner_inputs.guardrail_verification_reference) != "" &&
        !can(regex("(?i)(tbd|pending|placeholder|replace[-_ ]?me|example)", var.owner_inputs.guardrail_verification_reference))
      )
      error_message = "Core activation requires a safe reference proving the guardrail-only apply and notification delivery were verified first."
    }

    precondition {
      condition = !var.enable_core || (
        trimspace(var.owner_inputs.network_approval_reference) != "" &&
        !can(regex("(?i)(tbd|pending|placeholder|replace[-_ ]?me|example)", var.owner_inputs.network_approval_reference))
      )
      error_message = "Core activation requires a safe reference proving the Cloud Run and Private Service Access ranges were reviewed for overlap."
    }

    precondition {
      condition = !var.enable_core || !var.cloud_run_config.deploy_service || (
        startswith(var.cloud_run_config.image, "${var.owner_inputs.region}-docker.pkg.dev/${var.owner_inputs.project_id}/${local.name}-app/") &&
        can(regex("@sha256:[0-9a-f]{64}$", var.cloud_run_config.image)) &&
        can(regex("^[1-9][0-9]*$", var.cloud_run_config.postgres_secret_version)) &&
        can(regex("^[a-z_][a-z0-9_]{0,62}$", var.cloud_run_config.runtime_database_user))
      )
      error_message = "Cloud Run deployment requires an immutable image from this environment's Artifact Registry repository, a pinned numeric PostgreSQL secret version, and a reviewed database user."
    }
  }
}

resource "terraform_data" "guardrail_activation_lock" {
  count = var.enable_guardrails ? 1 : 0

  input = {
    approval_reference = var.owner_inputs.approval_reference
    deployment_stage   = var.deployment_stage
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [terraform_data.approval_gate]
}

resource "terraform_data" "core_activation_lock" {
  count = var.enable_core ? 1 : 0

  input = {
    approval_reference = var.owner_inputs.approval_reference
    deployment_stage   = var.deployment_stage
    database_profile   = var.cloud_sql_profile
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [terraform_data.guardrail_activation_lock]
}

resource "google_project_service" "core" {
  for_each = local.enabled_services

  project            = var.owner_inputs.project_id
  service            = each.value
  disable_on_destroy = false

  depends_on = [
    terraform_data.approval_gate,
    terraform_data.guardrail_activation_lock,
    terraform_data.core_activation_lock,
  ]
}

resource "google_project_service" "optional" {
  for_each = var.enable_core ? local.optional_services : toset([])

  project            = var.owner_inputs.project_id
  service            = each.value
  disable_on_destroy = false

  depends_on = [terraform_data.core_activation_lock]
}

resource "google_compute_network" "application" {
  count = var.enable_core ? 1 : 0

  project                 = var.owner_inputs.project_id
  name                    = "${local.name}-network"
  auto_create_subnetworks = false
  routing_mode            = "REGIONAL"

  depends_on = [google_project_service.core]
}

resource "google_compute_subnetwork" "cloud_run" {
  count = var.enable_core ? 1 : 0

  project                  = var.owner_inputs.project_id
  name                     = "${local.name}-run"
  region                   = var.owner_inputs.region
  network                  = google_compute_network.application[0].id
  ip_cidr_range            = var.network_config.cloud_run_subnet_cidr
  private_ip_google_access = true
  stack_type               = "IPV4_ONLY"
}

resource "google_compute_global_address" "private_services" {
  count = var.enable_core ? 1 : 0

  project       = var.owner_inputs.project_id
  name          = "${local.name}-private-services"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  address       = var.network_config.private_service_range_address
  prefix_length = var.network_config.private_service_range_prefix_length
  network       = google_compute_network.application[0].id
}

resource "google_service_networking_connection" "private_vpc" {
  count = var.enable_core ? 1 : 0

  network                 = google_compute_network.application[0].id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_services[0].name]

  depends_on = [google_project_service.core]
}

resource "google_service_account" "runtime" {
  count = var.enable_core ? 1 : 0

  project      = var.owner_inputs.project_id
  account_id   = "${local.name}-runtime"
  display_name = "FCI Operations ${var.deployment_stage} runtime"
  description  = "Keyless Cloud Run runtime identity; no deployment or migration authority."

  depends_on = [google_project_service.core]
}

resource "google_service_account" "migration" {
  count = var.enable_core ? 1 : 0

  project      = var.owner_inputs.project_id
  account_id   = "${local.name}-migration"
  display_name = "FCI Operations ${var.deployment_stage} migration"
  description  = "Controlled one-off migration-job identity; no service deployment authority."

  depends_on = [google_project_service.core]
}

resource "google_service_account" "rehearsal" {
  count = var.enable_core && var.deployment_stage == "staging" ? 1 : 0

  project      = var.owner_inputs.project_id
  account_id   = "${local.name}-rehearsal"
  display_name = "FCI Operations staging rehearsal"
  description  = "Test-data-only bounded rehearsal identity; never created in production."

  depends_on = [google_project_service.core]
}

locals {
  project_roles = var.enable_core ? {
    runtime-cloudsql   = { member = google_service_account.runtime[0].email, role = "roles/cloudsql.client" }
    runtime-logging    = { member = google_service_account.runtime[0].email, role = "roles/logging.logWriter" }
    runtime-monitoring = { member = google_service_account.runtime[0].email, role = "roles/monitoring.metricWriter" }
    migration-cloudsql = { member = google_service_account.migration[0].email, role = "roles/cloudsql.client" }
    migration-logging  = { member = google_service_account.migration[0].email, role = "roles/logging.logWriter" }
  } : {}

  staging_project_roles = var.enable_core && var.deployment_stage == "staging" ? {
    rehearsal-cloudsql = { member = google_service_account.rehearsal[0].email, role = "roles/cloudsql.client" }
    rehearsal-logging  = { member = google_service_account.rehearsal[0].email, role = "roles/logging.logWriter" }
  } : {}
}

resource "google_project_iam_member" "core_identities" {
  for_each = merge(local.project_roles, local.staging_project_roles)

  project = var.owner_inputs.project_id
  role    = each.value.role
  member  = "serviceAccount:${each.value.member}"
}

resource "google_secret_manager_secret" "core" {
  for_each = var.enable_core ? local.secret_purposes : {}

  project             = var.owner_inputs.project_id
  secret_id           = "${local.name}-${each.key}"
  labels              = local.common_labels
  deletion_protection = var.deployment_stage == "production"

  replication {
    auto {}
  }

  depends_on = [google_project_service.core]
}

resource "google_secret_manager_secret_iam_member" "runtime" {
  for_each = var.enable_core ? local.runtime_secret_purposes : {}

  project   = var.owner_inputs.project_id
  secret_id = google_secret_manager_secret.core[each.key].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime[0].email}"
}

resource "google_secret_manager_secret_iam_member" "migration_postgres" {
  count = var.enable_core ? 1 : 0

  project   = var.owner_inputs.project_id
  secret_id = google_secret_manager_secret.core["postgres-migration-password"].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.migration[0].email}"
}

resource "google_secret_manager_secret_iam_member" "rehearsal_postgres" {
  count = var.enable_core && var.deployment_stage == "staging" ? 1 : 0

  project   = var.owner_inputs.project_id
  secret_id = google_secret_manager_secret.core["postgres-rehearsal-password"].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.rehearsal[0].email}"
}

resource "google_artifact_registry_repository" "application" {
  count = var.enable_core ? 1 : 0

  project       = var.owner_inputs.project_id
  location      = var.owner_inputs.region
  repository_id = "${local.name}-app"
  description   = "Immutable FCI Operations Cloud Run images"
  format        = "DOCKER"
  labels        = local.common_labels

  docker_config {
    immutable_tags = true
  }

  depends_on = [google_project_service.core]
}

resource "google_sql_database_instance" "application" {
  count = var.enable_core ? 1 : 0

  project             = var.owner_inputs.project_id
  name                = "${local.name}-postgres"
  region              = var.owner_inputs.region
  database_version    = "POSTGRES_16"
  deletion_protection = var.deployment_stage == "production"
  deletion_policy     = var.deployment_stage == "production" ? "PREVENT" : "DELETE"

  settings {
    tier                        = var.cloud_sql_config.tier
    edition                     = "ENTERPRISE"
    activation_policy           = "ALWAYS"
    availability_type           = var.cloud_sql_profile == "regional_ha" ? "REGIONAL" : "ZONAL"
    connector_enforcement       = "REQUIRED"
    deletion_protection_enabled = var.deployment_stage == "production"
    disk_type                   = "PD_SSD"
    disk_size                   = var.cloud_sql_config.disk_size_gb
    disk_autoresize             = true
    disk_autoresize_limit       = var.cloud_sql_config.disk_autoresize_limit_gb
    user_labels                 = local.common_labels

    backup_configuration {
      enabled                        = true
      location                       = var.cloud_sql_config.backup_location
      start_time                     = var.cloud_sql_config.backup_start_time_utc
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = var.cloud_sql_config.transaction_log_retention_days

      backup_retention_settings {
        retained_backups = var.cloud_sql_config.retained_backups
        retention_unit   = "COUNT"
      }
    }

    ip_configuration {
      ipv4_enabled       = false
      private_network    = google_compute_network.application[0].id
      allocated_ip_range = google_compute_global_address.private_services[0].name
    }

    maintenance_window {
      day          = var.owner_inputs.maintenance_day_utc
      hour         = var.owner_inputs.maintenance_hour_utc
      update_track = "stable"
    }
  }

  depends_on = [
    google_project_service.core,
    google_billing_budget.environment,
    google_service_networking_connection.private_vpc,
    terraform_data.approval_gate,
  ]

  lifecycle {
    ignore_changes = [settings[0].disk_size]
  }
}

resource "google_sql_database" "application" {
  count = var.enable_core ? 1 : 0

  project         = var.owner_inputs.project_id
  name            = "fci_operations"
  instance        = google_sql_database_instance.application[0].name
  deletion_policy = var.deployment_stage == "production" ? "ABANDON" : "DELETE"
}

resource "google_monitoring_notification_channel" "email" {
  for_each = var.enable_guardrails ? var.owner_inputs.alert_emails : toset([])

  project      = var.owner_inputs.project_id
  display_name = "FCI Operations ${var.deployment_stage} alert - ${each.value}"
  type         = "email"
  labels = {
    email_address = each.value
  }
  force_delete = false

  depends_on = [google_project_service.core]
}

resource "google_billing_budget" "environment" {
  count = var.enable_guardrails ? 1 : 0

  billing_account = var.owner_inputs.billing_account_id
  display_name    = "FCI Operations ${var.deployment_stage} monthly alert"

  budget_filter {
    projects = ["projects/${data.google_project.target[0].number}"]
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = tostring(floor(var.budget_amount_usd))
      nanos         = floor((var.budget_amount_usd - floor(var.budget_amount_usd)) * 1000000000)
    }
  }

  threshold_rules {
    threshold_percent = 0.50
  }

  threshold_rules {
    threshold_percent = 0.90
  }

  threshold_rules {
    threshold_percent = 1.00
  }

  threshold_rules {
    threshold_percent = 1.00
    spend_basis       = "FORECASTED_SPEND"
  }

  all_updates_rule {
    monitoring_notification_channels = [for channel in google_monitoring_notification_channel.email : channel.name]
    disable_default_iam_recipients   = false
  }

  depends_on = [google_project_service.core, terraform_data.approval_gate]
}

resource "google_monitoring_alert_policy" "cloud_sql" {
  for_each = var.enable_core ? local.sql_alerts : {}

  project      = var.owner_inputs.project_id
  display_name = "FCI ${var.deployment_stage}: ${each.value.display_name}"
  combiner     = "OR"
  enabled      = true

  conditions {
    display_name = each.value.display_name

    condition_threshold {
      filter          = "resource.type = \"cloudsql_database\" AND resource.label.database_id = \"${var.owner_inputs.project_id}:${local.name}-postgres\" AND metric.type = \"${each.value.metric}\""
      comparison      = "COMPARISON_GT"
      duration        = "300s"
      threshold_value = each.value.threshold

      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MEAN"
      }

      trigger {
        count = 1
      }
    }
  }

  notification_channels = [for channel in google_monitoring_notification_channel.email : channel.name]

  alert_strategy {
    auto_close = "1800s"
  }

  documentation {
    content   = "Follow the approved FCI Google Cloud operations and recovery runbooks. Do not put secrets or client data in incident notes."
    mime_type = "text/markdown"
  }

  depends_on = [google_project_service.core]
}

resource "google_monitoring_alert_policy" "cloud_sql_backup_failure" {
  count = var.enable_core ? 1 : 0

  project      = var.owner_inputs.project_id
  display_name = "FCI ${var.deployment_stage}: Cloud SQL automated backup failed or skipped"
  combiner     = "OR"
  enabled      = true

  conditions {
    display_name = "Cloud SQL automated backup failed, attempt failed, or skipped"

    condition_matched_log {
      filter = <<-EOT
        resource.type="cloudsql_database"
        logName="projects/${var.owner_inputs.project_id}/logs/cloudaudit.googleapis.com%2Fsystem_event"
        protoPayload.methodName="cloudsql.instances.automatedBackup"
        protoPayload.resourceName="projects/${var.owner_inputs.project_id}/instances/${google_sql_database_instance.application[0].name}"
        protoPayload.metadata.windowStatus=~"^STATUS_(ATTEMPT_FAILED|FAILED|SKIPPED)$"
      EOT
    }
  }

  notification_channels = [for channel in google_monitoring_notification_channel.email : channel.name]

  alert_strategy {
    auto_close = "604800s"

    notification_rate_limit {
      period = "300s"
    }
  }

  documentation {
    content   = "Follow the backup/PITR restore and reconciliation runbook. Verify the last successful backup manually; Cloud SQL exposes backup status through system-event logs rather than a native backup-age metric."
    mime_type = "text/markdown"
  }

  depends_on = [google_project_service.core, google_sql_database_instance.application]
}

resource "google_cloud_run_v2_service" "application" {
  count = var.enable_core && var.cloud_run_config.deploy_service ? 1 : 0

  project             = var.owner_inputs.project_id
  name                = "${local.name}-app"
  location            = var.owner_inputs.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = var.deployment_stage == "production"
  labels              = local.common_labels

  template {
    service_account                  = google_service_account.runtime[0].email
    timeout                          = "60s"
    max_instance_request_concurrency = var.cloud_run_config.request_concurrency
    execution_environment            = "EXECUTION_ENVIRONMENT_GEN2"

    scaling {
      min_instance_count = var.cloud_run_config.min_instances
      max_instance_count = var.cloud_run_config.max_instances
    }

    vpc_access {
      egress = "PRIVATE_RANGES_ONLY"

      network_interfaces {
        network    = google_compute_network.application[0].id
        subnetwork = google_compute_subnetwork.cloud_run[0].id
      }
    }

    containers {
      name  = "application"
      image = var.cloud_run_config.image

      ports {
        name           = "http1"
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = var.cloud_run_config.cpu
          memory = var.cloud_run_config.memory
        }
        cpu_idle          = true
        startup_cpu_boost = true
      }

      env {
        name  = "FCI_APP_ENVIRONMENT"
        value = "production"
      }

      env {
        name  = "FCI_DEPLOYMENT_STAGE"
        value = var.deployment_stage
      }

      env {
        name  = "FCI_POSTGRES_ACCESS_MODE"
        value = "runtime"
      }

      env {
        name  = "FCI_POSTGRES_CONNECTION_MODE"
        value = "cloud-sql-connector"
      }

      env {
        name  = "FCI_CLOUD_SQL_INSTANCE_CONNECTION_NAME"
        value = google_sql_database_instance.application[0].connection_name
      }

      env {
        name  = "FCI_CLOUD_SQL_IP_TYPE"
        value = "PRIVATE"
      }

      env {
        name  = "FCI_POSTGRES_DATABASE"
        value = google_sql_database.application[0].name
      }

      env {
        name  = "FCI_POSTGRES_USER"
        value = var.cloud_run_config.runtime_database_user
      }

      env {
        name  = "FCI_POSTGRES_PASSWORD_FILE"
        value = "/secrets/postgres/password"
      }

      env {
        name  = "FCI_POSTGRES_SCHEMA"
        value = "fci_app"
      }

      env {
        name  = "FCI_POSTGRES_POOL_MAX"
        value = tostring(var.cloud_run_config.runtime_pool_max)
      }

      volume_mounts {
        name       = "postgres-password"
        mount_path = "/secrets/postgres"
      }

      startup_probe {
        initial_delay_seconds = 0
        timeout_seconds       = 2
        period_seconds        = 5
        failure_threshold     = 24

        http_get {
          path = "/readyz"
          port = 8080
        }
      }

      readiness_probe {
        timeout_seconds   = 2
        period_seconds    = 10
        failure_threshold = 3

        http_get {
          path = "/readyz"
          port = 8080
        }
      }

      liveness_probe {
        initial_delay_seconds = 10
        timeout_seconds       = 2
        period_seconds        = 30
        failure_threshold     = 3

        http_get {
          path = "/healthz"
          port = 8080
        }
      }
    }

    volumes {
      name = "postgres-password"

      secret {
        secret = google_secret_manager_secret.core["postgres-runtime-password"].secret_id

        items {
          version = var.cloud_run_config.postgres_secret_version
          path    = "password"
        }
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  depends_on = [
    google_project_iam_member.core_identities,
    google_secret_manager_secret_iam_member.runtime,
    google_service_networking_connection.private_vpc,
    terraform_data.deployment_gate,
  ]
}

resource "google_monitoring_alert_policy" "cloud_run_5xx" {
  count = var.enable_core && var.cloud_run_config.deploy_service ? 1 : 0

  project      = var.owner_inputs.project_id
  display_name = "FCI ${var.deployment_stage}: Cloud Run 5xx responses"
  combiner     = "OR"
  enabled      = true

  conditions {
    display_name = "Cloud Run 5xx response rate"

    condition_threshold {
      filter          = "resource.type = \"cloud_run_revision\" AND resource.label.service_name = \"${local.name}-app\" AND metric.type = \"run.googleapis.com/request_count\" AND metric.label.response_code_class = \"5xx\""
      comparison      = "COMPARISON_GT"
      duration        = "300s"
      threshold_value = 0

      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_RATE"
      }
    }
  }

  notification_channels = [for channel in google_monitoring_notification_channel.email : channel.name]

  alert_strategy {
    auto_close = "1800s"
  }

  depends_on = [google_cloud_run_v2_service.application]
}
