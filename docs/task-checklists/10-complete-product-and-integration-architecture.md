# Task checklist: Approve the complete product and integration architecture

Owner: Business owner with developer, operations lead, Google administrator, and accounting/field representatives

Status: Audit complete; decisions and implementation open

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

- [ ] Approve Admin, Office Operations, and Project Manager responsibilities.
- [ ] Decide whether Sales/Estimator and Field Lead are distinct roles.
- [ ] Decide whether subcontractors and clients receive accounts, expiring purpose-scoped links, or no direct access.
- [ ] Approve project membership and cross-project visibility rules.
- [ ] Approve who may see cost/margin, approve discounts/change orders, send messages, file Gmail, create Calendar events, share/download files, export data, view security audit, retry jobs, and perform recovery.
- [ ] Confirm that Internal Google OAuth still requires an explicit app invitation and active user.

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

- [ ] Approve the company Cloud organization/billing account, primary region, separate development/staging/production projects, hostname, and DNS owner.
- [ ] Approve monthly budget thresholds and recipients; define separate SMS/provider spend caps.
- [ ] Set availability expectations, RPO, RTO, production HA choice, maintenance window, and regional-outage policy.
- [ ] Name deployment approver, rollback owner, security incident owner, primary recovery administrator, and second trained recovery administrator.
- [ ] Approve the modular-monolith topology and the isolated malware scanner as the only initial service split.
- [ ] Approve least-privilege runtime, task, Scheduler, Pub/Sub, migration, scanner, and deployment identities.

## Developer foundation before live Workspace access

- [ ] Review the existing `codex/postgres-repositories` branch before starting overlapping database work.
- [ ] Complete PostgreSQL adapters, atomic idempotency, activity/outbox transactions, bounded claims, and shared repository tests.
- [ ] Add users, identities, invitations, secure sessions, roles/capabilities, project memberships, and general append-only security audit.
- [ ] Add access-context query scoping and negative cross-project authorization tests.
- [ ] Add a standard Node/Cloud Run build, validated runtime configuration, capped PostgreSQL pool, migration command/job, and health endpoints without provisioning resources.
- [ ] Define and test provider-neutral jobs, attempts, application-owned failed jobs, replay/cancel, outbox-relay, future Scheduler/reminder, and fake Cloud Tasks contracts. Do not add operational scheduling or delivery before the production platform and authorization gates pass.
- [ ] Add Gmail watch/history and Calendar channel/sync-token state machines with duplicate, delay, expiry, dropped-notification, and full-resync fixtures.
- [ ] Add file metadata and quarantine/scan/release contracts with fake storage/scanner implementations and permission tests.
- [ ] Add optimistic concurrency, edit/archive, atomic conversion, project dates, tasks/follow-ups, notes, and conflict UI.
- [ ] Split the frontend into durable routes and feature modules with typed errors, query freshness, partial-failure, accessibility, and responsive tests.
- [ ] Add test-data transform, duplicate report, count/hash reconciliation, restore, cutover, and rollback tooling.
- [ ] Write ADRs and contract/state-transition tests for approved estimate, procurement, schedule/field, communications, closeout, and warranty behavior.

## Live configuration hold

- [ ] Do not create or apply Google Cloud resources until the owner approves the environment, budget, IAM, and recovery inputs.
- [ ] Do not create live Gmail watches, Calendar channels, Workspace tokens, phone numbers, or outbound messages during source-only development.
- [ ] Do not deploy, migrate data, change the existing hosted configuration, or alter the current Workspace test connector without owner approval.
- [ ] Do not admit a second employee or real client data before the identity, authorization, restore, audit, and acceptance gates pass.

## Acceptance evidence

- [ ] Every canonical state transition has server validation, expected-version handling, actor/reason/correlation evidence, and positive/negative tests.
- [ ] Every background provider operation is idempotent, bounded, observable, and recoverable through an application-owned exception record.
- [ ] Security audit is separate from the client/project activity timeline and covers identity, permissions, exports, files, jobs, integrations, and recovery.
- [ ] Restore and point-in-time recovery pass in a separate environment with data reconciliation and an application smoke test.
- [ ] Representative Admin, Office, Project Manager, Sales/Estimator, and Field access scenarios pass if those roles are approved.
- [ ] Gmail, Calendar, Drive, Sheets, files, and messaging pass normal, duplicate, delayed, expired, revoked, partial-failure, and reconciliation scenarios.
- [ ] The owner signs off on the staging migration rehearsal, production cutover plan, second-user gate, and real-data gate.

## Completion result

This action is complete when the owner has approved the product/system boundary, roles, state machines, communications and file policies, recovery targets, and Google Cloud operating model; the P0 source foundation passes its tests; and the remaining live administrator steps have named owners. Completion of this checklist does not itself authorize deployment, live configuration, migration, a second user, or real data.
