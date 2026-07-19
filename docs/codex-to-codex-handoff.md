# Codex-to-Codex project handoff

This guide lets a coworker use their own Codex installation against the same FCI Operations repository, with the same durable project instructions and development workflow.

OpenAI describes a Codex project as a project linked to a folder on the user's computer. The repository is therefore the shared collaboration layer: each coworker clones it locally and adds that local folder as their own Codex project. Conversation history and personal Codex settings do not automatically travel with the repository.

The GitHub repository is currently **public**, so anyone can read its source and documentation or fork it to propose a pull request. A coworker still needs explicit collaborator access to push an assigned branch directly to this repository as an authorized company contributor. The owner should decide whether to return it to private before operational configuration begins; public or private, secrets and real company/client data never belong in Git.

Official references:

- [Working with ChatGPT Codex](https://openai.com/academy/working-with-codex/)
- [Get started with Codex](https://openai.com/codex/get-started/)
- [Introducing the Codex app](https://openai.com/index/introducing-the-codex-app/)

## What is shared

| Shared through GitHub | Not shared automatically |
| --- | --- |
| Source code and Git history | Existing Codex conversations |
| `AGENTS.md` repository instructions | Personal Codex settings and memories |
| Architecture, rollout, and task-checklist documents | ChatGPT account or subscription |
| Branches, commits, pull requests, and CI results | Local `.env.local` or credentials |
| Safe configuration examples | Hosted secrets and Google tokens |

Never share one ChatGPT login. Every coworker signs in to Codex with their own account and receives separate GitHub access.

## Owner: prepare the handoff

- [ ] Invite the coworker's GitHub account to `OneStreamerNE98/FCI-Brett` with contributor access so they can push assigned branches.
- [ ] Confirm they can clone the repository and that their intended write access works before sending the assignment.
- [ ] Give contributor access, not repository-administrator access, unless administration is part of their job.
- [ ] Assign one bounded milestone and name the expected branch.
- [ ] Keep production secrets and deployment authority with the owner or approved administrator.
- [ ] Do not email a ZIP, copy `node_modules`, or provide `.env.local`.

## Coworker: install and clone

1. Install the Codex app and sign in with the coworker's own ChatGPT account.
2. Clone the repository once to a normal local development folder. Prefer a non-synchronized folder for a new clone, but the important rule is to keep one canonical editable clone:

   ```powershell
   cd "$HOME\Documents"
   git clone https://github.com/OneStreamerNE98/FCI-Brett.git
   cd FCI-Brett
   ```

3. Confirm Git access and the starting state:

   ```powershell
   git remote -v
   git status --short --branch
   git log -3 --oneline
   ```

4. Install the locked dependencies and verify the baseline:

   ```powershell
   npm.cmd ci
   npm.cmd test
   ```

Do not continue implementation if the baseline build or tests fail. Record the output and ask the owner whether the failure is expected.

## Coworker: add the Codex project

1. Open Codex.
2. Select **Add project** or create a new project from a folder.
3. Select the local `FCI-Brett` repository root—not its parent and not a duplicate synchronized copy.
4. Name it **Floor Coverings International — Operations App**.
5. Start a new task inside that project.

The root `AGENTS.md` contains repository-wide instructions that Codex should apply automatically when working in this folder. Project decisions remain in `docs/` so another Codex instance can reconstruct the current state without the original conversation.

## First Codex task: onboarding verification

Paste this into the coworker's first task:

> Open and follow the repository's `AGENTS.md`. Read every file in its **Read first** list, including `docs/agent-plan-architecture-workspace-and-setup.md`. Run `git status --short --branch` and `npm.cmd test`. Summarize the current architecture, development safety boundary, cost/provisioning gates, active blockers, and next open packet from the agent ledger. Do not change files, hosted configuration, or external systems in this onboarding task.

The expected result is a read-only orientation report plus a passing baseline. The worker should not begin coding until the assigned milestone is confirmed.

## Completed source-only platform assignments

The source-only `codex/google-cloud-runtime-foundation` assignment now provides the fail-closed container/runtime boundary, validated private Cloud SQL configuration, bounded pools, separate migration and rehearsal commands, exact readiness, least-privilege source policies, and strict test-data core rehearsal. It does not containerize the employee application, provision infrastructure, apply roles or migrations, connect Workspace, or deploy. See [Google Cloud runtime foundation](google-cloud-runtime-foundation.md).

The source-only infrastructure-definition assignment now provides zero-resource-by-default Google Cloud definitions, on-demand staging, standalone and regional-HA Cloud SQL profiles, lifecycle locks, and disabled optional modules. Owner inputs and approved calculator evidence remain apply-time blockers; no Google Cloud resource was provisioned.

The source-only `codex/production-persistence-boundary` assignment now provides migration version 3, generic identity/security-audit/integration/file metadata, aggregate PostgreSQL repositories, exact runtime privilege readiness, and a provider-neutral object-storage contract. It does not seed roles, implement authorization behavior, replace D1/R2 routes, migrate data, connect live Workspace identity, apply the migration, or deploy. See [Production persistence boundary](production-persistence-boundary.md).

The source-only authorization work now records the complete first-rollout application ceiling: two initial Administrators, approved Office company-wide nonfinancial operations, Project Manager assigned-project operations, seven-day single-use explicit invitations, 30-minute idle/eight-hour absolute sessions, read-only exact-project Field links with a seven-day default/fourteen-day maximum, one role per employee, and no per-user overrides. AdminCRM is owner-confirmed individual/non-shared, but its managed Workspace identity and immutable Google subject remain unverified; Brett's equivalent live verification is also open. See [Authorization simulation](authorization-simulation.md).

The current source-only `codex/cloud-run-employee-routes` assignment composes secure session/CSRF transport, authorization, and PostgreSQL-backed dashboard, search, project list/exact-project, client list, and logout paths into the Cloud Run entry point. File list/upload/share, Gmail filing, and Calendar creation are authorization-gated but return `503 feature_unavailable` because production provider adapters are intentionally absent. It does not bind durable invitations, issue a session cookie, implement OIDC, issue Field Lead links, seed users/roles, migrate or apply a database, connect Google providers, deploy, add a second user, or use real data.

The merged source-only `codex/admin-access-core` assignment adds unapplied migration version 4, immutable three-role/capability seeds, durable invitation role and Project Manager project bindings, and the five fixed Administrator commands. It enforces exact request schemas, CSRF, reasons, post-lock actor-session/capability fencing, version fences, transactionally coupled exact-scope audit, expired-invitation replacement, session invalidation, and concurrent final-active-Administrator protection. Migration 4 fails before writing if version-3 role/access data is populated, so any future populated upgrade requires a reviewed backfill. It does not fulfill invitations, seed users, apply a migration, connect Workspace, admit a second user, or use real data.

The merged `codex/admin-access-page` assignment adds the bounded Administrator read projection plus the compact `/management/access` screen with one People table, pending invitations, three read-only role explanations, and the five fixed workflows. The projection rechecks the exact current Administrator session and fails closed on stale authorization, malformed scope data, or bounded-list overflow. Browser coverage includes direct-route denials, stale/final-Administrator handling, keyboard focus, responsive reflow, and accessibility. Its presentation/test adapter is deployed only to the private Sites development environment; production employee-session/CSRF bootstrap, invitation delivery, and migration/apply remain absent.

PR #21 merged `codex/admin-audit-viewer` into `main` at `de0fb51`. It implements a separately privileged `GET /api/v1/admin/audit` reader over a security-barrier minimized projection plus an independently loaded **Activity** tab on `/management/access`. It rechecks the exact live Administrator session/version and `audit.read`, accepts only bounded fixed filters and a filter-bound keyset cursor containing a one-way pseudonymous pagination key, and returns only actor, human action, target label, result, bounded friendly reason, and time. Raw audit metadata and internal identifiers remain unavailable. The People/Activity presentation adapter is included in private Sites development version 37. Production migration 5, database grants, employee-session/CSRF composition, live identity, a second user, and real data remain unapplied or disabled.

PR #22 merged the durable routes at `03223c1`: Overview, Leads, Clients, Projects, Schedule, Inbox, Assistant, Reports, and Settings have fixed App Router URLs, with bounded bookmarkable Project, Settings, and Inbox state. PR #25 then completed the July critique gap pass at `13241fc`; private Sites development version 37 now contains the readability, feature-state, responsive, drawer, filtering, Inbox, Assistant, Reports, and Access-boundary refinements. The release changed no database migration, access policy, or Google connection.

PR #27 merged the Reports drill-through follow-on into `main` at `cf32a9e`; the exact merged commit was deployed successfully as private Sites development version 38. Pipeline links use five bounded active-lead buckets (`new-inquiry`, `site-visit`, `proposal`, `decision`, and `other`), and project links use the seven exact lifecycle statuses from Planning through Archived. Destination filters are visible, clearable, reloadable, history-aware, and fail safely on invalid or duplicate values; rendered tests cover keyboard activation, Back focus, a `$0` custom-stage record, desktop/mobile accessibility, and overflow. The release changed no database schema, access policy, hosted environment values, or Google connection.

PR #29 merged the first Phase 3 frontend-structure slice into `main` at `1c2f991`; the exact merged source was deployed successfully as private Sites development version 39. It extracts reusable operations page, panel, metric, avatar, and status components plus one shared report-filter/focus boundary while preserving the current DOM, styles, URLs, and data behavior. The release changed no database schema, access policy, hosted environment values, or Google connection.

PR #30 merged the `codex/semantic-rules-table` assignment into `main` at `aa8ed8f`. It adds one reusable responsive semantic table based on the Access People/Activity pattern, first applied to **Settings → Inbox & file rules**. Native table headings and mobile field labels preserve all five rule fields, while Pause/Enable and Delete remain native keyboard actions. PR #32 then merged at `adc79b8`, and that exact commit deployed as private Sites development version 40, so the semantic rules table is now included in the controlled deployment. The slice changes presentation components, styles, tests, and documentation only; it does not migrate or alter stored records and changes no database schema, API contract, access policy, hosted configuration, migration, or Google connection.

PR #31 merged the [agent execution plan](agent-plan-architecture-workspace-and-setup.md) into `main` at `88b5b01`. That ledger is the current source of truth for backend, Workspace, and Settings work; the design-critique ledger remains authoritative for the UI remediation sequence, and the task checklists remain owner-facing.

PR #32 merged the documentation-truth and one-account Gmail-boundary packet into `main` as `adc79b855041db04cc3ca2a3eb232bc72408d33b` on July 19, 2026. The exact commit was deployed to the private Sites development environment as version 40. This deployment changes no production platform, migration, live Google connection, second-user access, or real-data boundary.

The current `codex/actionable-lists` slice is source-only, source-complete, and ready for review in draft PR #33. It migrates the whole-row Overview pipeline, Clients, and Projects views to one shared native list/list-item/button pattern with explicit list semantics, concise action names linked to descriptions that preserve all decision metadata, Enter/Space activation, Escape dismissal, exact trigger focus return, responsive behavior, and empty states. The focused Playwright groups pass 58/58, all 13 routes pass serious/critical axe checks at desktop and 390 px, lint and rendered visual QA pass, and the final `npm test` run passed 325 active tests with 13 skipped after the accessibility and test-runner adjustments. On Windows, Vinext exits during the monolithic Playwright run, so use the recorded isolated local-server groups. It has not been deployed; private Sites development version 40 remains at `adc79b8` with no hosted configuration, data, API, migration, or security change from this slice.

## Recommended next worker assignments

The owner completed the flagged hosted project-manager correction on July 18, 2026 by using the audited **Assign to me** action and confirming the corrected identity/activity evidence. The next local sequence does not require Brett's Workspace or Cloud input:

1. Review and merge source-only draft PR #33 for the source-complete `codex/actionable-lists` slice covering the whole-row Overview pipeline, Projects, and Clients views. Only after it merges, begin SET-01; continue feature-level client splitting, pill/field/button consolidation, and legacy CSS removal only in later bounded slices.
2. Source-only jobs and Google sync contracts: model job/attempt/failure/replay plus Gmail/Calendar cursor and renewal state with fakes only; do not activate Scheduler, watches, channels, or delivery.
3. Local migration fixtures: extend transformation, duplicate-reporting, reconciliation, and rollback evidence without creating or using staging.

Build `codex/admin-field-links` only when field assignments are scheduled. It needs a distinct hashed Field Link store plus exact-project issuance, expiry, lookup, revocation, and the later Field Links tab; do not reuse file links.

Do not build custom roles, a permission-toggle matrix, per-user overrides, editable session/invitation policy, user deletion/re-enablement, or a per-device session console for the first rollout.

Brett's Google Cloud and Workspace inputs remain necessary for cost approval, resource application, direct Google access, and later live integration, but they do not block the local source-only sequence above. Google Workspace OIDC, live session issuance, any staging execution, migration/apply, live authorization rollout, production deployment, a second user, and real data must still wait for the production foundation, tested migration/cutover and recovery path, provider-neutral database/storage boundaries, authorization controls, and separate owner approval to pass acceptance.

## Daily collaboration workflow

1. Sync `main` before starting:

   ```powershell
   git switch main
   git pull --ff-only
   ```

2. Create the assigned branch:

   ```powershell
   git switch -c codex/<short-feature-name>
   ```

3. Keep each task on its own branch. Two coworkers should not work on the same branch.
4. Run relevant tests while working and `npm.cmd test` before handoff.
5. Push the branch and open a pull request into `main`.
6. Wait for GitHub CI and owner review before merging.
7. Pull the accepted `main` before beginning another task.

## Pull request handoff template

Use this structure in the pull request description:

```markdown
## Outcome

What changed and why.

## Verification

- [ ] `npm test`
- [ ] Additional route/integration/browser tests, if applicable

## Data and security impact

Schema, permissions, secrets, external services, migration, and rollback impact.

## Owner tasks

Non-secret configuration or decisions still needed. Never paste secret values here.

## Not changed

Production deployment, hosted secrets, and real client data remained untouched unless explicitly approved.
```

## End-of-task Codex handback prompt

Before the coworker ends a task, ask their Codex instance:

> Prepare a handback for another Codex instance. State the branch and commits, summarize every material change, list tests and results, identify schema/configuration/security impact, link the pull request, record unresolved blockers and owner tasks, and confirm whether deployment or external state was changed. Put durable project facts in the appropriate repository documentation rather than relying only on this conversation.

## Secrets and local configuration

- The repository may share `.env.example`; it must never contain real credentials.
- Each developer creates their own ignored `.env.local` with development-only values.
- Use separate development OAuth credentials and callbacks when Google integration testing is approved.
- Never share production Google passwords, OAuth secrets, encryption keys, access/refresh tokens, OpenAI keys, or client exports.
- Do not add the coworker to the hosted app allowlist until the owner approves application access separately from GitHub access.

## Conversation and business-context sharing

Codex project conversations are not the canonical record for this repository. Put architecture decisions, setup status, acceptance evidence, and handoff summaries in GitHub documents or pull requests.

A shared ChatGPT Project may be used separately for collaborative chats and uploaded business context when the company's plan and policies allow it. That does not replace the coworker's local Codex project or Git workflow.

## Troubleshooting

### The repository link shows 404 or a push is denied

- Confirm the repository URL is exact and the coworker is signed in to the intended GitHub account.
- For a push denial, confirm the coworker accepted the collaborator invitation and has contributor access.
- If the owner later makes the repository private, confirm the invitation has not expired.

### Codex cannot see the project instructions

- Confirm the selected Codex project folder is the repository root containing `AGENTS.md`.
- Pull the latest `main` and restart the task from that project.
- Do not select only `docs/` or a parent directory containing multiple unrelated projects.

### Tests work for the owner but not the coworker

- Confirm Node.js satisfies the version in `package.json`.
- Run `npm.cmd ci` from the repository root.
- Confirm no production-only secret is incorrectly required for the local simulation baseline.
- Share command output, never secret values.

## Handoff is complete when

- [ ] The coworker has their own Codex and GitHub accounts.
- [ ] One canonical local clone is selected and its Git working tree is clean.
- [ ] Codex is attached to the local repository root.
- [ ] `AGENTS.md` and required project documents were read.
- [ ] The baseline build and tests pass.
- [ ] The worker has a bounded branch assignment.
- [ ] Pull-request, review, CI, and secret-handling rules are understood.
