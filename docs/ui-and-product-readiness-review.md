# FCI Operations UI and product-readiness review

Reviewed: July 2026

For the current company-size verdict, role/access model, live desktop walkthrough findings, production topology, and corrected delivery order, read the [20-user product and architecture review](20-user-product-and-architecture-review.md). This page remains the detailed section-by-section UI inventory.

## What this review covers

This review separates three things:

1. What the interface currently communicates well.
2. What was corrected in the July UI consistency pass.
3. What functionality still needs to be built before the product is a complete lead-to-closeout system.

## Page-by-page UI review

| Page | Current purpose | Corrections made | Important remaining work |
| --- | --- | --- | --- |
| Overview | Operational summary | Greeting now changes by the signed-in user’s saved timezone; the local account derives “Jason” from the email instead of showing “there”; loading totals show an em dash instead of a false zero; implementation-focused copy was rewritten; project previews are capped at six. | Add real upcoming appointments, overdue tasks, field issues, and closeout alerts after those records exist. |
| Leads | Four-stage opportunity board | Loading copy no longer shows false totals; repeated Add opportunity buttons and non-actionable ellipses were removed; empty columns and nonstandard stages have clearer explanations. | Add lead editing, conversion, configurable stage templates, next-action dates, ownership, website intake, and stale-lead automation. |
| Clients | Client directory and repeat-client structure | Copy now describes the business workflow; global Google Sheets state is no longer repeated as if it were a per-client status; New project is disabled when no client exists; mobile client cards were added. | Add client editing, archiving, duplicate merge, multiple-contact management, account sites, and account document UI. |
| Projects | Independent project list | Filters now separate Active, Completed, Cancelled, and Archived; the unused Progress column was removed; Status and Dates use clearer terms; project rows have a simpler mobile layout. | Add project editing, dates, phases, progress, tasks, commercial status, closeout, and activity history. |
| Schedule | Honest scheduling readiness page | Copy is business-facing; the Workflow & notification settings button now opens the correct settings panel. | Build workers, subcontractors, crews, shifts, conflict detection, batch publishing, acknowledgements, and employee schedule messaging. |
| Inbox | Review-first Gmail workflow | Renamed to Gmail project inbox; Gmail labels consistently use `FCI/Intake`, `FCI/Needs Review`, and `FCI/Filed`; File to project is now Review & copy; Reply is now Draft reply; safety copy clearly states that nothing is filed automatically. | Add Gmail watch/history processing, a durable suggestion queue, thread view, send workflow, retries, and executable custom matchers. |
| AI Assistant | Read-only, selected-project Q&A | Records-only mode is presented as a valid mode; prompt controls are disabled during a request; missing-evidence callouts only appear when present; no-project guidance and accessible answer updates were added. | Add project-level permissions, Drive document indexing, permission-filtered retrieval, saved conversations, and prompt-injection/leakage evaluations. |
| Reports | Current operational totals | Copy is business-facing; loading totals do not show false zeros; custom pipeline stages roll into Other stages; chart columns have balanced visual weight; semantic chart links now open visible, bounded Lead-stage and exact Project-lifecycle filters with reload, Clear, Back, and safe fallback behavior. | Add date filters, deeper record-level and financial drilldowns, revenue/margin data, sales-cycle timing, crew utilization, and exports. |
| Settings | Account, Workspace, calendar, inbox, security, and launch settings | General Settings now opens My account; timezone changes update the Overview greeting; the Calendar plan no longer claims that saving creates calendars; the Schedule deep link was repaired; mobile settings layouts were improved. The fixed-role People & Access page and minimized Activity tab are merged, and their presentation adapter is deployed only to private Sites development. | Make saved calendar IDs authoritative at runtime, persist launch checklist state, compose People & Access with the production employee session/CSRF bootstrap, apply its PostgreSQL migrations/grants, and split the dense Google Workspace panel into smaller sections. |

## Cross-application consistency changes

- Added a consistent high-contrast keyboard focus ring.
- Added reduced-motion behavior.
- Added semantic colors for completed, needs-review, failed, cancelled, archived, and inactive states.
- Improved mobile tables, settings grids, action wrapping, drawer actions, and metric stacking.
- Kept notification and safety information available on mobile instead of hiding it.
- Replaced the Mac-only `⌘ K` label with `Ctrl K` for the current Windows deployment.
- Added live-region semantics to loading, error, toast, and assistant-answer feedback.
- Removed the standalone Gmail Filed-label action and API route; `FCI/Filed` now remains part of the exact-project archive flow only.
- Replaced the transient project-update composer with a disabled Project updates planned control.
- Replaced the hardcoded Administrator text with the current server-derived access label (`Admin` or `Office`).
- Added fixed App Router URLs for all nine primary views. Project status and exact report lifecycle, Lead report stage, Settings section, and Inbox bucket use bounded bookmarkable query state; invalid or duplicate route state canonicalizes safely, and unknown paths return a real 404.
- Completed global-search keyboard navigation and focus handling, plus drawer Escape/focus-restoration behavior for the current Lead and Project flows.
- Enforced a stylesheet-wide 12 px minimum for meaningful metadata, strengthened muted-text contrast, and raised undersized interactive controls.
- Added explicit Working, In development, Setup required, and Planned states, including a fail-closed People & Access development boundary.

## Known UI work not included in this pass

These are larger structural changes and should be scheduled separately:

- Move repeated Lead and Project drawer content/chrome into feature modules and shared presentation components while retaining the existing `AccessibleOverlay` focus trap, initial focus, focus restoration, Escape handling, and labeling behavior.
- Replace the current development access label with the durable production role/capability context only after the source-composed authorization boundary is accepted and durable admission, live OIDC, session issuance, and deployment are separately approved.
- Consolidate the older sidebar CSS and rename color variables by purpose.
- Split the monolithic client surface into feature boundaries and start core data on the server where the production persistence boundary permits it.
- Add independent loading/error states, query invalidation, stale timestamps, and optimistic-concurrency messages for multi-user use.

## What is genuinely implemented

- Hosted authentication with an explicit office allowlist and admin allowlist.
- Durable clients, primary contacts at creation, leads, projects, meetings, activity events, filing rules, user preferences, Google connection state, Gmail archives, and Drive mappings.
- Multiple independent projects for one client.
- Review-triggered Shared Drive project folders.
- Review-first Gmail search, reply drafts, labels, filing preview, `.eml` copies, and attachment copies.
- One-way Client Directory and Project Register Google Sheets mirror.
- Calendar event listing and a test hold.
- Otter links, pasted transcripts, meeting notes, decisions, and action items.
- Selected-project assistant evidence with citations and a records-only fallback.
- A guarded file-upload API and an installable PWA manifest.

Separately, the production source boundary now includes the [approved authorization and employee-route work](authorization-simulation.md): granular Administrator/Office/Project Manager ceilings, exact-one-role and session-denial rules, project-scoped PostgreSQL reads, financial redaction, fixed-operation provider gates, append-only audit evidence, and a narrow Cloud Run dashboard/search/project/client/logout boundary. File/Gmail/Calendar routes are authorization-gated but provider-unavailable. These production controls are not wired into the hosted Workers/D1 application; the private People/Activity presentation adapter uses development-only fixtures and is not production session/database composition.

## What is still in development or a placeholder

- Lead conversion and public lead intake.
- Client, contact, lead, project, and meeting edit/archive workflows.
- Project dates, phases, tasks, follow-ups, notes, documents, financial status, closeout, and history UI.
- Appointment availability, dual confirmation, reminders, expiry, cancellation, and two-way Calendar reconciliation.
- Workers, crews, shifts, conflicts, assignment publishing, acknowledgements, and field links.
- SMS/email delivery tracking, Twilio, consent, STOP handling, retries, and dead letters.
- CSV preview/import.
- Durable invitation fulfillment/OIDC/session issuance and renewal, the broader production interface/routes, and provider adapters. The five fixed administration commands, People & Access projection/page, minimized Activity reader/tab, and rendered permission tests are merged; only their presentation adapter is deployed to private Sites development.
- Drive/email document indexing and permission-filtered semantic retrieval.
- Backup restoration validation, audit retention and export, plus malware scanning when untrusted uploads or Gmail attachments are enabled. The minimized audit viewer is merged, but production migration 5, its reader grant, and live audit data remain unapplied.
- Production background workers for reminders, Gmail watches, synchronization, and retries.

## Production architecture decision

The production system will use the approved small-company Google Cloud architecture. The minimum launch core is one regional Cloud Run modular monolith, the selected Cloud SQL PostgreSQL profile, Secret Manager integration, Google Workspace OIDC, and required identity/authorization/audit/backup controls. Cloud Tasks, Cloud Scheduler, Cloud Storage quarantine/scanning, Gmail Pub/Sub, Calendar HTTPS webhooks, SMS, and `pgvector` are feature-gated and remain disabled until approved. The current Sites/Workers/D1/R2 deployment remains a controlled development environment and will not be promoted in place.

The migration will happen before scheduling, messaging, and AI indexing are built. Those modules depend on durable jobs, relational transactions, retries, and permission-filtered retrieval; moving now avoids implementing and migrating those foundations twice.

See [`architecture-decision-production-platform.md`](architecture-decision-production-platform.md) for the production boundary and the [Workspace-first, cost-controlled rollout](architecture-decision-workspace-first-cost-controlled-rollout.md) for the provisioning and cost gates.

## Prioritized next steps

### Now: safe single-user development environment

The owner has approved the application role and sensitive-action policy, including two initial Administrators, explicit invitations, no Sales/Estimator role, Field Lead links, and no subcontractor accounts. Cloud inputs, rollout order, direct Google resource access, Google Groups, and account lifecycle remain open in parallel with the ordered source work below.

1. **Complete in source; unapplied:** costed infrastructure definitions and reviewable migration/restore/cutover procedures for the minimum core and on-demand staging boundary.
2. **Complete in source; unapplied:** the production-persistence boundary covering provider-neutral PostgreSQL repositories, generic identity/security-audit schema, integration metadata, and object-storage ports.
3. **Complete in source; not deployed:** approved access contexts, capability/project-scoped queries, provider-action gates, negative authorization tests, and narrow dashboard/search/project/client/logout Cloud Run routes. File/Gmail/Calendar paths are gated but provider-unavailable.
4. **Administration milestone merged; production boundary unapplied:** Management → People & Access has the bounded People projection, five fixed workflows, read-only role presets, and a separately privileged minimized Activity reader/tab. Its presentation adapter is deployed only to private Sites development; production migrations/grants and employee-session/CSRF composition remain unapplied or undeployed. Field Links remain deferred until field assignments are scheduled.
5. With separate approval, prove migration, restore, reconciliation, and rollback/forward-fix in isolated on-demand staging.
6. Add live Google Workspace OIDC/session issuance only after those platform and authorization gates pass; do not add more users before project permissions are enforced.
7. Add editing and archiving for clients, contacts, leads, projects, and meetings.
8. Implement lead conversion as one transaction.
9. Add project dates, tasks/follow-ups, notes, file metadata, photo UI, and activity history.
10. Make saved Calendar settings control the live integration.
11. Before accepting untrusted uploads or Gmail attachments, add quarantine, scanning, release, and authorized download controls; copy only approved files to Shared Drive.
12. Replace source-contract tests with more route, integration, and browser behavior tests.
13. Validate backup restoration before real client data; retain the minimized audit viewer as a separately privileged production gate.

The owner completed the hosted project-manager correction in private Sites development version 37 on July 18, 2026 and confirmed the corrected identity/activity evidence. PR #29's first Phase 3 shared UI/filter boundary first shipped in version 39. PR #32 then merged at `adc79b8`, and that exact commit deployed as private Sites development version 40, including PR #30's Settings rules semantic-table slice at `aa8ed8f`. The Overview pipeline, Clients, and Projects actionable-list pattern is source-only, source-complete, and ready for review on `codex/actionable-lists` without a pull request or deployment. The next frontend step that does not need Brett's input is to review and merge that slice; SET-01 starts only after it merges. Later Phase 3 structure slices, provider-neutral job and Gmail/Calendar sync contracts with local fakes, and local migration transformation/reconciliation fixtures also remain available. Live OIDC, staging execution, migration/apply, production deployment, a second user, and real data remain separately gated.

### Next: lead-to-closeout operations

1. Appointment state machine, availability, dual confirmations, reminders, cancellation, and Calendar reconciliation.
2. Phases, workers, subcontractors, crews, shifts, conflicts, publishing, and acknowledgements.
3. Provider-neutral messaging with Twilio, delivery states, consent, opt-out, retry, and dead-letter handling.
4. Expiring external links for confirmations and field updates/photos.
5. Structured Gmail rules, durable review queue, thread view, and intentional send workflow.
6. Closeout checklist, punch items, warranty information, completion approval, and archive.
7. CSV preview/import.

### Later: automation and intelligence

1. Permission-filtered Drive, email, and transcript indexing with embeddings.
2. Saved assistant conversations, rate/audit controls, and AI leakage/prompt-injection evaluation.
3. Reviewed Otter/Zapier intake, followed by a native adapter only if justified.
4. Gmail/Calendar Pub/Sub reconciliation and retry dashboards.
5. Forecasting, margin, earned revenue, sales-cycle, closeout-duration, and crew-utilization reporting.
6. A Google Workspace Add-on only after the standalone web application is mature.
