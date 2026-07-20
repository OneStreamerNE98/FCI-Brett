# Task checklist: Approve the complete product and integration architecture

Owner: Business owner with developer, operations lead, Google administrator, and accounting/field representatives

Status: Audit complete; PR #11 source runtime boundary merged; broader product decisions and implementation remain open

Depends on: [Setup inputs](00-setup-inputs.md) and the [complete architecture audit](../complete-product-and-google-cloud-architecture-audit.md)

This is a decision and acceptance checklist. Do not enter credentials, tokens, personal phone numbers, production client data, or confidential contract terms in GitHub.

## Product and system boundaries

- [ ] Decide whether the first release is permanently single-company/single-office or needs future organization/office boundaries.
- [ ] List every existing franchise CRM, estimating/takeoff, accounting/payment, payroll/timekeeping, scheduling, and document system.
- [ ] Mark the authoritative system for each client, lead, estimate, project, purchase, schedule, invoice/payment, employee, file, email, calendar event, and report.
- [ ] Approve the first-release functional scope and explicit exclusions.
- [ ] Approve one representative lead-to-closeout/warranty acceptance scenario.
- [ ] Confirm that Cloud SQL is the operational source of truth, Shared Drive owns released documents, and Sheets is only a derived projection.

## Roles and access

- [x] Approve Admin, Office Operations, and Project Manager responsibilities. The first-rollout ceilings are recorded in [the 20-user operating model](06-20-user-operating-model-and-access.md); rollout and live identity verification remain separate gates.
- [x] Sales/Estimator is excluded from the first rollout, and Field Lead uses a future expiring assignment link rather than an employee role.
- [x] Subcontractors receive no application accounts or access in the first rollout.
- [ ] Decide whether clients receive accounts, purpose-scoped links, or no direct access, and whether subcontractors may ever receive a separately approved future link.
- [x] Approve project membership and cross-project visibility rules. Office is company-wide for approved nonfinancial operations; Project Managers are restricted to explicitly assigned projects with minimum read-only related client/contact context.
- [x] Restrict pricing/revenue/margin, project creation/assignment changes, Gmail filing, Calendar creation, file sharing, exports, and security-audit viewing to Administrators for the first rollout.
- [ ] Decide discounts/change orders, message sending, mailbox/calendar reads, file view/download, job retry, routine non-Admin writes, and recovery authority; deny them in simulation until approved.
- [x] Require an explicit application invitation for every employee; durable invitation binding and Internal Workspace OIDC verification/session issuance are implemented in source, while live configuration, apply, deployment, and admission remain gated.

## CRM, estimating, and project workflow

- [ ] Approve lead sources, stages, loss/disqualification reasons, response SLAs, stale-lead rules, assignment, and duplicate handling.
- [ ] Approve client/contact/site edit, archive, merge, and contact-role rules.
- [ ] Approve atomic lead conversion behavior and duplicate-client/project handling.
- [ ] Decide whether site surveys, rooms/areas, measurements, moisture/substrate, and preparation evidence live in this app.
- [ ] Decide whether estimates/proposals live here; approve line items, waste, labor/material/freight/tax/margin, revisions, approvals, expiry, and acceptance evidence.
- [ ] Approve project phases, milestones, dates, assignments, task/dependency, issue/RFI, change-order, completion, cancellation, and archive rules.

## Materials, workforce, and field operations

- [ ] Decide whether vendors, products/SKUs/colors/lots, purchase orders, acknowledgements, ETAs, backorders, receiving, returns, and material readiness live here.
- [ ] Identify the product/catalog or purchasing system that must integrate if the app is not authoritative.
- [ ] Confirm whether crews include employees, subcontractors, or both.
- [ ] Approve required skills, certifications, insurance/compliance, availability, shift, acknowledgement, no-show, and conflict rules.
- [ ] Decide whether the first field release requires offline operation; otherwise approve online-only with explicit offline/degraded feedback.
- [ ] Approve daily logs, installed quantities, photos, readings, safety/quality issues, time evidence, and customer signoff requirements.

## Texting, email, and reminders

- [x] Prefer Workspace email and Calendar workflows for the first reminder release; defer paid SMS until its business, compliance, provider, and cost decisions pass.
- [ ] Separate operational appointment/project messages from marketing messages and approve the allowed purposes for each channel.
- [ ] Select the initial SMS provider and sender route; do not acquire or register a production sender until the policy is approved.
- [ ] Approve consent capture/evidence, sender identification, STOP/START/HELP, suppression, and opt-out wording with appropriate legal/compliance review.
- [ ] Approve quiet hours, recipient-timezone fallback, per-contact frequency limits, retry limits, message-cost alerts, and emergency/escalation behavior.
- [ ] Approve versioned templates and who may edit, approve, send, or automate each template class.
- [ ] Approve how inbound replies are assigned and how `unknown` provider outcomes reach a human exception queue.
- [ ] Confirm long-range reminders remain PostgreSQL records and are materialized into Cloud Tasks only inside the supported scheduling window.
- [ ] Confirm Gmail submission is recorded as submitted/sent rather than guaranteed delivery.

## Files, closeout, warranty, and retention

- [ ] Approve allowed file types/sizes, project association, quarantine, malware scan, release, rejected-file review, and download/share policy.
- [ ] Approve document categories, Shared Drive folder map, version behavior, retention, deletion, legal hold, and backup scope.
- [ ] Approve punch-list, QA/final inspection, completion signoff, care/warranty package, and final-billing gates.
- [ ] Approve warranty coverage evidence, claim triage, service visit, resolution, denial, and customer approval rules.
- [ ] Set retention periods for Gmail copies, texts, call notes, photos, files, operational activity, security audit, database backups, and provider logs.

## Google Cloud and operations

- [x] Approve separate development/staging/production project, credential, and data boundaries, with Sites development and on-demand staging rather than three continuously running stacks.
- [ ] Approve the company Cloud organization/billing account, primary region, hostname, and DNS owner.
- [ ] Name recipients for the default `$50/month` pre-production accidental-spend alert and approve an estimate-based production alert budget; define separate SMS/provider spend caps before SMS.
- [ ] Set availability expectations, RPO, RTO, production HA choice, maintenance window, and regional-outage policy.
- [ ] Name deployment approver, rollback owner, security incident owner, primary recovery administrator, and second trained recovery administrator.
- [x] Approve one regional Cloud Run/Cloud SQL modular monolith as the initial employee-application runtime boundary. The source foundation remains fail-closed and undeployed.
- [x] Approve a cost-controlled rollout: minimum production core first, standalone and HA Cloud SQL priced before selection, and optional service modules disabled by default.
- [x] Defer the isolated malware scanner and quarantine resources until untrusted uploads are scheduled and the file policy is approved.
- [ ] Approve least-privilege runtime, migration, and deployment identities; approve task, Scheduler, Pub/Sub, and scanner identities only when those modules are activated.

## Developer foundation before live Workspace access

- [x] Review and merge the PostgreSQL repository work without duplicating its scope.
- [x] Complete PostgreSQL adapters, atomic idempotency, activity/outbox transactions, bounded version-fenced claims, and shared PostgreSQL 16 repository tests.
- [x] Complete one production-persistence slice covering the remaining PostgreSQL schema/repositories, generic users/identities/invitations/sessions and roles/capabilities/project-membership structures, general append-only security audit, integration/file metadata, and provider-neutral object-storage ports for routes that still depend on D1/R2. It remains source-only and unapplied; the approved granular role ceiling and deny-by-default policy now govern the narrow source-composed employee routes. See [Production persistence boundary](../production-persistence-boundary.md).
- [x] Add source-only access-context query scoping and negative cross-project authorization tests, including an isolated real-PostgreSQL suite that runs only when `TEST_POSTGRES_URL` is supplied. Local runs without that variable skip the database suite and do not count as real-database evidence.
- [x] Add the owner-approved source-only Node/Cloud Run foundation with validated runtime configuration, capped PostgreSQL pools, separate migration/rehearsal commands, and process/database health endpoints without provisioning resources. Dashboard/search/project/client/logout paths are now source-composed; file/Gmail/Calendar paths remain provider-unavailable after authorization. See [Google Cloud runtime foundation](../google-cloud-runtime-foundation.md).
- [x] Add costed, reviewable infrastructure definitions that preserve Sites development, support on-demand staging, provide standalone and HA production database profiles, configure zero-minimum/bounded-maximum Cloud Run, and keep optional service modules disabled. The [source-only Terraform definitions](../../infrastructure/google-cloud/README.md) merged in PR #15, default to zero resources, use lifecycle locks, require explicit approval inputs, and remain unapplied.
  - Approved calculator evidence, final profile/cost decisions, remaining owner inputs, and any plan or apply remain open and separately gated.
- [ ] Complete provider-neutral jobs, attempts, application-owned failed jobs, replay/cancel, outbox-relay, future Scheduler/reminder, and fake Cloud Tasks contracts. WS-12 / PR #39 supplies the source-only durable-job/failure/replay contract subset and local fakes; live queues, Scheduler, delivery, and the remaining chain stay open.
- [ ] Complete Gmail watch/history and Calendar channel/sync-token state machines with duplicate, delay, expiry, dropped-notification, and full-resync fixtures. WS-12 / PR #39 supplies source-only cursor/channel contracts and local fakes; live watches, channels, transports, and end-to-end reconciliation remain open.
- [ ] Complete quarantine scan/release and permission behavior. Generic file/version/storage/link metadata, project-only reservation, quarantine-state finalization, and a conditional object-storage fake now exist; scanner behavior, release policy, authorized download, provider composition, and untrusted intake remain deferred.
- [ ] Add optimistic concurrency, edit/archive, atomic conversion, project dates, tasks/follow-ups, notes, and conflict UI.
- [ ] Split the frontend into durable routes and feature modules with typed errors, query freshness, partial-failure, accessibility, and responsive tests.
  - Durable primary routes, bounded project/Settings/Inbox plus exact Reports lifecycle and Lead-stage query state, direct-entry/refresh/history coverage, route-level denial/404 tests, the July readability/accessibility gap pass, the first shared operations UI/filter boundary, and PR #30's Settings rules semantic table at `aa8ed8f` are included in private Sites development version 40; PR #32 merged at `adc79b8`, and that exact commit was deployed. The source-only `codex/actionable-lists` slice is complete in PR #33 and is not deployed; the `codex/settings-panel-extraction` SET-01 slice is complete in source in PR #35 and is not deployed. PRs #37/#41/#44 add Settings admin gating, Tier-1 KPIs, and guided Workspace setup; none is deployed. KPI-02 is next in the single-file queue. Feature modules, freshness, partial-failure, conflict, CSS consolidation, and the remaining interactive-state visual harness remain.
- [ ] Complete test-data transformation, duplicate reporting, backup/restore, cutover, and rollback tooling. The bounded core rehearsal already preserves test identifiers and verifies per-table counts plus content/identifier hashes, but it is not the full staging/cutover rehearsal.
- [ ] Write ADRs and contract/state-transition tests for approved estimate, procurement, schedule/field, communications, closeout, and warranty behavior.

## Live configuration hold

Checked items in this section are accepted guardrails currently in force; they do not authorize provisioning, configuration, deployment, migration, or access expansion.

- [x] Do not create or apply Google Cloud resources until the owner approves the environment, budget, IAM, and recovery inputs.
- [x] Do not treat defined environment boundaries or source definitions as permission to create three running stacks.
- [x] Do not create live Gmail watches, Calendar channels, Workspace tokens, phone numbers, or outbound messages during source-only development.
- [x] Do not deploy, migrate data, change the existing hosted configuration, or alter the current Workspace test connector without owner approval.
- [x] Do not admit a second employee or real client data before the identity, authorization, restore, audit, and acceptance gates pass.

## Acceptance evidence

- [ ] Every canonical state transition has server validation, expected-version handling, actor/reason/correlation evidence, and positive/negative tests.
- [ ] Every background provider operation is idempotent, bounded, observable, and recoverable through an application-owned exception record.
- [ ] Security audit is separate from the client/project activity timeline and covers identity, permissions, exports, files, jobs, integrations, and recovery.
- [ ] Restore and point-in-time recovery pass in a separate environment with data reconciliation and an application smoke test.
- [ ] Representative Admin, Office, Project Manager, and exact-assignment Field-link access scenarios pass; Sales/Estimator remains excluded rather than simulated as a role.
- [ ] Every integration enabled for launch passes its applicable normal, duplicate, delayed, expired, revoked, partial-failure, and reconciliation scenarios; dormant modules remain unprovisioned.
- [ ] The owner signs off on the staging migration rehearsal, production cutover plan, second-user gate, and real-data gate.

## Completion result

This action is complete when the owner has approved the product/system boundary, roles, state machines, communications and file policies, recovery targets, and Google Cloud operating model; the P0 source foundation passes its tests; and the remaining live administrator steps have named owners. Completion of this checklist does not itself authorize deployment, live configuration, migration, a second user, or real data.
