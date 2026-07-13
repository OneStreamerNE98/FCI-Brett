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
- [ ] Business owner identifies the initial Admin account.
- [ ] Business owner decides whether same-domain users require an explicit invitation. Recommended: yes.

## Development actions

- [ ] Create a separate Google Identity/OIDC login client using only `openid email profile`.
- [ ] Verify the Google signature, issuer, audience, expiry, nonce/CSRF protection, `email_verified`, and signed `hd` company-domain claim on the server.
- [ ] Use Google's immutable `sub` claim as the external identity key, not email.
- [ ] Add durable users, sessions, roles, disabled status, and project memberships in Cloud SQL.
- [ ] Issue a Secure, HttpOnly, SameSite session cookie and support expiry, rotation, logout, and revocation.
- [ ] Replace trust in `oai-authenticated-user-email` for the Cloud Run deployment.
- [ ] Enforce authorization inside data queries for clients, projects, leads, dashboard, search, meetings, uploads, Gmail filing, and assistant evidence.
- [ ] Pass the real role to the interface instead of displaying `Administrator` for everyone.
- [ ] Audit login failures, logout, user disablement, role changes, and project assignments without logging tokens.

## Required tests

- [ ] Approved company Admin
- [ ] Approved Office user
- [ ] Project Manager assigned to a project
- [ ] Same-domain but uninvited user
- [ ] Outside Workspace account
- [ ] Personal Gmail account
- [ ] Disabled user
- [ ] Expired or revoked session
- [ ] Cross-project reads, search, assistant questions, and writes

## Completion result

This action is complete only when server-side authorization tests prove that each role can access exactly its approved records and sensitive actions.
