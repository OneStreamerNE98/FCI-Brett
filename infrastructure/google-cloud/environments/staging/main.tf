module "foundation" {
  source = "../../modules/foundation"

  enable_core                = var.enable_core
  enable_guardrails          = var.enable_guardrails
  deployment_stage           = "staging"
  owner_inputs               = var.owner_inputs
  network_config             = var.network_config
  cloud_sql_profile          = var.cloud_sql_profile
  cloud_sql_config           = var.cloud_sql_config
  cloud_run_config           = var.cloud_run_config
  budget_amount_usd          = var.budget_amount_usd
  optional_features          = var.optional_features
  optional_feature_approvals = var.optional_feature_approvals
  labels                     = var.labels
}
