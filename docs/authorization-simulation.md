# Authorization simulation

Status: Implemented in source only; not route-composed, applied, or deployed

Decision date: July 15, 2026

## Purpose and safety boundary

This source-only slice turns the owner's first-rollout access decisions into a deny-by-default application policy, secure-session checks, project-scoped PostgreSQL query contracts, provider-action gates, and append-only security-audit evidence. It is a local production-boundary simulation, not employee login or a change to the hosted development application.

No Google credential, OAuth client, Cloud project, hostname, billing setting, database migration, live user, or real client record is required or changed. The existing Sites/Workers/D1/R2 environment and its single-user test-data boundary remain unchanged.

## Owner-approved first-rollout policy

- The two initial application Administrators are `admincrm@cherryhillfci.com` and `brett@cherryhillfci.com`. Before live use, verify that both are individual managed accounts assigned to named people and never a shared login. The simulation does not seed either account.
- Every employee requires an explicit application invitation in addition to a verified `cherryhillfci.com` identity.
- The local simulator includes fake Administrator, Office Operations, and Project Manager principals. Sales/Estimator is excluded from the first rollout. The complete Office Operations and Project Manager responsibilities remain an owner decision.
- Field Leads do not receive employee accounts. They may eventually use expiring, purpose-specific links limited to one exact assignment.
- Subcontractors receive no application accounts or access in the first rollout. A future temporary-link policy for subcontractors remains a separate owner decision.
- Only Administrators may see pricing, revenue, or margin values; create projects; change project assignments; file Gmail; create Calendar events; share files; export data; or view audit records.

Naming the two initial Administrators does not approve a wider employee rollout order. It also does not approve direct Gmail mailbox access, Calendar reads, file view/download, Shared Drive membership, Google Groups, directory Sheet access, job retry, recovery controls, or any other action not listed above.

## Conservative simulated access pending final role responsibilities

| Principal | Record scope | Financial values | Approved named actions |
| --- | --- | --- | --- |
| Administrator | Company-wide | Visible | Create/assign projects; Gmail filing; Calendar creation; file sharing; export; audit viewing |
| Office Operations | Company-wide operational records | Omitted | Operational reads only in this simulation |
| Project Manager | Assigned projects and only the client/contact context reachable through those assignments | Omitted | Assigned operational reads only in this simulation |
| Field Lead link | One exact project encoded by an unexpired, unrevoked link context | Omitted | Read the exact field assignment only |
| Sales/Estimator or subcontractor | None | Omitted | None |

The Office Operations and Project Manager rows above are least-access simulation defaults, not approval of their final responsibilities or rollout. Role policy and persisted database grants are intersected per role. A role never gains a capability from another simultaneous role or merely because an unexpected capability row exists in the database. Unknown roles and operations are denied.

## Implemented source controls

### Admission and sessions

- A pure admission-policy helper requires caller-supplied, already-verified simulated email and hosted-domain values to equal `cherryhillfci.com`, plus an explicit-invitation flag and a supported simulated employee role. It does not read a durable invitation, bind invitation email/status/role, or verify a Google signature. Those server-side admission controls remain deferred with live OIDC.
- The repository accepts only a canonical session-token digest, never the raw credential.
- Session resolution rejects missing, revoked, future-issued, or internally inconsistent sessions; disabled users; authorization-version changes; global session invalidation; absolute expiry; and idle expiry. Equality at either expiry boundary is expired. `idle_expires_at` is a fixed persisted deadline in this slice; sliding idle extension and compare-and-swap session touch/rotation remain part of live session composition.
- Logout resolves only a hashed credential, atomically revokes the matching stored session with audit evidence, and returns one idempotent result for missing, already-revoked, or concurrently revoked sessions. The resolver honors stored revocation state. Production login, cookie issuance/rotation, refresh, and logout HTTP endpoints are not part of this slice.

### Capabilities and project scope

- Approved role mappings use dotted capability keys and deny unapproved Gmail reads, Calendar reads, file view/download, generic record writes, user/connector administration, job retry, and recovery management even for Administrators.
- Every scoped query rechecks the exact live session ID/version, active-user state, current authorization version, same-role `records.read` grant, unexpired role, and—when applicable—active project membership in SQL before aggregation, ranking, limiting, or serialization.
- Company-wide and assigned-project read paths are separate. Nonfinancial queries do not select financial columns and return an explicit nonfinancial shape, preventing a later serializer from leaking a hidden value.
- Client/contact context for Project Managers is reachable only through an active assigned project.

### Sensitive operations and audit evidence

- Sensitive provider or mutation work runs only through a named, fixed-operation service gate after the service approves the session, current Administrator capability, and required project scope. Caller-controlled fields cannot relabel Gmail, Calendar, file, export, or mutation work as a weaker read operation, and a denial cannot invoke its callback.
- Every denial and every sensitive allow is appended to the security-audit boundary before sensitive work begins. An audit write failure fails the request closed.
- Audit metadata records the operation, principal kind, and whether it was project-scoped; it does not record the raw session credential or request body. Routine allowed reads continue to rely on normal request telemetry.
- The runtime database role remains append-only for security-audit records. The `audit.read` capability models the owner's Administrator-only decision, but no audit-reader repository, `SELECT` grant, route, or UI exists yet.
- Runtime session updates are limited to the six credential/revocation columns used by atomic logout. The runtime has no invitation, role, capability, role-capability, or user-role mutation grant in this slice.

### Verification boundary

- Pure policy, service, SQL-source, and fake-transaction tests run locally.
- A real PostgreSQL authorization integration suite migrates an isolated test schema and exercises forged scope, cross-project, financial-redaction, revocation, and authorization-version cases when `TEST_POSTGRES_URL` is supplied. It is skipped—not counted as local database evidence—when that variable is absent; CI must run it with PostgreSQL before acceptance.

## Explicitly deferred

- Google Workspace OIDC, durable invitation lookup and exact email/status/assigned-role binding, invitation fulfillment, production session cookies, sliding idle touch/rotation, employee login/logout routes, account-management UI, and role/capability seeding.
- Composition of dashboard, search, project, client, file, Gmail, Calendar, export, and audit HTTP routes onto this authorization boundary.
- Creation, hashing, persistence, lookup by bearer-token digest, delivery, revocation endpoints, and browser behavior for Field Lead links. The service only evaluates a caller-supplied snapshot and proves expiry, revocation, capability, and exact-project rules for that snapshot; it does not re-read durable state. A persistence-backed lookup and revocation recheck are hard blockers before any Field Lead route is composed.
- Live Gmail, Calendar, Drive, Shared Drive, Sheets, Google Groups, and provider callback integration, including the still-undecided direct Google read-access matrix.
- A separately privileged audit reader and viewer, recovery controls, production backup/restore proof, and key-rotation operations.
- Migration or infrastructure apply, staging, deployment, a second user, and real client or employee data.

The source controls therefore reduce implementation risk but do not change the no-go decision for a second employee or real data. Those remain blocked until the production HTTP identity/authorization composition, staging/recovery evidence, audit viewer, and other launch gates pass acceptance.
