locals {
  deployment_resource_requested = (
    var.deployment_config.enable_identity ||
    var.cloud_run_config.deploy_service ||
    var.cloud_run_jobs.deploy_migration_job ||
    var.cloud_run_jobs.deploy_rehearsal_job
  )
  cloud_run_job_requested = (
    var.cloud_run_jobs.deploy_migration_job ||
    var.cloud_run_jobs.deploy_rehearsal_job
  )
  immutable_application_image = (
    startswith(
      var.cloud_run_config.image,
      "${var.owner_inputs.region}-docker.pkg.dev/${var.owner_inputs.project_id}/${local.name}-app/",
    ) &&
    can(regex("@sha256:[0-9a-f]{64}$", var.cloud_run_config.image))
  )
  migration_job_enabled = var.enable_core && var.cloud_run_jobs.deploy_migration_job
  rehearsal_job_enabled = (
    var.enable_core &&
    var.deployment_stage == "staging" &&
    var.cloud_run_jobs.deploy_rehearsal_job
  )
  rehearsal_snapshot_path = "/rehearsal/${var.cloud_run_jobs.rehearsal_snapshot_object}"
  required_wif_provider_condition = (
    "assertion.repository_id == '1298731126' && assertion.ref == 'refs/heads/main' && assertion.environment == 'fci-cloud-run-image-${var.deployment_stage}'"
  )
}

resource "terraform_data" "deployment_gate" {
  count = local.deployment_resource_requested ? 1 : 0

  input = {
    approval_reference = var.owner_inputs.approval_reference
    deployment_stage   = var.deployment_stage
    service            = var.cloud_run_config.deploy_service
    migration_job      = var.cloud_run_jobs.deploy_migration_job
    rehearsal_job      = var.cloud_run_jobs.deploy_rehearsal_job
  }

  lifecycle {
    precondition {
      condition     = var.enable_core
      error_message = "Deployment identity, service, and job definitions require the separately approved core foundation."
    }

    precondition {
      condition     = !local.deployment_resource_requested || var.deployment_config.enable_identity
      error_message = "Any service or job release requires the separately enabled keyless deployment image-publisher identity."
    }

    precondition {
      condition = !var.deployment_config.enable_identity || (
        can(regex(
          "^principalSet://iam\\.googleapis\\.com/projects/${var.owner_inputs.project_number}/locations/global/workloadIdentityPools/[a-z0-9-]+/attribute\\.repository_id/1298731126$",
          var.deployment_config.workload_identity_principal,
        ))
      )
      error_message = "The deployment identity requires the immutable FCI-Brett repository ID principal from an approved Workload Identity pool in this environment's project."
    }

    precondition {
      condition = !var.deployment_config.enable_identity || (
        var.deployment_config.verified_provider_attribute_condition == local.required_wif_provider_condition
      )
      error_message = "Record the verified provider condition restricting immutable repository ID 1298731126 to main and this protected GitHub environment."
    }

    precondition {
      condition     = !local.cloud_run_job_requested || local.immutable_application_image
      error_message = "Cloud Run jobs require the same immutable image digest from this environment's Terraform-managed Artifact Registry repository."
    }

    precondition {
      condition = !var.cloud_run_jobs.deploy_migration_job || (
        can(regex("^[a-z_][a-z0-9_]{0,62}$", var.cloud_run_jobs.migration_database_user)) &&
        can(regex("^[a-z_][a-z0-9_]{0,62}$", var.cloud_run_jobs.migration_role)) &&
        can(regex("^[1-9][0-9]*$", var.cloud_run_jobs.migration_postgres_secret_version))
      )
      error_message = "The migration job requires a reviewed database login, migration role, and pinned numeric PostgreSQL secret version."
    }

    precondition {
      condition = !var.cloud_run_jobs.deploy_rehearsal_job || (
        var.deployment_stage == "staging" &&
        can(regex("^[a-z_][a-z0-9_]{0,62}$", var.cloud_run_jobs.rehearsal_database_user)) &&
        can(regex("^fci_rehearsal_[a-z0-9_]{1,49}$", var.cloud_run_jobs.rehearsal_schema)) &&
        can(regex("^[1-9][0-9]*$", var.cloud_run_jobs.rehearsal_postgres_secret_version))
      )
      error_message = "The rehearsal job is staging-only and requires a reviewed database login, pinned secret version, and ^fci_rehearsal_ schema."
    }

    precondition {
      condition = !var.cloud_run_jobs.deploy_rehearsal_job || (
        can(regex("^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$", var.cloud_run_jobs.rehearsal_snapshot_bucket)) &&
        can(regex("^[A-Za-z0-9][A-Za-z0-9._/-]{0,510}\\.json$", var.cloud_run_jobs.rehearsal_snapshot_object)) &&
        !strcontains(var.cloud_run_jobs.rehearsal_snapshot_object, "..") &&
        !strcontains(var.cloud_run_jobs.rehearsal_snapshot_object, "//")
      )
      error_message = "The rehearsal job requires a reviewed staging test-data bucket and a bounded relative JSON object path."
    }
  }

  depends_on = [
    terraform_data.approval_gate,
    terraform_data.core_activation_lock,
  ]
}

resource "google_service_account" "deployment" {
  count = var.enable_core && var.deployment_config.enable_identity ? 1 : 0

  project      = var.owner_inputs.project_id
  account_id   = "${local.name}-deploy"
  display_name = "FCI Operations ${var.deployment_stage} image publisher"
  description  = "Keyless GitHub release identity; repository-scoped image push only, with no service deployment or job-execution authority."

  depends_on = [
    google_project_service.core,
    terraform_data.deployment_gate,
  ]
}

resource "google_service_account_iam_member" "deployment_workload_identity" {
  count = var.enable_core && var.deployment_config.enable_identity ? 1 : 0

  service_account_id = google_service_account.deployment[0].name
  role               = "roles/iam.workloadIdentityUser"
  member             = var.deployment_config.workload_identity_principal
}

resource "google_artifact_registry_repository_iam_member" "deployment_writer" {
  count = var.enable_core && var.deployment_config.enable_identity ? 1 : 0

  project    = var.owner_inputs.project_id
  location   = var.owner_inputs.region
  repository = google_artifact_registry_repository.application[0].name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.deployment[0].email}"
}

resource "google_storage_bucket_iam_member" "rehearsal_snapshot_reader" {
  count = local.rehearsal_job_enabled ? 1 : 0

  bucket = var.cloud_run_jobs.rehearsal_snapshot_bucket
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.rehearsal[0].email}"

  depends_on = [
    google_project_service.core,
    terraform_data.deployment_gate,
  ]
}

resource "google_cloud_run_v2_job" "migration" {
  count = local.migration_job_enabled ? 1 : 0

  project             = var.owner_inputs.project_id
  name                = "${local.name}-migrate"
  location            = var.owner_inputs.region
  deletion_protection = var.deployment_stage == "production"
  deletion_policy     = var.deployment_stage == "production" ? "PREVENT" : "DELETE"
  labels              = merge(local.common_labels, { component = "migration-job" })

  template {
    task_count  = 1
    parallelism = 1

    template {
      service_account       = google_service_account.migration[0].email
      timeout               = "900s"
      max_retries           = 0
      execution_environment = "EXECUTION_ENVIRONMENT_GEN2"

      vpc_access {
        egress = "PRIVATE_RANGES_ONLY"

        network_interfaces {
          network    = google_compute_network.application[0].id
          subnetwork = google_compute_subnetwork.cloud_run[0].id
        }
      }

      containers {
        name    = "migration"
        image   = var.cloud_run_config.image
        command = ["node"]
        args    = ["runtime/run-migrations.mjs"]

        resources {
          limits = {
            cpu    = var.cloud_run_config.cpu
            memory = var.cloud_run_config.memory
          }
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
          value = "migration"
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
          value = var.cloud_run_jobs.migration_database_user
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
          name  = "FCI_POSTGRES_MIGRATION_ROLE"
          value = var.cloud_run_jobs.migration_role
        }

        env {
          name  = "FCI_POSTGRES_POOL_MAX"
          value = "1"
        }

        volume_mounts {
          name       = "postgres-password"
          mount_path = "/secrets/postgres"
        }
      }

      volumes {
        name = "postgres-password"

        secret {
          secret = google_secret_manager_secret.core["postgres-migration-password"].secret_id

          items {
            version = var.cloud_run_jobs.migration_postgres_secret_version
            path    = "password"
          }
        }
      }
    }
  }

  depends_on = [
    google_project_iam_member.core_identities,
    google_secret_manager_secret_iam_member.migration_postgres,
    google_service_networking_connection.private_vpc,
    terraform_data.deployment_gate,
  ]
}

resource "google_cloud_run_v2_job" "rehearsal" {
  count = local.rehearsal_job_enabled ? 1 : 0

  project             = var.owner_inputs.project_id
  name                = "${local.name}-rehearse-core"
  location            = var.owner_inputs.region
  deletion_protection = false
  deletion_policy     = "DELETE"
  labels              = merge(local.common_labels, { component = "rehearsal-job" })

  template {
    task_count  = 1
    parallelism = 1

    template {
      service_account       = google_service_account.rehearsal[0].email
      timeout               = "1800s"
      max_retries           = 0
      execution_environment = "EXECUTION_ENVIRONMENT_GEN2"

      vpc_access {
        egress = "PRIVATE_RANGES_ONLY"

        network_interfaces {
          network    = google_compute_network.application[0].id
          subnetwork = google_compute_subnetwork.cloud_run[0].id
        }
      }

      containers {
        name    = "core-rehearsal"
        image   = var.cloud_run_config.image
        command = ["node"]
        args = [
          "runtime/run-core-rehearsal.mjs",
          "--snapshot",
          local.rehearsal_snapshot_path,
        ]

        resources {
          limits = {
            cpu    = var.cloud_run_config.cpu
            memory = var.cloud_run_config.memory
          }
        }

        env {
          name  = "FCI_APP_ENVIRONMENT"
          value = "production"
        }

        env {
          name  = "FCI_DEPLOYMENT_STAGE"
          value = "staging"
        }

        env {
          name  = "FCI_POSTGRES_ACCESS_MODE"
          value = "rehearsal"
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
          value = var.cloud_run_jobs.rehearsal_database_user
        }

        env {
          name  = "FCI_POSTGRES_PASSWORD_FILE"
          value = "/secrets/postgres/password"
        }

        env {
          name  = "FCI_POSTGRES_SCHEMA"
          value = var.cloud_run_jobs.rehearsal_schema
        }

        env {
          name  = "FCI_POSTGRES_POOL_MAX"
          value = "1"
        }

        env {
          name  = "FCI_REHEARSAL_ACKNOWLEDGMENT"
          value = "FCI TEST — DO NOT USE — I ACKNOWLEDGE THIS NON-PRODUCTION CORE REHEARSAL"
        }

        volume_mounts {
          name       = "postgres-password"
          mount_path = "/secrets/postgres"
        }

        volume_mounts {
          name       = "rehearsal-snapshot"
          mount_path = "/rehearsal"
        }
      }

      volumes {
        name = "postgres-password"

        secret {
          secret = google_secret_manager_secret.core["postgres-rehearsal-password"].secret_id

          items {
            version = var.cloud_run_jobs.rehearsal_postgres_secret_version
            path    = "password"
          }
        }
      }

      volumes {
        name = "rehearsal-snapshot"

        gcs {
          bucket    = var.cloud_run_jobs.rehearsal_snapshot_bucket
          read_only = true
        }
      }
    }
  }

  depends_on = [
    google_project_iam_member.core_identities,
    google_secret_manager_secret_iam_member.rehearsal_postgres,
    google_service_networking_connection.private_vpc,
    google_storage_bucket_iam_member.rehearsal_snapshot_reader,
    terraform_data.deployment_gate,
  ]
}
