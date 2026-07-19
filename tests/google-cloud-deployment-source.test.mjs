import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repositoryUrl = new URL("../", import.meta.url);
const readRepositoryFile = (path) => readFile(new URL(path, repositoryUrl), "utf8");

const [
  deploymentDefinitions,
  deploymentVariables,
  foundationMain,
  stagingMain,
  productionMain,
  stagingVariables,
  productionVariables,
  stagingExample,
  productionExample,
  imageWorkflow,
  ciWorkflow,
  migrationRunbook,
] = await Promise.all([
  readRepositoryFile("infrastructure/google-cloud/modules/foundation/deployment.tf"),
  readRepositoryFile("infrastructure/google-cloud/modules/foundation/deployment-variables.tf"),
  readRepositoryFile("infrastructure/google-cloud/modules/foundation/main.tf"),
  readRepositoryFile("infrastructure/google-cloud/environments/staging/main.tf"),
  readRepositoryFile("infrastructure/google-cloud/environments/production/main.tf"),
  readRepositoryFile("infrastructure/google-cloud/environments/staging/deployment-variables.tf"),
  readRepositoryFile("infrastructure/google-cloud/environments/production/deployment-variables.tf"),
  readRepositoryFile("infrastructure/google-cloud/environments/staging/staging.tfvars.example"),
  readRepositoryFile("infrastructure/google-cloud/environments/production/production.tfvars.example"),
  readRepositoryFile(".github/workflows/cloud-run-image.yml"),
  readRepositoryFile(".github/workflows/ci.yml"),
  readRepositoryFile("docs/runbooks/google-cloud/migration-cutover-and-recovery.md"),
]);

const countMatches = (value, pattern) => value.match(pattern)?.length ?? 0;

test("every deployment mechanism is independently absent by default", () => {
  for (const variables of [deploymentVariables, stagingVariables, productionVariables]) {
    assert.match(variables, /enable_identity\s*=\s*false/);
    assert.match(variables, /deploy_migration_job\s*=\s*false/);
    assert.match(variables, /deploy_rehearsal_job\s*=\s*false/);
  }

  for (const example of [stagingExample, productionExample]) {
    assert.match(example, /^\s*enable_identity\s*=\s*false$/m);
    assert.match(example, /^\s*deploy_migration_job\s*=\s*false$/m);
    assert.match(example, /^\s*deploy_rehearsal_job\s*=\s*false$/m);
  }

  for (const root of [stagingMain, productionMain]) {
    assert.match(root, /deployment_config\s*=\s*var\.deployment_config/);
    assert.match(root, /cloud_run_jobs\s*=\s*var\.cloud_run_jobs/);
  }

  assert.match(
    deploymentDefinitions,
    /deployment_resource_requested[\s\S]*?var\.deployment_config\.enable_identity[\s\S]*?var\.cloud_run_config\.deploy_service[\s\S]*?var\.cloud_run_jobs\.deploy_migration_job[\s\S]*?var\.cloud_run_jobs\.deploy_rehearsal_job/,
  );
  assert.equal(countMatches(ciWorkflow, /terraform test/g), 4);
});

test("the image publisher is keyless, immutable-repository scoped, and cannot deploy", () => {
  assert.match(deploymentDefinitions, /resource "google_service_account" "deployment"/);
  assert.match(
    deploymentDefinitions,
    /resource "google_service_account_iam_member" "deployment_workload_identity"[\s\S]*?roles\/iam\.workloadIdentityUser/,
  );
  assert.match(
    deploymentDefinitions,
    /resource "google_artifact_registry_repository_iam_member" "deployment_writer"[\s\S]*?roles\/artifactregistry\.writer/,
  );
  assert.ok(
    deploymentDefinitions.includes(
      "projects/${var.owner_inputs.project_number}/locations/global/workloadIdentityPools/",
    ),
  );
  assert.ok(deploymentDefinitions.includes("attribute\\\\.repository_id/1298731126"));
  assert.match(
    deploymentDefinitions,
    /assertion\.repository_id == '1298731126'[\s\S]*?assertion\.ref == 'refs\/heads\/main'[\s\S]*?assertion\.environment/,
  );
  assert.match(foundationMain, /"iamcredentials\.googleapis\.com"/);
  assert.match(foundationMain, /"sts\.googleapis\.com"/);

  const completeFoundation = `${foundationMain}\n${deploymentDefinitions}`;
  assert.doesNotMatch(completeFoundation, /google_service_account_key/);
  assert.doesNotMatch(completeFoundation, /roles\/run\.(?:admin|developer|invoker)/);
  assert.doesNotMatch(completeFoundation, /google_cloud_run_(?:v2_)?(?:service|job)_iam/);
  assert.doesNotMatch(completeFoundation, /allUsers/);
});

test("migration and staging rehearsal Jobs are bounded definitions, never executions", () => {
  assert.match(
    deploymentDefinitions,
    /resource "google_cloud_run_v2_job" "migration"[\s\S]*?count\s*=\s*local\.migration_job_enabled/,
  );
  assert.match(
    deploymentDefinitions,
    /resource "google_cloud_run_v2_job" "rehearsal"[\s\S]*?count\s*=\s*local\.rehearsal_job_enabled/,
  );
  assert.equal(countMatches(deploymentDefinitions, /task_count\s*=\s*1/g), 2);
  assert.equal(countMatches(deploymentDefinitions, /parallelism\s*=\s*1/g), 2);
  assert.equal(countMatches(deploymentDefinitions, /max_retries\s*=\s*0/g), 2);
  assert.equal(countMatches(deploymentDefinitions, /name\s*=\s*"FCI_POSTGRES_POOL_MAX"[\s\S]*?value\s*=\s*"1"/g), 2);
  assert.equal(countMatches(deploymentDefinitions, /image\s*=\s*var\.cloud_run_config\.image/g), 2);
  assert.match(deploymentDefinitions, /args\s*=\s*\["runtime\/run-migrations\.mjs"\]/);
  assert.match(deploymentDefinitions, /name\s*=\s*"FCI_POSTGRES_ACCESS_MODE"\s+value\s*=\s*"migration"/);
  assert.match(deploymentDefinitions, /name\s*=\s*"FCI_POSTGRES_MIGRATION_ROLE"/);
  assert.match(deploymentDefinitions, /"runtime\/run-core-rehearsal\.mjs"[\s\S]*?"--snapshot"/);
  assert.match(deploymentDefinitions, /name\s*=\s*"FCI_POSTGRES_ACCESS_MODE"\s+value\s*=\s*"rehearsal"/);
  assert.match(deploymentDefinitions, /\^fci_rehearsal_/);
  assert.match(deploymentDefinitions, /gcs\s*\{[\s\S]*?read_only\s*=\s*true/);
  assert.match(deploymentDefinitions, /roles\/storage\.objectViewer/);
  assert.match(deploymentDefinitions, /FCI TEST — DO NOT USE/);
  assert.doesNotMatch(deploymentDefinitions, /(?:start|run)_execution_token/);
  assert.doesNotMatch(deploymentDefinitions, /google_cloud_run_v2_job_iam/);
});

test("image CI builds pull requests and only publishes approved main dispatches", () => {
  const triggerBlock = imageWorkflow.match(/on:\s*\n([\s\S]*?)\npermissions:/)?.[1] ?? "";
  assert.match(triggerBlock, /pull_request:/);
  assert.match(triggerBlock, /workflow_dispatch:/);
  assert.doesNotMatch(triggerBlock, /^\s*push:/m);
  assert.equal(countMatches(imageWorkflow, /docker push/g), 1);
  assert.match(
    imageWorkflow,
    /if: github\.event_name == 'workflow_dispatch' && inputs\.publish == true && github\.ref == 'refs\/heads\/main'/,
  );
  assert.match(imageWorkflow, /environment: fci-cloud-run-image-\$\{\{ inputs\.target_environment \}\}/);
  assert.match(imageWorkflow, /uses: google-github-actions\/auth@v3/);
  assert.match(imageWorkflow, /token_format: access_token/);
  assert.match(imageWorkflow, /access_token_lifetime: 300s/);
  assert.match(imageWorkflow, /create_credentials_file: false/);
  assert.match(imageWorkflow, /export_environment_variables: false/);
  assert.match(imageWorkflow, /docker inspect --format=/);
  assert.doesNotMatch(imageWorkflow, /^\s*(?:terraform\s+apply|gcloud\s+run\s+(?:deploy|jobs\s+execute))/m);
});

test("the runbook truthfully keeps execution owner-gated", () => {
  assert.doesNotMatch(migrationRunbook, /no Cloud Run Job, deployment identity, image-build/);
  assert.match(migrationRunbook, /source-only\s+and unapplied/);
  assert.match(migrationRunbook, /cannot apply\s+Terraform, deploy a service, or execute a Job/);
  assert.match(migrationRunbook, /Every execution step remains blocked/);
});
