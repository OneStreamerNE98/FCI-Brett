# Task checklist: Build staff Google login and permissions

Owner: Codex/developer, with policy approval from the business owner

Status: Source-only authorization simulation implemented; live employee OIDC and route composition remain unimplemented

Local simulation depends on: Recorded first-rollout sensitive-action decisions and the production persistence boundary

Live login additionally depends on: Production hostname, Google Cloud foundation, staging/recovery evidence, and separate rollout approval

This is development work, not a Google Admin switch. Do not add a second user until it is complete.

## Conservative authorization-simulation defaults

| Role | Approved simulated access |
| --- | --- |
| Admin | Company-wide records plus the owner-approved sensitive capabilities; audit viewing is modeled but its database read boundary remains deferred |
| Office | Provisional least-access default: company-wide nonfinancial operational reads; no approved Google actions, financials, exports, audit, project creation/assignment, connector, or user administration |
| Project Manager | Provisional least-access default: only assigned-project reads and minimum related client/contact context; no approved Google actions, financials, exports, audit, project creation, or assignment changes |

- [x] Business owner approved the listed Administrator-only sensitive actions and deny-by-default handling for actions not approved.
- [ ] Business owner must still approve complete Office Operations and Project Manager responsibilities and project/cross-project visibility rules; the simulator currently uses the conservative defaults above.
- [x] The owner selected `admincrm@cherryhillfci.com` and `brett@cherryhillfci.com` as the two initial Admin identities.
- [ ] Verify both Admin identities are individual managed accounts assigned to named people; `admincrm@cherryhillfci.com` must not be a shared password or generic staff login.
- [x] Every same-domain employee requires an explicit application invitation.
- [x] Sales/Estimator is excluded from the first rollout; its eventual role remains a later decision.
- [x] Field/crew leads use expiring assignment links rather than employee accounts; subcontractors receive no accounts.
- [ ] Complete direct Google access, Groups, lifecycle ownership, and final cross-system role responsibilities in the [20-user access checklist](06-20-user-operating-model-and-access.md).

These decisions authorize local policy simulation only. They do not set the later employee rollout order or admit either Administrator. Office and Project Manager contexts remain fake test principals, and the existing one-live-user development gate remains in force.

## Source-only authorization simulation

- [x] Resolve hashed sessions with idle/absolute expiry, logout/revocation, disabled-user, authorization-version, and invalidation-time checks.
- [x] Add deny-by-default capability evaluation, the approved Administrator-only capabilities, and conservative fake Office/Project Manager read mappings pending final responsibility approval.
- [x] Model Field Lead as an expiring exact-assignment link principal, never as an employee user/session.
- [x] Enforce project membership inside PostgreSQL read queries and prevent financial-field leakage to non-Admins.
- [x] Protect dashboard, search, Gmail-filing, Calendar-create, file-share, export, and audit-view contracts behind fixed-operation source-only service gates; file view/download remains explicitly denied.
- [x] Append content-minimized security-audit evidence for denials and sensitive decisions without logging session/link tokens.

## Later live employee login and composition

- [ ] Create a separate Google Identity/OIDC login client using only `openid email profile`.
- [ ] Verify the Google signature, issuer, audience, expiry, nonce/CSRF protection, `email_verified`, and signed `hd=cherryhillfci.com` claim on the server.
- [ ] Use Google's immutable `sub` claim as the external identity key, not email.
- [ ] Add durable users, sessions, roles, disabled status, and project memberships in Cloud SQL.
- [ ] Compose the approved Gmail filing, Calendar creation, Drive provisioning/sharing, exports, financial data, and audit-view capabilities into production routes. User/connector administration and recovery/retry authority remain owner decisions and stay denied.
- [ ] Issue a Secure, HttpOnly, SameSite session cookie and support expiry, rotation, logout, and revocation.
- [ ] Replace trust in `oai-authenticated-user-email` for the Cloud Run deployment.
- [ ] Enforce authorization inside data queries for clients, projects, leads, dashboard, search, meetings, uploads, Gmail filing, and assistant evidence.
- [x] Display the current server-derived access label (`Admin` or `Office`) instead of labeling every allowlisted user Administrator.
- [ ] Pass the durable OIDC role, capabilities, and project scope to the interface after production users and sessions exist.
- [ ] Remove company-wide list/search/dashboard/assistant results for roles limited to assigned projects.
- [ ] Revoke active sessions immediately when a user is disabled or materially loses access.
- [ ] Audit login failures, logout, user disablement, role changes, and project assignments without logging tokens.

## Source-simulation tests

- [x] Approved company Admin
- [x] Approved Office user
- [x] Project Manager assigned to a project
- [x] Project Manager membership expired or authorization version changed while signed in
- [x] Pure admission-policy fixtures for an uninvited `cherryhillfci.com` user, an outside-domain account, and a personal Gmail account; durable invitation/OIDC binding remains unimplemented
- [x] Disabled user
- [x] Expired or revoked session
- [x] Field link exact-project, expiry, revocation, and no-global-surface denials
- [x] Sales/Estimator excluded and subcontractor has no employee session
- [x] Explicit denial of every Admin-only capability for Office, Project Manager, and Field link contexts
- [x] Cross-project project list, direct lookup, client context, search, dashboard aggregation, and protected-callback denials in source tests; the real PostgreSQL suite requires `TEST_POSTGRES_URL` and is skipped locally when it is absent
- [ ] Cross-project assistant evidence and production route writes after those surfaces are composed
- [ ] Direct API and bookmarked URL access after the interface hides a forbidden action
- [ ] Google Group/folder/calendar access removal matches the application role change

## Completion result

This action is complete only when server-side authorization tests prove that each role can access exactly its approved records and sensitive actions.
