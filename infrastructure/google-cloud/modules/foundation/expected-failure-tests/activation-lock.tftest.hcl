# This suite intentionally exits nonzero when lifecycle.prevent_destroy works.
# CI runs it separately and verifies the exact expected lifecycle error.

mock_provider "google" {
  mock_data "google_project" {
    defaults = {
      project_id      = "fci-staging-test"
      number          = "123456789012"
      org_id          = "555555555555"
      folder_id       = ""
      billing_account = "ABCDEF-123456-ABCDEF"
    }
  }

  mock_resource "google_compute_network" {
    defaults = {
      id = "projects/fci-staging-test/global/networks/fci-ops-stg-network"
    }
  }

  mock_resource "google_service_account" {
    defaults = {
      email = "fci-ops-test@fci-staging-test.iam.gserviceaccount.com"
    }
  }

  mock_resource "google_monitoring_notification_channel" {
    defaults = {
      name = "projects/fci-staging-test/notificationChannels/123456789"
    }
  }
}

variables {
  enable_core       = true
  enable_guardrails = true
  deployment_stage  = "staging"
  cloud_sql_profile = "standalone"
  budget_amount_usd = 50

  owner_inputs = {
    approval_reference                      = "FCI-OWNER-2026-07"
    project_id                              = "fci-staging-test"
    project_number                          = "123456789012"
    project_parent                          = "organizations/555555555555"
    billing_account_id                      = "ABCDEF-123456-ABCDEF"
    region                                  = "us-central1"
    hostname                                = "staging.fci.invalid"
    dns_owner                               = "FCI owner"
    alert_emails                            = ["owner@example.test"]
    rpo_hours                               = 24
    rto_hours                               = 8
    deployment_approver                     = "FCI owner"
    rollback_owner                          = "FCI recovery owner"
    guardrail_verification_reference        = "FCI-GUARDRAIL-2026-07"
    network_approval_reference              = "FCI-NETWORK-2026-07"
    regional_outage_policy                  = "FCI owner accepts restore-based regional recovery"
    regional_ha_exercise_approval_reference = "FCI-HA-EXERCISE-2026-07"
    regional_ha_failover_evidence_reference = "FCI-HA-DRILL-2026-07"
    maintenance_day_utc                     = 7
    maintenance_hour_utc                    = 6
  }

  network_config = {
    cloud_run_subnet_cidr               = "10.30.0.0/26"
    private_service_range_address       = "10.31.0.0"
    private_service_range_prefix_length = 16
  }

  cloud_sql_config = {
    tier                           = "db-custom-1-3840"
    disk_size_gb                   = 20
    disk_autoresize_limit_gb       = 100
    backup_location                = "us"
    backup_start_time_utc          = "06:00"
    retained_backups               = 7
    transaction_log_retention_days = 7
    usable_connection_budget       = 100
  }

  cloud_run_config = {
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

  optional_features = {
    cloud_tasks       = false
    cloud_scheduler   = false
    gmail_pubsub      = false
    calendar_webhooks = false
    upload_quarantine = false
    sms               = false
    pgvector          = false
  }
}

run "approved_activation_can_be_applied_to_mock_state" {
  command = apply

  assert {
    condition     = output.resource_creation_enabled && output.guardrails_enabled
    error_message = "The approved mocked activation must create both lifecycle locks."
  }
}

run "activation_lock_blocks_switch_off_after_apply" {
  command = plan

  variables {
    enable_core       = false
    cloud_sql_profile = null
  }
}
