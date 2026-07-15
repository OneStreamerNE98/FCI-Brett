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
}

variables {
  enable_core       = true
  enable_guardrails = true
  cloud_sql_profile = "standalone"
  budget_amount_usd = 50

  owner_inputs = {
    approval_reference                      = "OWNER-123"
    project_id                              = "fci-staging-test"
    project_number                          = "123456789012"
    project_parent                          = "organizations/555555555555"
    billing_account_id                      = "ABCDEF-123456-ABCDEF"
    region                                  = "us-central1"
    hostname                                = "staging.cherryhillfci.test"
    dns_owner                               = "dns@cherryhillfci.test"
    alert_emails                            = ["alerts@cherryhillfci.test"]
    rpo_hours                               = 1
    rto_hours                               = 4
    deployment_approver                     = "approver@cherryhillfci.test"
    rollback_owner                          = "rollback@cherryhillfci.test"
    guardrail_verification_reference        = "FCI-GUARDRAIL-2026-07"
    network_approval_reference              = "FCI-NETWORK-2026-07"
    regional_outage_policy                  = "FCI owner accepts restore-based regional recovery"
    regional_ha_exercise_approval_reference = "FCI-HA-EXERCISE-2026-07"
    regional_ha_failover_evidence_reference = "FCI-HA-DRILL-2026-07"
    maintenance_day_utc                     = 7
    maintenance_hour_utc                    = 6
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
}

run "default_switch_creates_nothing" {
  command = plan

  variables {
    enable_core       = false
    enable_guardrails = false
    cloud_sql_profile = null
  }

  assert {
    condition     = output.planning.resources_enabled == false && output.planning.guardrails_enabled == false
    error_message = "The initial staging plan must leave both core and guardrails disabled."
  }

  assert {
    condition     = output.planning.enabled_service_count == 0 && output.planning.optional_service_count == 0
    error_message = "A disabled staging root must declare no Google APIs or resources."
  }
}

run "standalone_profile_is_zonal_and_bounded" {
  command = plan

  assert {
    condition     = output.planning.availability_type == "ZONAL"
    error_message = "The standalone profile must map to ZONAL."
  }

  assert {
    condition     = output.planning.connection_budget.planned_total == 32 && output.planning.connection_budget.fits
    error_message = "Staging must budget runtime, two revisions, migration, rehearsal, and reserve connections."
  }

  assert {
    condition     = output.planning.cloud_run_planned == false
    error_message = "The fail-closed Cloud Run service must have a separate disabled deployment gate."
  }
}

run "guardrail_only_plan_retains_budget_controls" {
  command = plan

  variables {
    enable_core       = false
    enable_guardrails = true
    cloud_sql_profile = null
  }

  assert {
    condition     = output.planning.resources_enabled == false && output.planning.guardrails_enabled && output.planning.enabled_service_count == 4
    error_message = "A post-teardown plan must be able to retain only the four guardrail APIs, budget, and notification channels."
  }
}

run "regional_ha_profile_is_regional" {
  command = plan

  variables {
    cloud_sql_profile = "regional_ha"
  }

  assert {
    condition     = output.planning.availability_type == "REGIONAL"
    error_message = "The regional HA profile must map to REGIONAL."
  }
}

run "approved_optional_api_has_explicit_evidence" {
  command = plan

  variables {
    optional_features = {
      cloud_tasks       = true
      cloud_scheduler   = false
      gmail_pubsub      = false
      calendar_webhooks = false
      upload_quarantine = false
      sms               = false
      pgvector          = false
    }

    optional_feature_approvals = {
      cloud_tasks = {
        owner              = "jobs-owner"
        approval_reference = "OWNER-OPTIONAL-1"
        monthly_cost_usd   = 5
        monitoring_plan    = "Queue depth and failed delivery alerts"
        failure_replay     = "Application-owned terminal failure and controlled replay"
        disable_rollback   = "Disable dispatch and remove queue after draining"
      }
    }
  }

  assert {
    condition     = output.planning.optional_service_count == 1
    error_message = "An approved Cloud Tasks flag should enable only its API gate."
  }
}

run "immutable_service_plan_uses_separate_gate" {
  command = plan

  variables {
    cloud_run_config = {
      deploy_service           = true
      image                    = "us-central1-docker.pkg.dev/fci-staging-test/fci-ops-stg-app/fci@sha256:0000000000000000000000000000000000000000000000000000000000000000"
      runtime_database_user    = "fci_runtime_login"
      postgres_secret_version  = "1"
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

  assert {
    condition     = output.planning.cloud_run_planned == true
    error_message = "A separately approved immutable image should enter the Cloud Run plan."
  }
}
