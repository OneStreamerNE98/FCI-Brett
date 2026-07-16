# FCI Operations Task Checklists

This is the owner-facing setup and product-readiness dashboard for the Google Workspace development environment and the later 20-person company rollout. Update the checkboxes as work is completed, but never place passwords, OAuth client secrets, token-encryption keys, refresh tokens, or production client data in GitHub.

## Current status

| Topic | Owner | Status | Next task |
| --- | --- | --- | --- |
| Repository verification | Codex/developer | Complete | GitHub CI builds and tests every push and pull request. |
| Workspace identity inputs | Business owner | Partially complete | Two initial Administrators are recorded and AdminCRM is confirmed non-shared; verify both managed Workspace identities/immutable subjects, the operations connector account, resource setup, and super-administrator contact. |
| Workspace resources | Workspace administrator | Not started | Create the Shared Drive, directory Sheet, mailbox, and two calendars. |
| Google Cloud and OAuth | Workspace/Cloud administrator | Company-account project candidate reported; Cloud verification pending | Inventory Brett's candidate and bring the non-secret findings back for approval before any API, IAM, billing, OAuth, or Admin-console change. |
| Hosted development connection | Owner + Codex/developer | Blocked by resources | Add hosted configuration, connect one approved account, and verify each service. |
| Staff Google login and roles | Codex/developer | Approved policy and source-only employee routes implemented; OIDC/session issuance/providers pending | Review the Cloud Run route boundary; keep migration/apply, deployment, live OIDC, and additional users gated. |
| 20-user operating/access model | Owner + Workspace administrator | Application policy approved; Google/lifecycle policy pending | Decide rollout/direct Google reads, name Google Group/lifecycle owners, and later verify direct Google sharing. |
| Production foundation and migration | Developer + Cloud administrator | In progress, source only | Review the employee-route source, finish approved calculator evidence, and obtain remaining owner inputs before any staging apply. |
| Operations, recovery, and security | Owner + administrators | Not started | Name runbook owners and approve recovery and retention targets. |
| Frontend multi-user hardening | Codex/developer | In progress | Cloud Run dashboard/search/project/client/logout APIs are source-composed; connect an approved identity/UI only after platform gates, then add freshness, durable URLs, and conflict handling. |
| Production acceptance | Owner + administrator | Blocked | Complete restore, audit, permission, and lifecycle tests before real data. |
| Codex coworker handoff | Owner + coworker | Ready | Follow the Codex-to-Codex guide and verify the coworker's baseline. |
| Complete product/integration architecture | Owner + developer + operations | Runtime boundary approved; broader decisions open | Approve system boundaries, roles, state machines, messaging/file policy, and authoritative external systems. |

## Checklists by topic

1. [Setup inputs and decisions](00-setup-inputs.md)
2. [Google Workspace accounts and resources](01-workspace-resources.md)
3. [Google Cloud, OAuth, and API controls](02-google-cloud-and-oauth.md)
4. [Hosted development configuration and connection](03-hosted-development-connection.md)
5. [Staff Google login, roles, and permissions](04-staff-login-and-permissions.md)
6. [Development and production acceptance](05-acceptance-checklist.md)
7. [20-user operating model and Google access](06-20-user-operating-model-and-access.md)
8. [Production foundation and migration](07-production-foundation-and-migration.md)
9. [Operations, recovery, and security](08-operations-recovery-and-security.md)
10. [Frontend and multi-user hardening](09-frontend-and-multi-user-hardening.md)
11. [Complete product and integration architecture](10-complete-product-and-integration-architecture.md)
12. [Codex-to-Codex coworker handoff](../codex-to-codex-handoff.md)

Read the [20-user product and architecture review](../20-user-product-and-architecture-review.md) for the evidence, priority findings, corrected delivery order, and product ideas behind these task checklists.

Read the [complete product and Google Cloud architecture audit](../complete-product-and-google-cloud-architecture-audit.md) for the capability map, Google Cloud topology, texting/reminder design, integration reliability requirements, owner decisions, acceptance gates, and branch-sized implementation order.

Read the accepted [Workspace-first, cost-controlled rollout](../architecture-decision-workspace-first-cost-controlled-rollout.md) before approving infrastructure work. It distinguishes isolated environment boundaries from running resources and records the cost and feature-activation gates.

Use the [Pre-Workspace development plan](../pre-workspace-development-plan.md) to separate work that can be built with simulation now from owner decisions and live-connection tasks that require Workspace resources or credentials.

## Recommended next source branches

1. Review and merge the source-only Cloud Run employee-route boundary. Dashboard, search, project list/exact-project, client list, and logout are PostgreSQL-backed in source; file, Gmail, and Calendar paths are authorization-gated but provider-unavailable.
2. Build `codex/admin-access-persistence` and `codex/admin-access-api` for versioned invitations, disablement, role/project assignment, session revocation, and global Office/Project Manager settings. Keep arbitrary/per-user grants impossible and protect the final active Administrator.
3. Build Field Lead links and the audit reader in separate least-privilege branches: `codex/field-link-persistence` and `codex/admin-audit-reader`.
4. Build `codex/admin-access-page` under Management → Administration & Access, followed by `codex/admin-access-acceptance` for policy preview, session invalidation, CSRF, concurrency, direct-route, responsive/accessibility, and rendered browser evidence.

None of these steps authorizes OIDC, session issuance, a migration or infrastructure apply, deployment, a second user, or real data.

## Safety boundary

- The current hosted application remains a single-user development environment using test data.
- Staff login currently uses ChatGPT identity plus an office allowlist.
- The Google data connector and Google employee login are separate integrations.
- Do not add a second user until durable admission/session issuance, roles, project permissions, route/browser denial evidence, and staging/recovery gates pass.
- Do not store real client data until backup restoration, audit coverage, permissions, and the full acceptance lifecycle pass.
