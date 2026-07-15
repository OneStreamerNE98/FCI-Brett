import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const infrastructureUrl = new URL("../infrastructure/google-cloud/", import.meta.url);
const readInfrastructureFile = (path) => readFile(new URL(path, infrastructureUrl), "utf8");

const [
  developmentMain,
  developmentVariables,
  stagingVariables,
  productionVariables,
  stagingExample,
  productionExample,
  foundationMain,
  foundationVariables,
  foundationVersions,
  activationLockExpected,
  ciWorkflow,
] = await Promise.all([
  readInfrastructureFile("environments/development/main.tf"),
  readInfrastructureFile("environments/development/variables.tf"),
  readInfrastructureFile("environments/staging/variables.tf"),
  readInfrastructureFile("environments/production/variables.tf"),
  readInfrastructureFile("environments/staging/staging.tfvars.example"),
  readInfrastructureFile("environments/production/production.tfvars.example"),
  readInfrastructureFile("modules/foundation/main.tf"),
  readInfrastructureFile("modules/foundation/variables.tf"),
  readInfrastructureFile("modules/foundation/versions.tf"),
  readInfrastructureFile("modules/foundation/expected-failure-tests/activation-lock.tftest.hcl"),
  readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
]);

test("development remains an inert Sites boundary", () => {
  assert.doesNotMatch(developmentMain, /\b(?:provider|resource)\s+"google/);
  assert.match(developmentMain, /application_runtime\s*=\s*"sites-workers-d1-r2"/);
  assert.match(developmentMain, /persistent_cloud_sql_allowed\s*=\s*false/);
  assert.match(developmentMain, /resource_creation_enabled\s*=\s*false/);
  assert.match(
    developmentVariables,
    /variable "enable_google_resources"[\s\S]*?default\s*=\s*false[\s\S]*?var\.enable_google_resources == false/,
  );
});

test("staging and production plans are disabled and undecided by default", () => {
  for (const variables of [stagingVariables, productionVariables]) {
    assert.match(variables, /variable "enable_core"[\s\S]*?default\s*=\s*false/);
    assert.match(variables, /variable "enable_guardrails"[\s\S]*?default\s*=\s*false/);
    assert.match(variables, /variable "cloud_sql_profile"[\s\S]*?default\s*=\s*null/);
    assert.match(variables, /usable_connection_budget\s*=\s*0/);
  }
  for (const example of [stagingExample, productionExample]) {
    assert.match(example, /^enable_core\s*=\s*false$/m);
    assert.match(example, /^enable_guardrails\s*=\s*false$/m);
    assert.match(example, /^cloud_sql_profile\s*=\s*null$/m);
  }
  for (const variables of [stagingVariables, productionVariables]) {
    for (const feature of [
      "cloud_tasks",
      "cloud_scheduler",
      "gmail_pubsub",
      "calendar_webhooks",
      "upload_quarantine",
      "sms",
      "pgvector",
    ]) {
      assert.match(variables, new RegExp(`^\\s*${feature}\\s*=\\s*false$`, "m"));
    }
  }
  assert.match(stagingVariables, /variable "budget_amount_usd"[\s\S]*?default\s*=\s*50/);
  assert.match(productionVariables, /variable "budget_amount_usd"[\s\S]*?default\s*=\s*0/);
});

test("the approval gate rejects incomplete, uncosted, or unbounded activation", () => {
  assert.match(foundationMain, /resource "terraform_data" "approval_gate"/);
  assert.match(foundationMain, /count\s*=\s*var\.enable_core \|\| var\.enable_guardrails \? 1 : 0/);
  assert.match(foundationMain, /condition\s*=\s*local\.approval_values_complete/);
  assert.match(foundationMain, /condition\s*=\s*var\.budget_amount_usd > 0/);
  assert.ok(foundationMain.includes("!var.enable_core || var.cloud_sql_profile != null"));
  assert.ok(
    foundationMain.includes(
      "local.planned_connection_total <= var.cloud_sql_config.usable_connection_budget",
    ),
  );
  assert.ok(foundationMain.includes("!var.enable_core || local.optional_approvals_complete"));
  assert.match(foundationMain, /@sha256:\[0-9a-f\]\{64\}/);
  assert.match(foundationMain, /startswith\(var\.cloud_run_config\.image/);
  assert.ok(
    foundationMain.includes(
      'can(regex("^[1-9][0-9]*$", var.cloud_run_config.postgres_secret_version))',
    ),
  );
  for (const lock of ["guardrail_activation_lock", "core_activation_lock"]) {
    assert.match(
      foundationMain,
      new RegExp(`resource "terraform_data" "${lock}"[\\s\\S]*?prevent_destroy\\s*=\\s*true`),
    );
  }
  assert.match(foundationMain, /data "google_project" "target"/);
  assert.match(foundationMain, /data\.google_project\.target\[0\]\.number == var\.owner_inputs\.project_number/);
  assert.match(
    foundationVariables,
    /cloud_run_subnet_cidr[\s\S]*?tonumber\(split\("\/", var\.network_config\.cloud_run_subnet_cidr\)\[1\]\) <= 26/,
  );
  assert.match(
    foundationVariables,
    /private_service_range_address[\s\S]*?can\(regex\("\^\(\[0-9\]\{1,3\}\\\\\.\)\{3\}/,
  );
});

test("Cloud SQL definitions stay private, recoverable, and profile-selectable", () => {
  assert.match(foundationVersions, /version\s*=\s*"= 7\.40\.0"/);
  assert.match(foundationMain, /database_version\s*=\s*"POSTGRES_16"/);
  assert.match(foundationMain, /edition\s*=\s*"ENTERPRISE"/);
  assert.match(
    foundationMain,
    /availability_type\s*=\s*var\.cloud_sql_profile == "regional_ha" \? "REGIONAL" : "ZONAL"/,
  );
  assert.match(foundationMain, /connector_enforcement\s*=\s*"REQUIRED"/);
  assert.match(foundationMain, /ipv4_enabled\s*=\s*false/);
  assert.match(foundationMain, /private_network\s*=\s*google_compute_network\.application\[0\]\.id/);
  assert.match(foundationMain, /point_in_time_recovery_enabled\s*=\s*true/);
  assert.match(foundationMain, /location\s*=\s*var\.cloud_sql_config\.backup_location/);
  assert.match(foundationMain, /deletion_protection\s*=\s*var\.deployment_stage == "production"/);
  assert.match(foundationMain, /ignore_changes\s*=\s*\[settings\[0\]\.disk_size\]/);
  assert.doesNotMatch(foundationMain, /enable_private_path_for_google_cloud_services/);
});

test("Cloud Run is bounded, private-data-only, and separately gated", () => {
  assert.match(
    foundationVariables,
    /var\.cloud_run_config\.min_instances == 0[\s\S]*?var\.cloud_run_config\.max_instances <= 2/,
  );
  assert.match(
    foundationMain,
    /resource "google_cloud_run_v2_service" "application"[\s\S]*?var\.enable_core && var\.cloud_run_config\.deploy_service/,
  );
  assert.match(foundationMain, /egress\s*=\s*"PRIVATE_RANGES_ONLY"/);
  assert.match(foundationMain, /mount_path\s*=\s*"\/secrets\/postgres"/);
  assert.match(foundationMain, /startup_probe[\s\S]*?path\s*=\s*"\/readyz"/);
  assert.match(foundationMain, /readiness_probe[\s\S]*?path\s*=\s*"\/readyz"/);
  assert.match(foundationMain, /liveness_probe[\s\S]*?path\s*=\s*"\/healthz"/);
  assert.doesNotMatch(foundationMain, /google_cloud_run_(?:v2_)?service_iam/);
  assert.doesNotMatch(foundationMain, /allUsers/);
  assert.doesNotMatch(foundationMain, /resource "google_secret_manager_secret_version"/);
  for (const secret of [
    "postgres-runtime-password",
    "postgres-migration-password",
    "postgres-rehearsal-password",
    "employee-oidc-client-secret",
    "workspace-oauth-client-secret",
  ]) {
    assert.match(foundationMain, new RegExp(secret));
  }
  assert.doesNotMatch(foundationMain, /\["postgres-password"\]/);
  assert.match(
    foundationMain,
    /resource "google_monitoring_alert_policy" "cloud_sql_backup_failure"[\s\S]*?condition_matched_log/,
  );
});

test("CI validates formatting and mocked plans without cloud credentials", () => {
  assert.match(ciWorkflow, /name: Terraform source validation/);
  assert.match(ciWorkflow, /terraform fmt -check -recursive infrastructure\/google-cloud/);
  assert.match(ciWorkflow, /terraform init -backend=false -input=false/);
  assert.equal((ciWorkflow.match(/terraform test/g) ?? []).length, 4);
  assert.match(activationLockExpected, /command\s*=\s*apply[\s\S]*?enable_core\s*=\s*false/);
  assert.match(ciWorkflow, /core_activation_lock\[0\]/);
  assert.match(ciWorkflow, /lifecycle\.prevent_destroy/);
});
