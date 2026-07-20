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
| Staff Google login and roles | Codex/developer | Approved policy, People & Access, Activity, and the complete Workspace OIDC source preconditions are merged; only the People/Activity presentation adapter is deployed to private Sites development | PRs #54/#55 are merged source-only and undeployed. Keep live configuration, migration/grant apply, production UI composition, deployment, owner acceptance, and additional users gated. |
| 20-user operating/access model | Owner + Workspace administrator | Application policy approved; Google/lifecycle policy pending | Decide rollout/direct Google reads, name Google Group/lifecycle owners, and later verify direct Google sharing. |
| Production foundation and migration | Developer + Cloud administrator | In progress, source only | Review BE-09 draft PR #51 and BE-12 draft PR #53; finish approved calculator evidence and owner inputs before any staging apply. |
| Operations, recovery, and security | Owner + administrators | In progress, source only; audit model and minimized viewer are merged | Approve recovery/retention targets and add audit export plus production composition. |
| Frontend multi-user hardening | Codex/developer | PR #32 at `adc79b8` is deployed as private Sites development version 40; later merged UI source remains undeployed | Review open KPI-02 PR #52, which occupies the sole `FloorOpsApp.tsx` slot, plus SET-10/#56 and logo refresh/#57; none is merged or deployed. |
| Production acceptance | Owner + administrator | Blocked | Complete restore, audit, permission, and lifecycle tests before real data. |
| Codex coworker handoff | Owner + coworker | Ready | Follow the Codex-to-Codex guide and verify the coworker's baseline. |
| Complete product/integration architecture | Owner + developer + operations | Runtime and first-rollout role boundaries approved; broader decisions open | Approve system boundaries, client access, state machines, messaging/file policy, and authoritative external systems. |

## Immediate owner and administrator handoff

Status reconciled on July 20, 2026 against merged source baseline `main` at `b067699b7a9100aaf8adb0ea8c43816fe8dac03f` and the separate PR #32 deployment baseline at `adc79b855041db04cc3ca2a3eb232bc72408d33b`.
The deployed commit remains private Sites development version 40 and includes PR #30's semantic rules table from `aa8ed8f`. The `codex/actionable-lists` slice is complete in source in PR #33 and is not deployed. The `codex/settings-panel-extraction` SET-01 slice is complete in source in PR #35 and is not deployed; the later source-only packets through PR #48 are likewise merged and undeployed.
PR #49 completed OIDC-04's documentation reconciliation, PR #50 guarded that completed status, PR #60 reconciled OIDC-02 tracking, PR #61 updated the Fable review instructions, and PR #62 reconciled OIDC-03 tracking.
PRs #63/#64 added the dashboard-driven Workspace setup workstream, and PR #65 codified the multi-agent coordination protocol.
PR #66 completed TRK-02 tracking-guard hardening.
OIDC-02 in PR #54 and OIDC-03 in PR #55 are merged. PRs #54/#55 are source-only and undeployed.
Draft PRs #51–#53 and #56–#57 remain unmerged and undeployed.
No merge or draft authorizes live identity/provider configuration, infrastructure or migration apply, image publication, job execution, or deployment.

### Jason / business owner

Completed July 18, 2026: Jason used the audited **Assign to me** action on the flagged test project and confirmed the corrected project-manager identity and activity evidence. The P0 frontend-integrity action is closed.

1. Review Brett's read-only Google Cloud inventory when it arrives and approve or reject the exact proposed external changes before any API, IAM, billing, OAuth, or Admin-console write.
2. Continue the open owner decisions in [Setup inputs](00-setup-inputs.md), the [20-user operating model](06-20-user-operating-model-and-access.md), and the [complete product architecture checklist](10-complete-product-and-integration-architecture.md).

### Brett / Workspace and Cloud follow-up

1. Complete only the read-only inventory of the reported company Cloud project candidate and return the approved non-secret facts listed in [Google Cloud and OAuth](02-google-cloud-and-oauth.md#what-to-report-back-to-codex).
2. Stop before changing APIs, IAM, billing, OAuth, or Google Admin settings until Jason approves the exact changes.
3. Verify the company Workspace domain, operations connection account, enabled services, Shared Drive support, directory Sheet, and calendars using [Workspace resources](01-workspace-resources.md). Do not send secrets or admit another app user.

## Current GitHub review snapshot

This dated snapshot describes review work only; it does not change any owner checkbox or mark remaining unmerged source complete.

| PR | Packet | Review state and dependency |
| --- | --- | --- |
| [#51](https://github.com/OneStreamerNE98/FCI-Brett/pull/51) | BE-09 production core-record routes | Open draft against `main`; BE-10/BE-14 wait for its merge. |
| [#52](https://github.com/OneStreamerNE98/FCI-Brett/pull/52) | KPI-02 flooring booking inputs and reports | Open draft against `main`; occupies the sole `FloorOpsApp.tsx` slot, and KPI-03 waits. |
| [#53](https://github.com/OneStreamerNE98/FCI-Brett/pull/53) | BE-12 rehearsal inventory | Open draft against `main`; no hosted staging rehearsal, migration apply, or live-data operation is implied. |
| [#54](https://github.com/OneStreamerNE98/FCI-Brett/pull/54) | OIDC-02 verifier/cookie hardening | Merged into `main`; source-only and undeployed. |
| [#55](https://github.com/OneStreamerNE98/FCI-Brett/pull/55) | OIDC-03 login security test backfill | Merged into `main`; source-only and undeployed. |
| [#56](https://github.com/OneStreamerNE98/FCI-Brett/pull/56) | SET-10 Workspace connection health | Open draft against `main`; does not complete the broader operations-health checklist. |
| [#57](https://github.com/OneStreamerNE98/FCI-Brett/pull/57) | Application logo asset refresh | Open draft against `main`; static UI assets and review documentation only. |
| [#66](https://github.com/OneStreamerNE98/FCI-Brett/pull/66) | TRK-02 tracking-guard hardening | Merged into `main`; source-only and undeployed. |

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

The agent ledgers above own sequencing. OIDC-04 is complete in PRs #49/#50, and PRs #54/#55 completed the source OIDC preconditions.
TRK-02 is complete in PR #66.
Continue the reviewed merge order #51 → #53 → #52 → #56 → #57. The still-unclaimed independent packets are coordinated BE-07+SET-05, SET-11, SET-09+WS-10, and WS-13. BE-10/BE-14 wait for #51, while KPI-03 waits for #52. No checklist item here authorizes a live provider, staging run, migration/apply, production UI composition, owner acceptance, or deployment.

Build `codex/admin-field-links` only when the field-assignment workflow is scheduled. See the [Administration and Access plan](../administration-and-access-plan.md).

Private Sites development version 40 is the latest controlled release. PR #32 merged at `adc79b8`, and that exact deployed commit includes PR #30's semantic-table slice at `aa8ed8f`. Later source through PR #48, documentation reconciliation through PR #50, OIDC-02/OIDC-03 in PRs #54/#55, and TRK-02 in PR #66 are merged but undeployed.
Drafts #51–#53 and #56–#57 remain unmerged and undeployed. None of the remaining steps above authorizes production deployment, live OIDC/session admission, staging execution, a migration or infrastructure apply, a second user, or real data.

## Safety boundary

- The current hosted application remains a single-user development environment using test data.
- Staff login currently uses ChatGPT identity plus an office allowlist.
- The Google data connector and Google employee login are separate integrations.
- Do not add a second user until durable admission/session issuance, roles, project permissions, route/browser denial evidence, and staging/recovery gates pass.
- Do not store real client data until backup restoration, audit coverage, permissions, and the full acceptance lifecycle pass.
