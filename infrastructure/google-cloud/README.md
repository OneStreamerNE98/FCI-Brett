# Google Cloud infrastructure definitions

Status: **source-only, reviewable, and unapplied**

These Terraform definitions describe the cost-controlled FCI Operations Google
Cloud boundary. They have not created projects, enabled APIs, changed IAM or
billing, stored secrets, migrated data, connected Workspace, or deployed the
application.

## Safety model

- `environments/development` is intentionally inert. Sites/Workers/D1/R2 stays
  the one-user, test-data development environment; no development Cloud SQL is
  defined.
- Staging and production have separate roots, backend configuration, projects,
  identities, networks, secrets, data, alerts, and state.
- `enable_core` and `enable_guardrails` both default to `false`, so the initial
  default plan declares zero Google resources.
- Core activation requires persistent budget/notification guardrails. Separate
  Terraform activation locks use `prevent_destroy`, so changing either switch
  back to `false` after apply is blocked instead of becoming an accidental
  teardown command. An approved staging teardown requires a reviewed source
  change; guardrails remain until final delayed charges are verified.
- Guardrails are a required first apply: `enable_guardrails = true` with the
  core still false, followed by scope and notification-delivery verification.
  Core activation requires that safe evidence reference, and Cloud SQL depends
  on the created budget control.
- Turning it on fails at the approval gate unless every modeled non-secret
  activation input, the selected database profile, a verified connection
  budget, RPO/RTO, alert recipients, budget, and operational owners are
  supplied. Backend, notification-delivery, network-review, and operational
  evidence still have explicit procedural gates where Terraform cannot prove
  the underlying human outcome.
- The live project lookup must match the approved project ID/number, exact
  organization or folder parent, and billing account before a live plan can
  pass. Budget scope uses the looked-up project number rather than trusting an
  unrelated string.
- No Cloud SQL profile is selected by default. `standalone` maps to `ZONAL` and
  `regional_ha` maps to `REGIONAL` with otherwise identical sizing. HA also
  requires an approved staging exercise; production HA additionally requires an
  accepted regional-outage policy and completed
  [staging failover evidence](../../docs/runbooks/google-cloud/regional-ha-failover.md).
- `cloud_run_config.deploy_service` separately defaults to `false`. The current
  fail-closed image is not the employee application and must not be deployed as
  one. A future approved service plan requires an immutable `@sha256:` image
  from that environment's Terraform-managed Artifact Registry repository and a
  pinned numeric Secret Manager version.
- No `allUsers` Cloud Run invoker grant exists. Public access and application
  authentication must be reviewed together after the employee app is composed.
- Secret Manager containers and resource-level accessor grants are defined;
  runtime, migration, and staging rehearsal database passwords are separate,
  as are employee-login OIDC and the company data-connector OAuth credentials.
  Secret versions and payloads are deliberately not managed by Terraform.
- Terraform defines no database users/passwords and never writes credentials to
  state. The reviewed PostgreSQL role policy remains a separate controlled step.
- Optional capabilities default off. Enabling a flag requires an owner, approval
  reference, cost, monitoring, failure/replay, and disable/rollback record.

## Defined minimum core

When separately approved and enabled for one environment, the reusable module
defines:

- core APIs with `disable_on_destroy = false` so teardown does not disable a
  shared project service unexpectedly;
- a custom VPC, regional Direct VPC egress subnet, explicitly addressed Private
  Service Access range, and private service-networking connection;
- keyless runtime, migration, and staging-only rehearsal service identities;
- separate runtime, migration, and staging rehearsal Secret Manager containers
  with resource-level accessor grants;
- an Artifact Registry Docker repository;
- one private-IP PostgreSQL 16 Enterprise Cloud SQL instance with SSD
  autoresize, backups, PITR, retention, connector enforcement, and production
  deletion protection;
- one Cloud Run v2 modular-monolith service definition with min `0`, max `2`,
  Direct VPC egress, `/readyz` startup/readiness, and `/healthz` liveness probes;
- email notification channels, a project-scoped budget alert, Cloud SQL CPU,
  disk, and connection alerts; a log-based failed/skipped-backup alert; plus a
  Cloud Run 5xx alert when the service is separately enabled.

The module does not create OAuth clients, Google Admin settings, DNS, service
account keys, PostgreSQL principals, secret values, Cloud Run Jobs, or any live
optional-feature resource.

## Environment boundaries

| Boundary | Default | Purpose |
| --- | --- | --- |
| Development | Inert; no provider/resources | Existing Sites app and separately approved Workspace test connector only |
| Staging | Core and guardrails off; `$50/month` planning value | Time-boxed migration, restore, release, or rollback evidence; retain guardrails through post-teardown charge verification |
| Production | Core off; profile/budget unset | Minimum continuously provisioned core after owner approval |

Project creation is owner-controlled and outside these definitions. Supply only
verified project IDs; do not create a duplicate of Brett's reported development
project or assume staging/production projects already exist.

State-bucket creation is also outside these definitions. The checked-in
`backend.hcl.example` files contain invalid placeholders, not a defined or
accepted backend. A live backend remains blocked until a separate review proves
environment isolation, uniform bucket-level access, public-access prevention,
versioning/retention, encryption-key decision, least-privilege state IAM,
keyless plan/apply identity, recovery access, and audit logging. Never attach
state or saved plans to tickets or the repository.

## Review and validation only

Use Terraform 1.15.8. These commands download providers and validate local
source; they do not contact an FCI project or plan resources:

```powershell
terraform fmt -check -recursive infrastructure/google-cloud

terraform -chdir=infrastructure/google-cloud/environments/development init -backend=false
terraform -chdir=infrastructure/google-cloud/environments/development validate

terraform -chdir=infrastructure/google-cloud/environments/staging init -backend=false
terraform -chdir=infrastructure/google-cloud/environments/staging validate
terraform -chdir=infrastructure/google-cloud/environments/staging test

terraform -chdir=infrastructure/google-cloud/environments/production init -backend=false
terraform -chdir=infrastructure/google-cloud/environments/production validate
terraform -chdir=infrastructure/google-cloud/environments/production test
```

Do not run `plan` with real values, initialize a real backend, or run `apply`
without a separate owner-approved procedure. A successful validation is source
evidence only, not migration, restore, security, cost, or deployment acceptance.

## Required future inputs

Before an approved environment plan, record outside public source control:

- project ID/number, exact `organizations/ID` or `folders/ID` parent, billing
  account/owner, and region;
- production hostname and DNS owner;
- alert recipients, the approved estimate-based production budget, and a safe
  reference proving the guardrail-only apply and notification delivery;
- RPO/RTO, maintenance window, database profile, backup location, and usable
  connection limit;
- staging failover-exercise approval when evaluating HA; production HA also
  needs an accepted regional-outage policy and safe completed-evidence reference;
- deployment approver and emergency rollback owner;
- non-overlapping, aligned IPv4 Cloud Run subnet sized `/26` or larger and an
  explicit IPv4 Private Service Access base range with a safe network-review
  reference, plus a separately reviewed backend bucket and keyless state
  identity;
- immutable image digest, database principal, and pinned secret version only
  when Cloud Run deployment is authorized.

See [cost inputs](cost/README.md), [connection budget](CONNECTION-BUDGET.md),
[optional activation gates](OPTIONAL-FEATURES.md), and the
[Google Cloud runbooks](../../docs/runbooks/google-cloud/README.md).

## Official references

- [Google Terraform operational practices](https://docs.cloud.google.com/docs/terraform/best-practices/operations)
- [Cloud SQL private IP](https://docs.cloud.google.com/sql/docs/postgres/configure-private-ip)
- [Cloud SQL high availability](https://docs.cloud.google.com/sql/docs/postgres/high-availability)
- [Cloud Run Direct VPC egress](https://docs.cloud.google.com/run/docs/configuring/vpc-direct-vpc)
- [Cloud Run health checks](https://docs.cloud.google.com/run/docs/configuring/healthchecks)
- [Cloud Run secrets](https://docs.cloud.google.com/run/docs/configuring/services/secrets)
- [Cloud Billing budgets](https://docs.cloud.google.com/billing/docs/how-to/budgets)
