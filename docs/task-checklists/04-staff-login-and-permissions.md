# Task checklist: Build staff Google login and permissions

Owner: Codex/developer, with policy approval from the business owner

Status: Approved policy, Administration and Access branches, Workspace OIDC/invitation/session-issuance source, and OIDC-02/#54 hardening are merged; the People/Activity presentation adapter is deployed only to private Sites development. OIDC-03/#55 remains in draft review and unmerged; live configuration, production session/UI composition, providers, PostgreSQL migration/grants, and production deployment remain open

Local simulation depends on: Recorded first-rollout sensitive-action decisions and the production persistence boundary

Live login additionally depends on: Production hostname, Google Cloud foundation, staging/recovery evidence, and separate rollout approval

This is development work, not a Google Admin switch. Do not add a second user until it is complete.

## Approved first-rollout defaults

| Role | Approved simulated access |
| --- | --- |
| Administrator | Company-wide operational and financial records; all Office/Project Manager operations; project creation/assignment; Gmail filing; Calendar creation; file view/upload/share; export; audit view; and narrowly named access-administration capabilities |
| Office | Company-wide nonfinancial operational records; create/update leads, clients, and contacts; update existing project status, tasks, meetings, and notes; view/upload files |
| Project Manager | Nonfinancial assigned-project records and minimum related client/contact context; update assigned project status, tasks, meetings, and notes; view/upload assigned-project files |

- [x] Business owner approved the listed Administrator-only sensitive actions and deny-by-default handling for actions not approved.
- [x] Business owner approved the Office Operations company-wide nonfinancial ceiling and the Project Manager assigned-project ceiling above.
- [x] The owner selected `admincrm@cherryhillfci.com` and `brett@cherryhillfci.com` as the two initial Admin identities.
- [x] The owner confirmed `admincrm@cherryhillfci.com` is individual and not shared. Its managed Workspace status and immutable issuer/`sub` binding remain unverified; Brett's individual managed identity verification also remains open.
- [x] Every same-domain employee requires a single-use explicit application invitation for one exact email and role; invitations expire after seven days.
- [x] Employee sessions use a 30-minute inactivity timeout and an eight-hour absolute lifetime.
- [x] Each employee has exactly one supported role; per-user capability overrides are prohibited.
- [x] Sales/Estimator is excluded from the first rollout; its eventual role remains a later decision.
- [x] Field/crew leads use read-only exact-project links with a seven-day default, fourteen-day maximum, and immediate revocation rather than employee accounts; subcontractors receive no accounts or employee role, and any future subcontractor link remains unapproved.
- [ ] Complete direct Google access, Groups, lifecycle ownership, and final cross-system role responsibilities in the [20-user access checklist](06-20-user-operating-model-and-access.md).

These decisions authorize local policy and route work only. They do not set the later employee rollout order or admit either Administrator. Office and Project Manager contexts remain fake test principals, and the existing one-live-user development gate remains in force.

## Source-only authorization simulation

- [x] Resolve hashed sessions with idle/absolute expiry, logout/revocation, disabled-user, authorization-version, and invalidation-time checks.
- [x] Add deny-by-default capability evaluation and the approved granular Administrator, Office, and Project Manager ceilings without generic writes or per-user overrides.
- [x] Model Field Lead as an expiring exact-assignment link principal, never as an employee user/session.
- [x] Enforce project membership inside PostgreSQL read queries and prevent financial-field leakage to non-Admins.
- [x] Require exactly one active supported role and recheck current same-role sensitive capabilities plus exact Project Manager membership in SQL.
- [x] Protect dashboard, search, Gmail-filing, Calendar-create, file-view/upload/share, export, and audit-view contracts behind fixed-operation source-only service gates.
- [x] Append content-minimized security-audit evidence for denials and sensitive decisions without logging session/link tokens.

## Source-only Cloud Run employee routes

- [x] Add bounded host-only session-cookie parsing, immediate credential hashing, exact same-origin mutation checks, hashed CSRF matching, generic denial responses, and secure cookie clearing.
- [x] Compose PostgreSQL-backed dashboard, search, project list/exact-project, client list, and logout source routes.
- [x] Compose file list/upload/share, Gmail-file, and Calendar-create routes through authorization; without production action adapters they deliberately return `503 feature_unavailable` after authorization succeeds.
- [x] Preserve health/readiness, drain behavior, migration-command separation, and denial of the Sites identity header in the Cloud Run module graph.
- [x] Add source-only durable invitation fulfillment, Workspace OIDC verification, and secure session issuance. PR #38 implemented the path; PR #48 corrected real-callback compatibility; and OIDC-02 is complete in source in PR #54. OIDC-03 remains in unmerged draft PR #55, and every live apply/configuration gate remains open.
- [ ] Add production file and Google provider adapters only after their persistence, configuration, classification, and direct-access gates are accepted.
- [ ] Add route-level/browser evidence for the complete supported interface. Source composition is not deployment evidence.

## Later live employee login and composition

- [ ] Create a separate Google Identity/OIDC login client using only `openid email profile`.
- [x] Implement server verification of Google signature, issuer, audience, expiry, nonce/PKCE/state protection, `email_verified`, and signed `hd=cherryhillfci.com`; live company-client verification remains gated.
- [x] Use Google's immutable `sub` claim as the external identity key, not email.
- [x] Define generic durable users, sessions, roles, disabled status, and project memberships in the unapplied Cloud SQL schema; no live rows are seeded.
- [x] Fulfill durable invitations against exact email/status/role and bind verified Google issuer/`sub` before creating a session in source; migrations and live rows remain unapplied.
- [ ] Compose production provider adapters for the authorization-gated Gmail, Calendar, and file routes; export and financial-report routes remain open. The minimized audit-view route exists only in source behind a separately privileged reader.
- [ ] Complete the employee-session lifecycle. Secure, HttpOnly, SameSite issuance plus expiry/logout/revocation exist in source; rotation and sliding idle renewal remain open, and nothing is live.
- [ ] Deploy the source-tested Cloud Run identity boundary that rejects `oai-authenticated-user-email`; no production deployment exists yet.
- [ ] Enforce authorization inside data queries for clients, projects, leads, dashboard, search, meetings, uploads, Gmail filing, and assistant evidence.
- [x] Display the current server-derived access label (`Admin` or `Office`) instead of labeling every allowlisted user Administrator.
- [ ] Pass the durable OIDC role, capabilities, and project scope to the interface after production users and sessions exist.
- [ ] Remove company-wide list/search/dashboard/assistant results for roles limited to assigned projects.
- [ ] Revoke active sessions immediately when a user is disabled or materially loses access; the resolver and source logout already honor persisted revocation/invalidation.
- [ ] Audit login failures, logout, user disablement, role changes, and project assignments without logging tokens.

## Source-simulation tests

- [x] Approved company Admin
- [x] Approved Office user
- [x] Project Manager assigned to a project
- [x] Project Manager membership expired or authorization version changed while signed in
- [x] Pure admission-policy fixtures for an uninvited `cherryhillfci.com` user, an outside-domain account, and a personal Gmail account; durable invitation/OIDC binding is implemented in source, with the OIDC-03 negative/real-PostgreSQL backfill in unmerged draft PR #55
- [x] Disabled user
- [x] Expired or revoked session
- [x] Field link exact-project, expiry, revocation, and no-global-surface denials
- [x] Sales/Estimator excluded and subcontractor has no employee session
- [x] Explicit denial of every Admin-only capability for Office, Project Manager, and Field link contexts
- [x] Cross-project project list, direct lookup, client context, search, dashboard aggregation, and protected-callback denials in source tests; the real PostgreSQL suite requires `TEST_POSTGRES_URL` and is skipped locally when it is absent
- [ ] Cross-project assistant evidence and production route writes after those surfaces are composed
- [x] Direct access-administration API and bookmarked `/management/access` tests deny Office, Project Manager, and outside-domain presentation identities before protected work; broader feature-route coverage remains in the frontend checklist.
- [x] Activity API and rendered-tab tests deny Office, Project Manager, outside-domain, and expired-session contexts; bounded filters/keyset pagination never expose raw audit metadata or internal request identifiers.
- [ ] Google Group/folder/calendar access removal matches the application role change

## Administration page follow-on

- [x] Implement `codex/admin-access-core` in source: fixed APIs for invite/revoke, one-role and Project Manager assignment changes, disablement, and sign-out-everywhere. The three role presets and invitation/session policy remain read-only; no per-user overrides exist; the commands enforce the immutable allowlist, required reasons, CSRF, optimistic concurrency, transactionally coupled audit, session invalidation, and final-Administrator protection. Migration version 4 remains unapplied.
- [x] Build and merge `codex/admin-access-page` as Management → People & Access with one bounded people/invitation projection, a read-only role guide, five workflows, optimistic-conflict and final-Administrator feedback, and direct-route, responsive/accessibility, and rendered denial evidence. No custom roles, permission matrix, per-device sessions, deletion, or re-enablement were added. Its private Sites presentation adapter is deployed; production employee-session/CSRF composition remains open.
- [x] Merge `codex/admin-audit-viewer` with a separately privileged minimized reader, fixed filters, 25-row keyset pagination, and the responsive/accessibility-tested Activity tab. The private Sites presentation adapter is deployed, but production migration 5, the database reader privilege, and Cloud Run composition remain unapplied or undeployed. Build `codex/admin-field-links` only when the field-assignment model is scheduled.

## Completion result

This action is complete only when server-side authorization tests prove that each role can access exactly its approved records and sensitive actions.
