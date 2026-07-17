# Administration and Access plan

Status: Approved first-release design; fixed administration core and People & Access page merged, with the minimized Activity viewer implemented in the current source branch; runtime composition and deployment remain pending

Reviewed: July 16, 2026

Audience: Business owner, application Administrators, and developers

## Decision

For the first rollout, use one small **Management → People & Access** page rather than a general-purpose permission console. The company has about 20 employees, three fixed employee roles, no per-user capability overrides, and no approved need for custom roles or editable security policy.

The People view manages people and pending invitations only. A second **Activity** view uses its own projection-limited reader instead of granting general raw-audit access. Field Lead links join later, after their distinct backend boundary and field-assignment workflow exist. This gives Administrators the workflows and minimized security evidence they need without exposing low-level capabilities, session policy, raw audit metadata, or database concepts.

## Fixed first-release policy

These rules are enforced on the server and shown as read-only guidance. They are not Administrator settings:

- The two initial application Administrators are `admincrm@cherryhillfci.com` and `brett@cherryhillfci.com`. AdminCRM is owner-confirmed individual/non-shared; both accounts still require managed Workspace and immutable Google identity verification before live admission.
- Employee roles are exactly **Administrator**, **Office Operations** (shown as **Office** where space is limited), and **Project Manager**.
- Every employee has exactly one role. Per-user capability overrides and custom roles are prohibited.
- Every employee requires a single-use invitation for one exact normalized `cherryhillfci.com` email and one role. Invitations expire after seven days.
- Office has the approved company-wide nonfinancial operations preset.
- Project Manager has the approved assigned-project nonfinancial operations preset.
- Administrator has the approved company-wide operational, financial, sensitive-action, and access-administration preset.
- Pricing, revenue, margins, project creation/assignment, Gmail filing, Calendar creation, file sharing, export, and audit viewing remain Administrator-only.
- Employee sessions use a 30-minute inactivity timeout and an eight-hour absolute lifetime.
- Field Leads receive no employee accounts. Their future links are read-only, exact-project, seven days by default, fourteen days at most, and immediately revocable.
- Sales/Estimator remains excluded. Subcontractors receive no account, employee role, or link.
- A user is disabled rather than deleted so identity and audit history remain intact.
- The final active Administrator cannot be disabled or changed to another role. The interface should warn when fewer than two active Administrators remain.

The approved `role_permissions.update` capability remains dormant in the first release. Do not add a role-permission mutation endpoint or permission-toggle interface unless the owner later identifies a concrete company-wide need. Any later controls must remain global to a role and within the approved ceiling; per-user exceptions stay prohibited.

## First-release page

Route: `/management/access`

Navigation label: **People & Access**

The initial page contains:

- one small summary row for active people, active Administrators, and pending invitations;
- one People table containing name/email, role, project scope, status, and last activity when known;
- pending invitations in the same list or an adjacent compact list;
- one primary **Invite person** action;
- row actions for **Edit access**, **Sign out everywhere**, and **Disable access**; and
- a compact, read-only **What each role can do** guide.

Do not add separate Overview, Role Permissions, Project Assignments, Sessions/Security, or Audit sections. Project assignments belong in the Project Manager edit workflow. Session revocation belongs in the person row. Fixed session and invitation values belong in read-only explanatory text.

## Five Administrator workflows

### 1. Invite a person

Collect only:

- exact company email;
- one fixed role; and
- one or more project assignments only when Project Manager is selected.

Show that the invitation is single-use and expires in seven days. Do not expose expiry, capability, or domain controls. Creating the invitation does not itself admit a live user before invitation fulfillment, Workspace OIDC, and session issuance are accepted.

### 2. Revoke a pending invitation

Require a confirmation and reason. Revoke the hashed invitation credential and retain the invitation record and audit evidence. Do not delete invitation history.

### 3. Change role or Project Manager assignments

Use one role selector. Show the project picker only for Project Managers. Require a reason and a concise impact preview, use optimistic concurrency, and invalidate the affected employee's sessions when the role or accessible-project set changes.

The server must enforce exactly one role, the fixed allowlist, exact project identifiers, and the final-active-Administrator rule in the same transaction. A role change away from Project Manager must end active Project Manager memberships while retaining their history.

### 4. Disable access

Require a reason and an impact confirmation. Atomically disable the user, invalidate every active session, and append security-audit evidence. Do not provide delete or re-enable actions in the first release. Disabling the final active Administrator must fail even under concurrent requests.

### 5. Sign out everywhere

Invalidate all current sessions without disabling the user or changing their role. Present this as one person-level action rather than a per-device session manager. Require confirmation, record a bounded reason, and report success only after invalidation is durable.

## Security requirements

The smaller interface does not reduce the authorization boundary:

- Every list and mutation is Administrator-only and server-enforced.
- Browser mutations require exact same-origin and live-session CSRF verification.
- Mutation requests use fixed schemas, bounded input, and an immutable role/capability allowlist.
- Optimistic-concurrency conflicts return a safe reload/review path; stale writes never silently win.
- Every command rechecks and locks the exact live Administrator session, user authorization version, fixed role, and required capability inside the mutation transaction so a slow request cannot outlive a demotion, disablement, logout, or expiry.
- Access reductions and project-scope changes invalidate sessions before success is returned.
- Final-active-Administrator protection is concurrency-safe and transactional.
- Mutation and audit evidence commit together or the operation fails closed.
- Role/project changes record exact ordered prior and new role/project sets in the append-only audit event; `project_memberships` remains the current authorization projection. The first-release project picker is capped at 50 assignments, well above expected use for this organization and within the bounded audit contract.
- Raw invitation, session, and future Field Link credentials are never stored, logged, or returned after their one intended presentation.
- The page never becomes the authorization boundary; hidden or disabled controls do not replace query and route enforcement.

## Deferred additions

### Field Links

Add a **Field Links** tab only when the field-assignment workflow exists. Create links from the exact project or assignment and list active links here for revocation. Use a separate hashed bearer-link store, show the raw link once, and expose only recipient/purpose label, exact project, seven- or fourteen-day expiry, status, and revoke. Do not reuse file links or create a Field Lead user.

### Activity — implemented in source

The **Activity** tab is implemented in source before a second-user or real-data rollout. It uses a separately privileged, projection-limited audit reader and shows only actor, action, target label, result, reason, and time. Fixed period, result, and action-category filters plus 25-row keyset pages keep the view bounded. Raw metadata, credentials, request bodies, internal identifiers, request/correlation data, and general runtime `SELECT` access remain unavailable. Audit export remains deferred until its retention and export contract is accepted.

## Bounded implementation branches

1. `codex/admin-access-core` — implemented in source, unapplied: migration version 4 seeds only the fixed role/capability catalog, binds invitations to one role and any Project Manager projects, and adds the five fixed command APIs with reasons, post-authorization actor-session fencing, audit, CSRF, optimistic concurrency, session invalidation, expired-invitation replacement, and final-Administrator protection. It requires empty version-3 role/access data; a populated database needs a separately reviewed backfill. It does not seed live users or issue a production session.
2. `codex/admin-access-page` — implemented in source: one bounded Administrator-only `GET /api/v1/admin/access` projection plus `/management/access` with the People table, pending invitations, read-only role guide, five workflows, direct-route denials, stale/final-Administrator handling, and responsive/accessibility browser coverage. The current Sites route is only a presentation/test adapter: it has no production employee-session or CSRF bootstrap and is intentionally not deployed. Unsupported actions remain absent rather than appearing as a large disabled console.
3. `codex/admin-audit-viewer` — implemented in the current source branch: a separately privileged, minimized `GET /api/v1/admin/audit` reader plus an independently loaded Activity tab with fixed filters, 25-row keyset pagination, Administrator-only route and presentation denials, and responsive/accessibility browser coverage. Source least privilege permits reads only through a security-barrier minimized projection; the branch does not expose raw audit fields, export data, apply database privileges, or deploy the page.
4. `codex/admin-field-links`: when the field-assignment model is scheduled, add the distinct hashed exact-project Field Link lifecycle, read route, and Field Links tab.

The first two branches are merged, and the third is implemented in the current source branch as the final source-only Administration and Access milestone. Audit writes are part of the core branch, while the minimized reader remains separately privileged. Field Links do not block the People or Activity views because no field-assignment workflow exists yet.

## Not included

- Custom roles or capability strings
- Per-user permission overrides
- Editable invitation, session, domain, or security-policy values
- A global role-permission toggle matrix
- Per-device session management
- User deletion or re-enablement
- Bulk import, Google Group synchronization, or direct Google sharing management
- Connector administration, recovery controls, job retry, or infrastructure settings
- Live OIDC, session issuance, migration/apply, deployment, a second user, or real client data

## Acceptance boundary

The People & Access source milestone is complete only when direct API and direct-route tests prove the same Administrator-only behavior as the rendered interface; concurrent final-Administrator mutations are denied; role/project reductions invalidate sessions; disabled users cannot reuse sessions; CSRF and stale-version requests fail closed; Activity pagination and filtering stay bounded without exposing raw audit fields; and keyboard, 200% zoom, mobile, tablet, and desktop behavior pass.

The page may be developed with fake Administrators, Office users, and Project Managers. It does not authorize a database migration, hosted configuration change, Google Workspace connection, employee invitation, deployment, second-user access, or real data.
