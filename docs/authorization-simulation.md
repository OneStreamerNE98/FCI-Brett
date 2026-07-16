# Authorization simulation and source-only employee routes

Status: Approved policy and source-only Cloud Run employee-route boundary implemented; not migrated, applied, deployed, or connected to live identity or providers

Decision dates: July 15–16, 2026

## Purpose and safety boundary

This source-only work turns the owner's first-rollout access decisions into a deny-by-default application policy, secure-session transport and resolution checks, project-scoped PostgreSQL query contracts, fixed-operation provider gates, append-only security-audit evidence, and a narrow Cloud Run employee request boundary. It is not live employee login and does not change the hosted Sites/Workers/D1/R2 development application.

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
| Administrator | Company-wide; financial values visible | All Office/Project Manager operations; create/assign projects; file Gmail; create Calendar events; view/upload/share files; export; audit view; and the narrowly named invitation, user-disable, role-assignment, session-revocation, Field-link, and Office/Project Manager permission-management capabilities |
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

- Every scoped record query rechecks the exact live session ID/version, active-user state, authorization version, same-role `records.read` grant, unexpired role, and—when applicable—active project membership in SQL before aggregation, ranking, limiting, or serialization.
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
- The runtime database role remains append-only for security-audit records. `audit.read` is Administrator-only policy, but the separately privileged audit reader, route, and UI do not exist.
- Runtime session updates remain limited to credential/revocation behavior. No route can yet mutate invitations, users, roles, role capabilities, or Field links.

## Explicitly deferred

- Durable invitation-role binding and fulfillment; role/capability seeds; Google Workspace OIDC; production session issuance, rotation, and sliding idle renewal; and live login.
- Administration query/command APIs and the Management → Administration & Access page.
- Durable hashed Field Lead link creation, delivery, lookup, revocation, and browser behavior. The snapshot evaluator is not sufficient for a route.
- Production file/object-storage and Google Gmail/Calendar/Drive action adapters, direct Google access decisions, and provider configuration.
- Lead/client/contact and project-operation mutation route composition beyond the approved capability ceiling.
- A separately privileged audit viewer, recovery controls, backup/restore proof, key rotation, staging, migration/apply, deployment, a second user, and real client or employee data.

The source work reduces implementation risk but does not change the no-go decision for a second employee or real data.

## Recommended administration-page sequence

After this employee-route branch is reviewed and merged:

1. `codex/admin-access-persistence`: add the versioned invitation-role, role-policy, user-role, project-membership, and session-invalidation persistence needed for audited administration. Require reasons, invalidate affected sessions, prohibit arbitrary/per-user grants, and protect the final active Administrator transactionally.
2. `codex/admin-access-api`: add fixed, bounded people/invitation/role/project/session/security-policy endpoints with same-origin, CSRF, capability, optimistic-concurrency, preview, and audit controls.
3. `codex/field-link-persistence`: add the separate hashed Field Lead link table and exact-project issuance, lookup, expiry, and revocation behavior. Do not reuse file links.
4. `codex/admin-audit-reader`: add the separately privileged, projection-limited, keyset-paginated audit reader and export boundary.
5. `codex/admin-access-page`: add Management → Administration & Access for overview, people/invitations, role permissions, project assignments, Field links, sessions/security, and audit records. Keep unavailable backend actions visibly disabled.
6. `codex/admin-access-acceptance`: add policy-preview, final-Administrator concurrency, cross-project, CSRF, direct-URL, session-invalidation, responsive/accessibility, and rendered browser evidence before staging or live identity work.
