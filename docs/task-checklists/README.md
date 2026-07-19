# FCI Operations Task Checklists

This is the owner-facing setup and product-readiness dashboard for the Google Workspace development environment and the later 20-person company rollout. Update the checkboxes as work is completed, but never place passwords, OAuth client secrets, token-encryption keys, refresh tokens, or production client data in GitHub.

## Current status

| Topic | Owner | Status | Next task |
| --- | --- | --- | --- |
| Repository verification | Codex/developer | Complete | GitHub CI builds and tests every push and pull request. |
| Workspace identity inputs | Business owner | Partially complete | Two initial Administrators are recorded and AdminCRM is confirmed non-shared; verify both managed Workspace identities/immutable subjects, the operations connector account, resource setup, and super-administrator contact. |
| Workspace resources | Workspace administrator | Verification pending; no completed inventory is recorded | Verify the domain, operations account, enabled services, Shared Drive support, directory Sheet, mailbox, and two calendars. |
| Google Cloud and OAuth | Workspace/Cloud administrator | Company-account project candidate reported; Cloud verification pending | Inventory Brett's candidate and bring the non-secret findings back for approval before any API, IAM, billing, OAuth, or Admin-console change. |
| Hosted development connection | Owner + Codex/developer | Not connected; Workspace resource and OAuth verification remain pending | After approval, add hosted configuration, connect one approved account, and verify each service. |
| Staff Google login and roles | Codex/developer | Approved policy; People & Access and Activity are merged, with only their presentation adapter deployed to private Sites development | Keep PostgreSQL migration/grants, Cloud Run employee-session/CSRF composition, live OIDC/providers, and additional users gated. |
| 20-user operating/access model | Owner + Workspace administrator | Application policy approved; Google/lifecycle policy pending | Decide rollout/direct Google reads, name Google Group/lifecycle owners, and later verify direct Google sharing. |
| Production foundation and migration | Developer + Cloud administrator | In progress, source only | Review the employee-route source, finish approved calculator evidence, and obtain remaining owner inputs before any staging apply. |
| Operations, recovery, and security | Owner + administrators | In progress, source only; audit model and minimized viewer are merged | Approve recovery/retention targets and add audit export plus production composition. |
| Frontend multi-user hardening | Codex/developer | PR #32 at `adc79b8` is deployed as private Sites development version 40, including PR #30's Settings rules semantic table at `aa8ed8f`; the source-only `codex/actionable-lists` slice is complete in PR #33 but is not deployed; the source-only `codex/settings-panel-extraction` SET-01 slice is complete in source in PR #35 but is not deployed | Begin SET-02 from the latest `main`, then continue later bounded frontend consolidation. |
| Production acceptance | Owner + administrator | Blocked | Complete restore, audit, permission, and lifecycle tests before real data. |
| Codex coworker handoff | Owner + coworker | Ready | Follow the Codex-to-Codex guide and verify the coworker's baseline. |
| Complete product/integration architecture | Owner + developer + operations | Runtime and first-rollout role boundaries approved; broader decisions open | Approve system boundaries, client access, state machines, messaging/file policy, and authoritative external systems. |

## Immediate owner and administrator handoff

Status reconciled on July 19, 2026 against the PR #32 deployment baseline at `adc79b855041db04cc3ca2a3eb232bc72408d33b`. That exact commit is deployed as private Sites development version 40 and includes PR #30's semantic rules table from `aa8ed8f`. The source-only `codex/actionable-lists` slice is complete in PR #33, and the source-only `codex/settings-panel-extraction` SET-01 slice is complete in source in PR #35; neither is deployed.

### Jason / business owner

Completed July 18, 2026: Jason used the audited **Assign to me** action on the flagged test project and confirmed the corrected project-manager identity and activity evidence. The P0 frontend-integrity action is closed.

1. Review Brett's read-only Google Cloud inventory when it arrives and approve or reject the exact proposed external changes before any API, IAM, billing, OAuth, or Admin-console write.
2. Continue the open owner decisions in [Setup inputs](00-setup-inputs.md), the [20-user operating model](06-20-user-operating-model-and-access.md), and the [complete product architecture checklist](10-complete-product-and-integration-architecture.md).

### Brett / Workspace and Cloud follow-up

1. Complete only the read-only inventory of the reported company Cloud project candidate and return the approved non-secret facts listed in [Google Cloud and OAuth](02-google-cloud-and-oauth.md#what-to-report-back-to-codex).
2. Stop before changing APIs, IAM, billing, OAuth, or Google Admin settings until Jason approves the exact changes.
3. Verify the company Workspace domain, operations connection account, enabled services, Shared Drive support, directory Sheet, and calendars using [Workspace resources](01-workspace-resources.md). Do not send secrets or admit another app user.

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

## Where agent work is tracked

These checklists are owner-facing setup, decision, acceptance, and operations records. Active backend, Workspace, and Settings implementation status lives in the [agent execution plan](../agent-plan-architecture-workspace-and-setup.md); UI remediation status lives in the [design-critique plan](../design-critique-fix-plan.md); and architecture branch history and gates live in the [complete architecture audit roadmap](../complete-product-and-google-cloud-architecture-audit.md#ordered-branch-sized-implementation-roadmap). The root [README](../../README.md#prioritized-next-work) is the entry point. Pull requests and issues may mirror those ledgers for review, but they do not create a separate task list.

## Recommended next work

The agent ledgers above own sequencing. The accessible actionable-list pattern for the whole-row Overview pipeline, Projects, and Clients views is complete in PR #33 from the source-only `codex/actionable-lists` branch. The Settings-only SET-01 extraction is complete in source in PR #35 from the source-only `codex/settings-panel-extraction` branch; SET-02 is the next Settings packet from the latest `main`. Provider-neutral job/sync contracts and local migration-fixture work may proceed only within the boundaries recorded in the agent execution plan; no checklist item here authorizes a live provider, staging run, or deployment.

Build `codex/admin-field-links` only when the field-assignment workflow is scheduled. See the [Administration and Access plan](../administration-and-access-plan.md).

Private Sites development version 40 is the latest controlled release. PR #32 merged at `adc79b8`, and that exact deployed commit includes PR #30's semantic-table slice at `aa8ed8f`. The source-only `codex/actionable-lists` branch is complete in PR #33, and the source-only `codex/settings-panel-extraction` SET-01 slice is complete in source in PR #35; neither is deployed. None of the remaining steps above authorizes production deployment, live OIDC/session issuance, staging execution, a migration or infrastructure apply, a second user, or real data.

## Safety boundary

- The current hosted application remains a single-user development environment using test data.
- Staff login currently uses ChatGPT identity plus an office allowlist.
- The Google data connector and Google employee login are separate integrations.
- Do not add a second user until durable admission/session issuance, roles, project permissions, route/browser denial evidence, and staging/recovery gates pass.
- Do not store real client data until backup restoration, audit coverage, permissions, and the full acceptance lifecycle pass.
