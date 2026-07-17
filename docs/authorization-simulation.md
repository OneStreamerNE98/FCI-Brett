# Authorization simulation and source-only employee routes

Status: Approved policy and all three Administration and Access source branches merged. The private Sites development deployment includes the People/Activity presentation adapter; production migrations/grants, Cloud Run session/CSRF composition, live identity, and providers remain unapplied or undeployed.

Decision dates: July 15–16, 2026

## Purpose and safety boundary

This production-oriented source work turns the owner's first-rollout access decisions into a deny-by-default application policy, secure-session transport and resolution checks, project-scoped PostgreSQL query contracts, fixed-operation provider gates, append-only security-audit evidence, and a narrow Cloud Run employee request boundary. It is not live employee login, and none of that production route/session composition is deployed. The separately merged People/Activity presentation adapter is the only Administration and Access behavior added to the private Sites/Workers/D1/R2 development application.

No Google credential, OAuth client, Cloud project, hostname, billing setting, database migration, live user, or real client record is required or changed. The existing hosted development environment, test connector, and one-user/test-data boundary remain unchanged.

## Owner-approved first-rollout policy

- The two initial application Administrators are `admincrm@cherryhillfci.com` and `brett@cherryhillfci.com`.
- The owner confirmed that `admincrm@cherryhillfci.com` is an individual account and not a shared login. Before live admission, still verify its managed Workspace status and bind its immutable Google issuer/`sub`. Brett's individual managed-account verification and immutable identity binding also remain open.
- Every employee requires a single-use, explicit application invitation for one exact normalized `cherryhillfci.com` email and one supported role. The approved invitation lifetime is seven days.
- Each employee has exactly one supported application role; per-user capability overrides are prohibited.
- Sales/Estimator is excluded from the first rollout. Field Leads receive no employee accounts. Subcontractors receive no application accounts or employee role; any future subcontractor link requires a separate owner decision.
- Only Administrators may see pricing, revenue, margin, or financial-report values; create projects; change assignments; file Gmail; create Calendar events; share files; export data; or view audit records.
- The approved employee-session defaults are a 30-minute inactivity timeout and an eight-hour absolute lifetime.
- A future Field Lead link is read-only, limited to one exact project, seven days by default, fourteen days at most, and immediately revocable.

Naming the initial Administrators and approving application capabilities does not approve the employee rollout order, direct Gmail mailbox access, Calendar reads, Shared Drive membership, Google Groups, Directory Sheet access, connector administration, job retry, recovery controls, deployment, or a second user.

## Approved role capability ceiling

The table is the maximum source policy for the first rollout, not evidence that every listed mutation or provider route is implemented.

| Principal | Record scope | Approved capability ceiling |
| --- | --- | --- |
| Administrator | Company-wide; financial values visible | All Office/Project Manager operations; create/assign projects; file Gmail; create Calendar events; view/upload/share files; export; audit view; and the narrowly named invitation, user-disable, role-assignment, session-revocation, and Field-link capabilities. The approved global role-permission capability remains dormant in the first release. |
| Office Operations | Company-wide; financial values omitted | Read operational records; create/update leads, clients, and contacts; update existing project status, tasks, meetings, and notes; view/upload files |
| Project Manager | Assigned projects and only related client/contact context; financial values omitted | Read assigned operational records; update assigned project status, tasks, meetings, and notes; view/upload files for assigned projects |
| Field Lead link | One exact project; financial values omitted | Read the exact field assignment only after durable link issuance exists |
| Sales/Estimator or subcontractor employee role | None | None; any future subcontractor link is unapproved |

Office and Project Manager cannot create projects, change assignments, file Gmail, create Calendar events, share files, export data, read audit records, or administer access. Project Managers cannot create/update leads, clients, or contacts. Generic `records.write` and `users.manage` remain unmapped; Gmail reads, Calendar reads, connector management, job retry, and recovery management remain denied. File access must eventually enforce nonfinancial classification as well as project scope so a document cannot bypass field-level financial redaction.

The source policy intersects the ceiling with persisted same-role grants. It rejects zero, duplicate, unknown, or multiple employee roles, preventing a company-wide scope from one role from being combined with a capability from another.

## Implemented source controls

### Admission, sessions, and transport

- A pure admission helper requires caller-supplied, already-verified email and hosted-domain values to equal `cherryhillfci.com`, an explicit invitation flag, and one supported role. It does not perform durable invitation lookup or Google signature/issuer/audience/nonce/`sub` verification.
- Session and CSRF credentials are accepted only in bounded transport locations, immediately reduced to canonical SHA-256 digests, and never exposed to authorization callbacks or audit metadata. Browser mutations require an exact same-origin check plus a CSRF hash matching the live session.
- Session resolution rejects missing, revoked, future-issued, inconsistent, invalidated, authorization-version-stale, absolute-expired, or idle-expired sessions and disabled or outside-domain users. Equality at an expiry boundary is expired.
- The seven-day invitation, 30-minute idle, and eight-hour absolute values are source policy defaults. No login/session-issuance endpoint or sliding idle compare-and-swap touch exists yet; the resolver enforces the persisted deadlines it receives.
- Source now includes a same-origin, CSRF-checked logout route that atomically revokes a resolved hashed session and clears the browser cookie only after confirmed revocation or when the credential is already unusable. Active-session CSRF, audit, database, or revocation failures retain the cookie so the user can retry while the server session remains controlled. Unknown or already-revoked credentials receive the same idempotent external result. There is still no source route that issues the cookie.

### Capabilities and project scope

- Every scoped record query rechecks the exact live session ID/version, active-user state, authorization version, same-role `records.read` grant, permanent fixed role, and—when applicable—active project membership in SQL before aggregation, ranking, limiting, or serialization.
- Sensitive operations recheck the exact current same-role capability and, for assigned-project scope, the exact project membership in the same SQL decision.
- Company-wide and assigned-project paths are separate. Nonfinancial projections do not select financial columns. Project Manager client/contact results are reachable only through active assigned projects.
- Unknown roles, operations, capabilities, project identifiers, and caller attempts to relabel a fixed operation are denied.

### Source-only Cloud Run route boundary

The production Cloud Run entry point now composes the authorization service and employee request router in source:

- Functional PostgreSQL-backed source routes: dashboard, search, project list, exact-project view, client list, and logout.
- File list/upload/share, Gmail filing, and Calendar creation routes pass through session, capability, CSRF, and exact-project gates, but return `503 feature_unavailable` because no production file or Google provider action adapters are composed.
- File upload/share, Gmail, and Calendar callbacks cannot run after a denial. No route trusts the Sites `oai-authenticated-user-email` header or includes a fake production identity.
- Health/readiness behavior, drain handling, and migration-command separation remain intact.

These are source contracts only. They have not been applied to a database, deployed, connected to the hosted interface, or exercised through live employee identity.

### Audit evidence

- Resolved-session/operation denials, same-origin/CSRF transport denials, and sensitive allows are appended before protected work begins; an audit failure fails the request closed. Missing or malformed cookie requests receive the same generic `401` without persisting credential material.
- Audit metadata records the operation, principal kind, and project-scoped state without raw credentials or request bodies.
- The normal runtime database role remains insert-only for raw security-audit records. The source-only `GET /api/v1/admin/audit` path uses a dedicated reader behind `audit.read` and least-privilege `SELECT` on a security-barrier minimized projection. It returns only actor, human action, target label, result, reason, and time through bounded filters and a filter-bound keyset cursor containing only a one-way pseudonymous pagination key. It does not expose raw metadata, credentials, request bodies, internal identifiers, or request/correlation data, and it does not grant general `audit_events` read access.
- The source-only Administrator command boundary can create or revoke an invitation, change one fixed role and any Project Manager assignments, disable a user, or sign a user out everywhere. These routes use exact same-origin/CSRF checks, fixed request schemas, optimistic concurrency, transactionally coupled exact-scope audit, session invalidation, and concurrent final-active-Administrator protection. After the global mutation lock, every command rechecks and row-locks the exact actor session/user/current Administrator capability with database statement time; access loss or expiry while a slow request is in flight fails as a generic signed-out response. Creating an invitation expires any same-email pending credential whose seven-day deadline has passed before inserting its replacement. The fixed role/capability catalog has no mutation route, and Field Links remain absent.
- One bounded `GET /api/v1/admin/access` projection rechecks and share-locks the exact current Administrator session/user and `access_admin.read` grant in a repeatable-read transaction before returning fixed role descriptions, at most 100 people, 100 live pending invitations, and 500 lightweight project choices. It reports last sign-in from session issuance rather than mislabeling the currently untended `last_seen_at` value as activity. It fails closed on truncation, malformed role/scope state, or a post-authorization actor change and never returns credentials, capability arrays, session identifiers, audit records, client data, or financial values.
- A dedicated `/management/access` screen presents three summary counts, one People table, one pending-invitation list, three compact read-only role explanations, and only the five approved workflows. It reloads the single projection after confirmed writes, handles stale/final-Administrator/session-ended responses explicitly, and has direct-route, keyboard, mobile/tablet/desktop, 200%-equivalent reflow, and accessibility coverage. The private Sites deployment remains only a presentation/test adapter and deliberately has no production session/CSRF bridge.
- The same screen has an independently loaded **Activity** tab. Fixed period, result, and action-category filters query 25-row keyset pages; load-more failures preserve existing rows. Administrator-only route and presentation denials, session-ended handling, keyboard tab semantics, responsive table-to-card reflow, accessibility, and console-error coverage are exercised with local fixtures. Production migration 5 and the minimized reader grant remain unapplied.

## Explicitly deferred

- Durable invitation fulfillment; Google Workspace OIDC; production session issuance, rotation, and sliding idle renewal; and live login. Invitation role and Project Manager project bindings plus the fixed role/capability seeds now exist only in unapplied source migration version 4.
- Production composition of Management → People & Access with employee session issuance and a CSRF bootstrap. The page and API contracts exist, but there is still no live invitation fulfillment/delivery, migration/apply, or production runtime deployment.
- Durable hashed Field Lead link creation, delivery, lookup, revocation, and browser behavior. The snapshot evaluator is not sufficient for a route.
- Production file/object-storage and Google Gmail/Calendar/Drive action adapters, direct Google access decisions, and provider configuration.
- Lead/client/contact and project-operation mutation route composition beyond the approved capability ceiling.
- Production composition of the minimized audit viewer and deployment of its PostgreSQL migration/grant; audit export and retention controls; recovery controls; backup/restore proof; key rotation; staging; a second user; and real client or employee data.

The source work reduces implementation risk but does not change the no-go decision for a second employee or real data.

## Recommended administration-page sequence

The owner-facing design is intentionally small for a roughly 20-person company. Read the canonical [Administration and Access plan](administration-and-access-plan.md). Role permissions, invitation/session lifetimes, and the domain rule are fixed read-only policy; the first page does not expose a capability matrix or per-user exceptions.

1. `codex/admin-access-core` — implemented in source, unapplied: fixed schema/catalog and command APIs for invite, revoke invitation, change one role or Project Manager assignments, disable access, and sign out everywhere, with reasons, CSRF, optimistic concurrency, transactionally coupled audit, session invalidation, and concurrent final-Administrator protection.
2. `codex/admin-access-page` — merged in source: bounded Administrator read projection and Management → People & Access with one people/invitation list, a read-only role guide, the five workflows, and direct-route, responsive, accessibility, and rendered browser evidence. Production employee-session/CSRF composition remains deferred.
3. `codex/admin-audit-viewer` — merged in PR #21: separately privileged minimized Activity reader and independently loaded tab with fixed filters, keyset pagination, denial evidence, and responsive/accessibility coverage. Audit writes remain part of the core branch; production migration 5 and the reader privilege remain unapplied.
4. `codex/admin-field-links`: when the field-assignment workflow is scheduled, add the separate hashed exact-project Field Link lifecycle and tab. Do not reuse file links or create Field Lead users.

All three source branches are merged, and the private Sites development deployment includes only their presentation adapter. No branch adds custom roles, global permission toggles, user deletion/re-enablement, live admission, production migration/apply, or production runtime deployment.
