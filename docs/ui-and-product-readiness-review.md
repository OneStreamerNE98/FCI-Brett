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
| Reports | Current operational totals | Copy is business-facing; loading totals do not show false zeros; custom pipeline stages roll into Other stages; chart columns now have equal visual weight. | Add date filters, drilldowns, revenue/margin data, sales-cycle timing, crew utilization, and exports. |
| Settings | Account, Workspace, calendar, inbox, security, and launch settings | General Settings now opens My account; timezone changes update the Overview greeting; the Calendar plan no longer claims that saving creates calendars; the Schedule deep link was repaired; mobile settings layouts were improved. | Make saved calendar IDs authoritative at runtime, persist launch checklist state, add user/role management, and split the dense Google Workspace panel into smaller sections. |

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

## Known UI work not included in this pass

These are larger structural changes and should be scheduled separately:

- Use real routes or a URL parameter for views so refresh, Back, bookmarks, and support links preserve the selected page.
- Create one accessible dialog/drawer primitive with focus trapping, initial focus, focus restoration, Escape handling, and consistent labels.
- Add full keyboard navigation to global search results.
- Replace the current access label with the durable OIDC application role and capabilities when the production authorization model is implemented.
- Consolidate the older sidebar CSS and rename color variables by purpose.
- Continue increasing very small metadata text as each operational module becomes real.
- Add explicit Working, In development, Setup required, and Planned states so configuration-only or placeholder controls cannot be mistaken for operational features.
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

## What is still in development or a placeholder

- Lead conversion and public lead intake.
- Client, contact, lead, project, and meeting edit/archive workflows.
- Project dates, phases, tasks, follow-ups, notes, documents, financial status, closeout, and history UI.
- Appointment availability, dual confirmation, reminders, expiry, cancellation, and two-way Calendar reconciliation.
- Workers, crews, shifts, conflicts, assignment publishing, acknowledgements, and field links.
- SMS/email delivery tracking, Twilio, consent, STOP handling, retries, and dead letters.
- CSV preview/import.
- Application roles beyond the admin flag and project-level permissions.
- Drive/email document indexing and permission-filtered semantic retrieval.
- Backup restoration validation, audit viewer, retention, export, and malware scanning.
- Production background workers for reminders, Gmail watches, synchronization, and retries.

## Production architecture decision

The production system will use the approved small-company Google Cloud architecture: one regional Cloud Run modular monolith, Cloud SQL PostgreSQL, Secret Manager, Cloud Tasks, Cloud Storage quarantine, Google Workspace OIDC, Gmail Pub/Sub notifications, and Calendar HTTPS webhooks. Add `pgvector` only when permission-filtered document indexing is scheduled. The current Sites/Workers/D1/R2 deployment remains a controlled development environment and will not be promoted in place.

The migration will happen before scheduling, messaging, and AI indexing are built. Those modules depend on durable jobs, relational transactions, retries, and permission-filtered retrieval; moving now avoids implementing and migrating those foundations twice.

See [`architecture-decision-production-platform.md`](architecture-decision-production-platform.md) for the decision, development boundary, migration sequence, and cutover requirements.

## Prioritized next steps

### Now: safe single-user development environment

1. Build the Google Cloud production foundation and migration path defined in the accepted architecture decision.
2. Approve the 20-user app-to-Google access matrix, including the field/crew access decision and two initial Administrators.
3. Add invited Google Workspace OIDC users, secure sessions, granular capabilities, roles, and project-level permissions before adding more users.
4. Add editing and archiving for clients, contacts, leads, projects, and meetings.
5. Implement lead conversion as one transaction.
6. Add project dates, tasks/follow-ups, notes, file metadata, photo UI, and activity history.
7. Make saved Calendar settings control the live integration.
8. Connect uploads to project Files and Shared Drive, then add scanning/quarantine.
9. Replace source-contract tests with more route, integration, and browser behavior tests.
10. Validate backup restoration and add an admin audit viewer before real client data.

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
