mock_provider "google" {
  mock_data "google_project" {
    defaults = {
      project_id      = "fci-production-test"
      number          = "210987654321"
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
  budget_amount_usd = 85

  owner_inputs = {
    approval_reference                      = "OWNER-456"
    project_id                              = "fci-production-test"
    project_number                          = "210987654321"
    project_parent                          = "organizations/555555555555"
    billing_account_id                      = "ABCDEF-123456-ABCDEF"
    region                                  = "us-central1"
    hostname                                = "operations.cherryhillfci.test"
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
    retained_backups               = 14
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
    budget_amount_usd = 0
  }

  assert {
    condition     = output.planning.resources_enabled == false && output.planning.guardrails_enabled == false
    error_message = "The initial production plan must leave both core and guardrails disabled."
  }

  assert {
    condition     = output.planning.database_profile == null && output.planning.enabled_service_count == 0
    error_message = "The default production plan must select no database profile and declare no resources."
  }

  assert {
    condition = (
      output.planning.deployment_identity == false &&
      output.planning.cloud_run_planned == false &&
      output.planning.migration_job_planned == false &&
      output.planning.rehearsal_job_planned == false
    )
    error_message = "Every deployment identity, service, and Job definition must remain absent by default."
  }
}

run "standalone_profile_is_zonal_and_bounded" {
  command = plan

  assert {
    condition     = output.planning.availability_type == "ZONAL"
    error_message = "The standalone profile must map to ZONAL."
  }

  assert {
    condition     = output.planning.connection_budget.planned_total == 31 && output.planning.connection_budget.fits
    error_message = "Production must budget runtime, two revisions, migration, and reserve connections."
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
