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

run "empty_owner_input_is_rejected" {
  command = plan

  variables {
    owner_inputs = {
      approval_reference                      = ""
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
  }

  expect_failures = [terraform_data.approval_gate]
}

run "unreviewed_connection_budget_is_rejected" {
  command = plan

  variables {
    cloud_sql_config = {
      tier                           = "db-custom-1-3840"
      disk_size_gb                   = 20
      disk_autoresize_limit_gb       = 100
      backup_location                = "us"
      backup_start_time_utc          = "06:00"
      retained_backups               = 7
      transaction_log_retention_days = 7
      usable_connection_budget       = 31
    }
  }

  expect_failures = [terraform_data.approval_gate]
}

run "ipv6_cloud_run_subnet_is_rejected" {
  command = plan

  variables {
    network_config = {
      cloud_run_subnet_cidr               = "2001:db8::/64"
      private_service_range_address       = "10.31.0.0"
      private_service_range_prefix_length = 16
    }
  }

  expect_failures = [var.network_config]
}

run "undersized_cloud_run_subnet_is_rejected" {
  command = plan

  variables {
    network_config = {
      cloud_run_subnet_cidr               = "10.30.0.0/27"
      private_service_range_address       = "10.31.0.0"
      private_service_range_prefix_length = 16
    }
  }

  expect_failures = [var.network_config]
}

run "ipv6_private_service_range_is_rejected" {
  command = plan

  variables {
    network_config = {
      cloud_run_subnet_cidr               = "10.30.0.0/26"
      private_service_range_address       = "2001:db8::"
      private_service_range_prefix_length = 16
    }
  }

  expect_failures = [var.network_config]
}

run "mismatched_project_number_is_rejected" {
  command = plan

  override_data {
    target = data.google_project.target[0]
    values = {
      number          = "999999999999"
      org_id          = "555555555555"
      folder_id       = ""
      billing_account = "ABCDEF-123456-ABCDEF"
    }
  }

  expect_failures = [terraform_data.approval_gate]
}

run "mismatched_project_parent_is_rejected" {
  command = plan

  override_data {
    target = data.google_project.target[0]
    values = {
      number          = "123456789012"
      org_id          = "999999999999"
      folder_id       = ""
      billing_account = "ABCDEF-123456-ABCDEF"
    }
  }

  expect_failures = [terraform_data.approval_gate]
}

run "mismatched_billing_account_is_rejected" {
  command = plan

  override_data {
    target = data.google_project.target[0]
    values = {
      number          = "123456789012"
      org_id          = "555555555555"
      folder_id       = ""
      billing_account = "999999-999999-999999"
    }
  }

  expect_failures = [terraform_data.approval_gate]
}

run "optional_feature_without_evidence_is_rejected" {
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
  }

  expect_failures = [terraform_data.approval_gate]
}

run "optional_feature_placeholder_evidence_is_rejected" {
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
        owner              = "TBD"
        approval_reference = "TBD"
        monthly_cost_usd   = 0
        monitoring_plan    = "TBD"
        failure_replay     = "TBD"
        disable_rollback   = "TBD"
      }
    }
  }

  expect_failures = [terraform_data.approval_gate]
}

run "mutable_service_image_is_rejected" {
  command = plan

  variables {
    deployment_config = {
      enable_identity                       = true
      workload_identity_principal           = "principalSet://iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/fci-github/attribute.repository_id/1298731126"
      verified_provider_attribute_condition = "assertion.repository_id == '1298731126' && assertion.ref == 'refs/heads/main' && assertion.environment == 'fci-cloud-run-image-staging'"
    }

    cloud_run_config = {
      deploy_service           = true
      image                    = "us-central1-docker.pkg.dev/fci-staging-test/fci/app:latest"
      runtime_database_user    = "fci_runtime"
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

  expect_failures = [terraform_data.approval_gate]
}

run "core_without_persistent_guardrails_is_rejected" {
  command = plan

  variables {
    enable_guardrails = false
  }

  expect_failures = [terraform_data.approval_gate]
}

run "ha_without_failover_evidence_is_rejected" {
  command = plan

  variables {
    cloud_sql_profile = "regional_ha"
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
      regional_outage_policy                  = ""
      regional_ha_exercise_approval_reference = ""
      regional_ha_failover_evidence_reference = ""
      maintenance_day_utc                     = 7
      maintenance_hour_utc                    = 6
    }
  }

  expect_failures = [terraform_data.approval_gate]
}

run "foreign_registry_digest_is_rejected" {
  command = plan

  variables {
    deployment_config = {
      enable_identity                       = true
      workload_identity_principal           = "principalSet://iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/fci-github/attribute.repository_id/1298731126"
      verified_provider_attribute_condition = "assertion.repository_id == '1298731126' && assertion.ref == 'refs/heads/main' && assertion.environment == 'fci-cloud-run-image-staging'"
    }

    cloud_run_config = {
      deploy_service           = true
      image                    = "us-central1-docker.pkg.dev/other-project/other-repository/app@sha256:0000000000000000000000000000000000000000000000000000000000000000"
      runtime_database_user    = "fci_runtime"
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

  expect_failures = [terraform_data.approval_gate]
}

run "job_without_image_publisher_identity_is_rejected" {
  command = plan

  variables {
    cloud_run_config = {
      deploy_service           = false
      image                    = "us-central1-docker.pkg.dev/fci-staging-test/fci-ops-stg-app/fci@sha256:0000000000000000000000000000000000000000000000000000000000000000"
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

    cloud_run_jobs = {
      deploy_migration_job              = true
      deploy_rehearsal_job              = false
      migration_database_user           = "fci_migration_login"
      migration_role                    = "fci_migration"
      migration_postgres_secret_version = "2"
      rehearsal_database_user           = ""
      rehearsal_postgres_secret_version = ""
      rehearsal_schema                  = ""
      rehearsal_snapshot_bucket         = ""
      rehearsal_snapshot_object         = ""
    }
  }

  expect_failures = [terraform_data.deployment_gate]
}

run "foreign_repository_identity_is_rejected" {
  command = plan

  variables {
    deployment_config = {
      enable_identity                       = true
      workload_identity_principal           = "principalSet://iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/fci-github/attribute.repository_id/9999999999"
      verified_provider_attribute_condition = "assertion.repository_id == '1298731126' && assertion.ref == 'refs/heads/main' && assertion.environment == 'fci-cloud-run-image-staging'"
    }
  }

  expect_failures = [terraform_data.deployment_gate]
}

run "publisher_without_protected_environment_condition_is_rejected" {
  command = plan

  variables {
    deployment_config = {
      enable_identity                       = true
      workload_identity_principal           = "principalSet://iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/fci-github/attribute.repository_id/1298731126"
      verified_provider_attribute_condition = "assertion.repository_id == '1298731126' && assertion.ref == 'refs/heads/main'"
    }
  }

  expect_failures = [terraform_data.deployment_gate]
}

run "mutable_job_image_is_rejected" {
  command = plan

  variables {
    deployment_config = {
      enable_identity                       = true
      workload_identity_principal           = "principalSet://iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/fci-github/attribute.repository_id/1298731126"
      verified_provider_attribute_condition = "assertion.repository_id == '1298731126' && assertion.ref == 'refs/heads/main' && assertion.environment == 'fci-cloud-run-image-staging'"
    }

    cloud_run_config = {
      deploy_service           = false
      image                    = "us-central1-docker.pkg.dev/fci-staging-test/fci-ops-stg-app/fci:latest"
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

    cloud_run_jobs = {
      deploy_migration_job              = true
      deploy_rehearsal_job              = false
      migration_database_user           = "fci_migration_login"
      migration_role                    = "fci_migration"
      migration_postgres_secret_version = "2"
      rehearsal_database_user           = ""
      rehearsal_postgres_secret_version = ""
      rehearsal_schema                  = ""
      rehearsal_snapshot_bucket         = ""
      rehearsal_snapshot_object         = ""
    }
  }

  expect_failures = [terraform_data.deployment_gate]
}

run "production_rehearsal_is_rejected" {
  command = plan

  variables {
    deployment_stage = "production"

    deployment_config = {
      enable_identity                       = true
      workload_identity_principal           = "principalSet://iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/fci-github/attribute.repository_id/1298731126"
      verified_provider_attribute_condition = "assertion.repository_id == '1298731126' && assertion.ref == 'refs/heads/main' && assertion.environment == 'fci-cloud-run-image-production'"
    }

    cloud_run_config = {
      deploy_service           = false
      image                    = "us-central1-docker.pkg.dev/fci-staging-test/fci-ops-prd-app/fci@sha256:0000000000000000000000000000000000000000000000000000000000000000"
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

    cloud_run_jobs = {
      deploy_migration_job              = false
      deploy_rehearsal_job              = true
      migration_database_user           = ""
      migration_role                    = ""
      migration_postgres_secret_version = ""
      rehearsal_database_user           = "fci_rehearsal_login"
      rehearsal_postgres_secret_version = "3"
      rehearsal_schema                  = "fci_rehearsal_owner_202607"
      rehearsal_snapshot_bucket         = "fci-staging-test-snapshots"
      rehearsal_snapshot_object         = "approved/core-rehearsal.json"
    }
  }

  expect_failures = [terraform_data.deployment_gate]
}
