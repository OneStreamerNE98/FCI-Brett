# Action: Build staff Google login and permissions

Owner: Codex/developer, with policy approval from the business owner

Status: Not implemented

Depends on: Production hostname, Google Cloud foundation, and approved role policy

This is development work, not a Google Admin switch. Do not add a second user until it is complete.

## Proposed role policy

| Role | Proposed access |
| --- | --- |
| Admin | Company-wide records, user/role administration, connection administration, audit access |
| Office | Company-wide operational records and approved day-to-day Workspace actions; no connection or user administration |
| Project Manager | Only assigned projects and the client/contact context required for those projects |

- [ ] Business owner approves or changes this role policy.
- [ ] Business owner identifies two initial Admin accounts so recovery does not depend on one person.
- [ ] Business owner requires an explicit invitation for same-domain users. Recommended: yes.
- [ ] Business owner decides whether Sales/Estimator is part of Office or a separate role.
- [ ] Business owner decides whether field/crew leads receive a limited application role or expiring links.
- [ ] Business owner approves the [cross-system Google access matrix](06-20-user-operating-model-and-access.md).

## Development actions

- [ ] Create a separate Google Identity/OIDC login client using only `openid email profile`.
- [ ] Verify the Google signature, issuer, audience, expiry, nonce/CSRF protection, `email_verified`, and signed `hd=cherryhillfci.com` claim on the server.
- [ ] Use Google's immutable `sub` claim as the external identity key, not email.
- [ ] Add durable users, sessions, roles, disabled status, and project memberships in Cloud SQL.
- [ ] Add server-enforced capabilities for user administration, connector administration, Gmail filing, Calendar writes, Drive provisioning/sharing, exports, financial data, audit, and recovery.
- [ ] Issue a Secure, HttpOnly, SameSite session cookie and support expiry, rotation, logout, and revocation.
- [ ] Replace trust in `oai-authenticated-user-email` for the Cloud Run deployment.
- [ ] Enforce authorization inside data queries for clients, projects, leads, dashboard, search, meetings, uploads, Gmail filing, and assistant evidence.
- [x] Display the server-derived pilot access label (`Admin` or `Office`) instead of labeling every allowlisted user Administrator.
- [ ] Pass the durable OIDC role, capabilities, and project scope to the interface after production users and sessions exist.
- [ ] Remove company-wide list/search/dashboard/assistant results for roles limited to assigned projects.
- [ ] Revoke active sessions immediately when a user is disabled or materially loses access.
- [ ] Audit login failures, logout, user disablement, role changes, and project assignments without logging tokens.

## Required tests

- [ ] Approved company Admin
- [ ] Approved Office user
- [ ] Project Manager assigned to a project
- [ ] Project Manager removed from a project while signed in
- [ ] Uninvited `cherryhillfci.com` user
- [ ] Outside Workspace account
- [ ] Personal Gmail account
- [ ] Disabled user
- [ ] Expired or revoked session
- [ ] Cross-project reads, search, assistant questions, and writes
- [ ] Direct API and bookmarked URL access after the interface hides a forbidden action
- [ ] Google Group/folder/calendar access removal matches the application role change

## Completion result

This action is complete only when server-side authorization tests prove that each role can access exactly its approved records and sensitive actions.
