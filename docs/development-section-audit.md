# Development section audit

Audit date: July 12, 2026
Remediation pass: July 12, 2026

## Overall assessment

The application now loads leads, clients, projects, dashboard totals, meetings, and reporting summaries from durable data. Hard-coded business examples and browser-only write fallbacks have been removed. Features without durable source records—especially crew scheduling, project tasks, project files, and operational activity tabs—now show explicit readiness states instead of fabricated data. The remaining gaps below are the next product work, not hidden development behavior.

## Section-by-section audit

| Section | Working now | Most important gaps | Priority |
| --- | --- | --- | --- |
| Overview | Live lead/project/client/meeting/filed-email totals, pipeline, empty/error/loading states, project drawer access | Appointments, follow-ups, and schedule attention need durable source models | High |
| Leads | Normalized durable lead create/list and stage changes with activity history | Full edit/archive UI, follow-up dates, owner administration, loss reason, and lead-to-project conversion | High |
| Clients | Durable create/list, primary contact, project counts, multiple independent projects, Sheet mirror | No edit/archive, multi-contact UI, sites/addresses, account notes, duplicate merge, or clickable client project links | High |
| Projects | Durable create/list, client relationship, project numbering, Sheet mirror, simulated/live Drive provisioning | Project edit/status history, dates, progress, tasks, documents, schedule, communications, closeout, and most drawer counts remain incomplete | Critical |
| Project meetings | Durable meeting records, Otter/source link, attendees, summary, decisions, action items, notes, transcript, activity event, assistant evidence | Edit/archive, transcript file upload, Drive copy, task conversion, Calendar association, retention/consent settings, automatic Otter intake | Implemented foundation |
| Schedule | Honest readiness view; separate Calendar integration test controls exist | Shifts, workers, crews, phases, conflicts, publishing, acknowledgements, field links, SMS/email, and field calendar sync are not durable | Critical |
| Inbox | Real/simulated Gmail search, labels, draft replies, exact-project preview, `.eml` and attachment filing, Inbox retention, audit records | No Gmail watch/history queue, thread reader, send action, server-side rules, malware scanning, role/project permissions, or durable suggestion review queue | High |
| AI Assistant | Real project-scoped server API, strict cited output, records-only fallback, client/project/contact/activity/email metadata, meeting evidence | No record permissions, rate/audit controls, embeddings, Drive/email-body indexing, saved conversations, or AI evaluation suite | High |
| Reports | Live lead/client/project/meeting/filed-email totals and project-status/pipeline summaries | Date filters, metric definitions, drilldowns, exports, and financial visibility rules | Medium |
| Settings: My account | Per-user timezone and reply signature persist | Role display, user notification preferences, and profile administration | Medium |
| Settings: Google Workspace | Local simulation, OAuth, Shared Drive verification, Gmail/Calendar controls, Sheet status, and reset are wired | Live values are environment-managed; safeguard checkboxes are informational; stale OAuth query state should be cleared | High before launch |
| Settings: Calendar | Names, IDs, timezone, and reminders can be saved | These settings do not create calendars or drive operational appointment/reminder workers | High |
| Settings: Inbox rules | Rules can be added, paused, enabled, and deleted; filing remains review-first | Custom rules are not executable structured matchers; administration is not role-aware | High |
| Settings: Client Directory | Honest one-way app-to-Sheet mirror and manual sync | No row-level repair/import workflow or settings-to-runtime Sheet configuration | Medium |
| Settings: Workflow & notifications | Configuration values persist | No background worker consumes them | High when appointment/schedule delivery is built |
| Settings: Data & security | Review-first behavior, simulation isolation, and PWA install guidance | User/role admin, retention/export, audit viewer, backup restore, scanning, consent, and session revocation | Critical before live data |
| Settings: Testing & launch | Useful checklist copy | Static; should be driven by real health, migration, backup, permission, and lifecycle checks | High before launch |

## Cross-cutting risks

1. `Office` and `Project Manager` authorization plus project-level permissions are not implemented.
2. Several operational settings persist but have no background worker.
3. Source-level tests are useful regressions but do not replace route, permission, browser, or lifecycle tests.
4. Persistent test records are not automatically deleted when UI demonstrations are removed; production data cleanup must be an explicit, backed-up administrative action.

## Recommended delivery order

1. **Make data truthful (first remediation completed):** empty/error states, normalized leads, durable stage changes, live dashboard/report totals, collision-safe numbering, and no browser-only save fallback. Lead conversion remains next.
2. **Build the production and authorization foundation:** Cloud Run/Cloud SQL migration, invited Workspace identity, secure sessions, roles, capabilities, project memberships, Google access matrix, recovery, and audit controls.
3. **Complete the project workspace:** project editing, tasks/follow-ups, meeting refinement, documents/images, real activity, dates/progress, closeout, concurrency protection, and assigned-project query scoping.
4. **Productionize Inbox and appointments:** server-side intake queue, structured rules, Gmail watch/history, dual-confirmation appointments, reminders, thread view, scanning, retries, and exact-project filing integrity.
5. **Build scheduling operations:** phases, workers, crews, shifts, conflict detection, controlled publishing, employee messages, acknowledgement links, and the approved field-access model.
6. **Add safe AI retrieval, Reports, and launch checks:** permission-filtered indexing, audit/rate controls, citation evaluation, leakage tests, metric APIs, drilldowns, exports, role-based financial visibility, restore drills, and lifecycle acceptance.
