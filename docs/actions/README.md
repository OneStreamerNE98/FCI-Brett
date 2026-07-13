# FCI Operations Action Center

This is the owner-facing setup and product-readiness dashboard for the Google Workspace pilot and the later 20-person company rollout. Update the checkboxes as work is completed, but never place passwords, OAuth client secrets, token-encryption keys, refresh tokens, or production client data in GitHub.

## Current status

| Topic | Owner | Status | Next action |
| --- | --- | --- | --- |
| Repository verification | Codex/developer | Complete | GitHub CI builds and tests every push and pull request. |
| Workspace identity inputs | Business owner | Partially complete | Domain is `cherryhillfci.com`; confirm the operations account and initial administrator. |
| Workspace resources | Workspace administrator | Not started | Create the Shared Drive, directory Sheet, mailbox, and two calendars. |
| Google Cloud and OAuth | Workspace/Cloud administrator | Not started | Create the Internal Google Auth application and data-connector client. |
| Hosted pilot connection | Owner + Codex/developer | Blocked by resources | Add hosted configuration, connect one approved account, and verify each service. |
| Staff Google login and roles | Codex/developer | Not implemented | Build on Cloud Run/Cloud SQL after identity policy is approved. |
| 20-user operating/access model | Owner + Workspace administrator | Waiting on owner | Decide staff/field roles and approve the app-to-Google access matrix. |
| Production foundation and migration | Developer + Cloud administrator | Not started | Approve region, budget, recovery targets, hostname, and environments. |
| Operations, recovery, and security | Owner + administrators | Not started | Name runbook owners and approve recovery and retention targets. |
| Frontend multi-user hardening | Codex/developer | Not started | Remove the Gmail label-only bypass, then implement role/freshness/error behavior. |
| Production acceptance | Owner + administrator | Blocked | Complete restore, audit, permission, and lifecycle tests before real data. |
| Codex coworker handoff | Owner + coworker | Ready | Follow the Codex-to-Codex guide and verify the coworker's baseline. |

## Actions by topic

1. [Setup inputs and decisions](00-setup-inputs.md)
2. [Google Workspace accounts and resources](01-workspace-resources.md)
3. [Google Cloud, OAuth, and API controls](02-google-cloud-and-oauth.md)
4. [Hosted pilot configuration and connection](03-hosted-pilot-connection.md)
5. [Staff Google login, roles, and permissions](04-staff-login-and-permissions.md)
6. [Pilot and production acceptance](05-acceptance-checklist.md)
7. [20-user operating model and Google access](06-20-user-operating-model-and-access.md)
8. [Production foundation and migration](07-production-foundation-and-migration.md)
9. [Operations, recovery, and security](08-operations-recovery-and-security.md)
10. [Frontend and multi-user hardening](09-frontend-and-multi-user-hardening.md)
11. [Codex-to-Codex coworker handoff](../codex-to-codex-handoff.md)

Read the [20-user product and architecture review](../20-user-product-and-architecture-review.md) for the evidence, priority findings, corrected delivery order, and product ideas behind these actions.

## Safety boundary

- The current hosted application remains a single-user, test-data pilot.
- Staff login currently uses ChatGPT identity plus an office allowlist.
- The Google data connector and Google employee login are separate integrations.
- Do not add a second user until durable users, sessions, roles, and project permissions exist.
- Do not store real client data until backup restoration, audit coverage, permissions, and the full acceptance lifecycle pass.
