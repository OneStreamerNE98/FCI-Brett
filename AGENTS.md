# FCI Operations repository guidance

These instructions apply to the entire repository and are intended to give every Codex instance and human contributor the same operating context.

## Read first

Before changing code, read:

1. `docs/codex-to-codex-handoff.md`
2. `docs/architecture-decision-production-platform.md`
3. `docs/architecture-decision-workspace-first-cost-controlled-rollout.md`
4. `docs/20-user-product-and-architecture-review.md`
5. `docs/complete-product-and-google-cloud-architecture-audit.md`
6. `docs/google-cloud-runtime-foundation.md`
7. `docs/ui-and-product-readiness-review.md`
8. `docs/google-workspace-rollout-guide.md`
9. `docs/task-checklists/README.md`
10. `docs/collaboration-and-sharing.md`

## Current product boundary

- The Sites/Workers/D1/R2 deployment is the controlled, single-user development environment and uses test data only.
- Production will use a small regional Cloud Run/Cloud SQL modular monolith, Secret Manager, Google Workspace OIDC, and application-owned authorization and audit controls. Cloud Tasks, Cloud Scheduler, Gmail Pub/Sub, Calendar HTTPS webhooks, Cloud Storage quarantine/scanning, SMS, and `pgvector` are feature-gated capabilities, not day-one provisioning requirements.
- Follow the [Workspace-first, cost-controlled rollout](docs/architecture-decision-workspace-first-cost-controlled-rollout.md): reuse existing Workspace services, keep Sites as development, keep staging on demand, define both standalone and HA Cloud SQL profiles, and leave optional infrastructure modules disabled and unapplied until approved.
- Preserve the current development deployment, Google Workspace test connector, and existing data unless the owner explicitly approves a migration or destructive change.
- Do not add scheduling, messaging, or AI document indexing before the production platform and authorization foundation is accepted.
- Do not admit a second user or store real client data until users, sessions, roles, project permissions, backup restoration, and audit controls pass acceptance.

## Required workflow

1. Start from an up-to-date, clean `main` branch.
2. Create a `codex/<short-feature-name>` branch.
3. Keep changes scoped and preserve unrelated user work.
4. Run the relevant tests during development and run `npm test` before handoff.
5. Open a pull request with a concise summary, verification evidence, and data/security impact note.
6. Do not deploy, change hosted configuration, migrate data, or merge to production without owner approval.

## Useful commands

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run lint
```

`npm test` includes the production build and the Node test suite. If a command cannot run, record the exact blocker rather than treating unverified work as complete.

## Security and data rules

- Never commit `.env`, `.env.local`, OAuth JSON credentials, client secrets, encryption keys, API keys, access/refresh tokens, production exports, or local databases.
- Use `.env.example` only for variable names and safe placeholders.
- Use records named `FCI TEST — DO NOT USE` for development verification.
- Keep employee login separate from the one company Google Workspace data connector.
- Enforce authorization on the server and inside data queries; hidden UI controls are not authorization.
- Treat Google `sub` as the stable external user identity and verify the signed Workspace `hd` claim for production login.
- Never weaken review-first Gmail filing or automatically send messages.

## Current implementation order

1. Costed, unapplied Google Cloud foundation definitions plus reviewable and testable migration, restore, and cutover procedures; do not provision optional services early.
2. One production-persistence boundary for the remaining Cloud SQL schema/repositories, generic identity/security-audit persistence, integration/file metadata, and provider-neutral object storage.
3. Approved 20-user role model plus cross-system Google access matrix. The owner may complete this in parallel, but it must be accepted before authorization behavior is implemented.
4. Simulated access contexts, secure sessions, capabilities, roles, project-scoped queries, denial tests, and composition of the employee application on the production database/storage boundaries.
5. With separate owner approval, on-demand staging migration, restore, reconciliation, rollback/forward-fix, and application smoke evidence.
6. Google Workspace employee OIDC and live authorization verification only after the platform, persistence, authorization, and staging gates pass; do not admit a second user yet.
7. Client/lead/project editing and archiving, atomic lead conversion, and durable tasks/follow-ups.
8. Operational modules only after the preceding foundations pass acceptance.

## Handoff requirements

At the end of a task, report:

- Branch and commit identifiers
- Files changed and the user-visible outcome
- Tests/build/lint run and their results
- Data, security, configuration, and migration impact
- Remaining blockers or owner actions
- Whether deployment or external configuration was intentionally left unchanged
