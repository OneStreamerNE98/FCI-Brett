# FCI Operations repository guidance

These instructions apply to the entire repository and are intended to give every Codex instance and human contributor the same operating context.

## Read first

Before changing code, read:

1. `docs/codex-to-codex-handoff.md`
2. `docs/architecture-decision-production-platform.md`
3. `docs/20-user-product-and-architecture-review.md`
4. `docs/complete-product-and-google-cloud-architecture-audit.md`
5. `docs/google-cloud-runtime-foundation.md`
6. `docs/ui-and-product-readiness-review.md`
7. `docs/google-workspace-rollout-guide.md`
8. `docs/task-checklists/README.md`
9. `docs/collaboration-and-sharing.md`

## Current product boundary

- The Sites/Workers/D1/R2 deployment is the controlled, single-user development environment and uses test data only.
- Production will use a small regional Cloud Run/Cloud SQL modular monolith, Secret Manager, Cloud Tasks, Cloud Scheduler, application-owned durable failed-job/replay records, Cloud Storage quarantine, Gmail Pub/Sub notifications, Calendar HTTPS webhooks, and Google Workspace OIDC. Add `pgvector` only when document indexing is scheduled.
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

1. Google Cloud production foundation and tested migration/cutover path.
2. Cloud SQL schema and provider-neutral database/storage boundaries.
3. Approved 20-user role model plus cross-system Google access matrix.
4. Google Workspace employee login, secure sessions, capabilities, roles, and project permissions.
5. Client/lead/project editing and archiving, atomic lead conversion, and durable tasks/follow-ups.
6. Operational modules only after the preceding foundations pass acceptance.

## Handoff requirements

At the end of a task, report:

- Branch and commit identifiers
- Files changed and the user-visible outcome
- Tests/build/lint run and their results
- Data, security, configuration, and migration impact
- Remaining blockers or owner actions
- Whether deployment or external configuration was intentionally left unchanged
