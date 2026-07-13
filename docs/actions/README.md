# FCI Operations Action Center

This is the owner-facing setup dashboard for the Google Workspace pilot and the later company-login rollout. Update the checkboxes as work is completed, but never place passwords, OAuth client secrets, token-encryption keys, refresh tokens, or production client data in GitHub.

## Current status

| Topic | Owner | Status | Next action |
| --- | --- | --- | --- |
| Repository verification | Codex/developer | Complete | GitHub CI builds and tests every push and pull request. |
| Workspace identity inputs | Business owner | Waiting on owner | Record the company domain and proposed connection account. |
| Workspace resources | Workspace administrator | Not started | Create the Shared Drive, directory Sheet, mailbox, and two calendars. |
| Google Cloud and OAuth | Workspace/Cloud administrator | Not started | Create the Internal Google Auth application and data-connector client. |
| Hosted pilot connection | Owner + Codex/developer | Blocked by resources | Add hosted configuration, connect one approved account, and verify each service. |
| Staff Google login and roles | Codex/developer | Not implemented | Build on Cloud Run/Cloud SQL after identity policy is approved. |
| Production acceptance | Owner + administrator | Blocked | Complete restore, audit, permission, and lifecycle tests before real data. |
| Codex coworker handoff | Owner + coworker | Ready | Follow the Codex-to-Codex guide and verify the coworker's baseline. |

## Actions by topic

1. [Setup inputs and decisions](00-setup-inputs.md)
2. [Google Workspace accounts and resources](01-workspace-resources.md)
3. [Google Cloud, OAuth, and API controls](02-google-cloud-and-oauth.md)
4. [Hosted pilot configuration and connection](03-hosted-pilot-connection.md)
5. [Staff Google login, roles, and permissions](04-staff-login-and-permissions.md)
6. [Pilot and production acceptance](05-acceptance-checklist.md)
7. [Codex-to-Codex coworker handoff](../codex-to-codex-handoff.md)

## Safety boundary

- The current hosted application remains a single-user, test-data pilot.
- Staff login currently uses ChatGPT identity plus an office allowlist.
- The Google data connector and Google employee login are separate integrations.
- Do not add a second user until durable users, sessions, roles, and project permissions exist.
- Do not store real client data until backup restoration, audit coverage, permissions, and the full acceptance lifecycle pass.
