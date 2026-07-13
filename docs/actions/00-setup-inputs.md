# Action: Confirm setup inputs

Owner: Business owner

Status: Waiting on owner

Secrets required in GitHub: None

Record only the following non-secret decisions in this file or a GitHub issue. Leave secret values in Google Secret Manager or the hosted platform's encrypted settings.

## Required inputs

- [ ] Company Google Workspace primary domain: `TBD`
- [ ] Google Workspace super administrator contact: `TBD`
- [ ] Proposed FCI Operations connection account: `operations@TBD`
- [ ] Initial application administrator Workspace email: `TBD`
- [ ] Additional pilot users: `None — single-user pilot`
- [ ] Final production hostname or custom domain: `TBD`
- [x] Pilot login policy: keep allowlisted ChatGPT sign-in during the single-user pilot
- [x] Production login policy: individual Google Workspace accounts; no application passwords
- [x] Production platform: Google Cloud Run and Cloud SQL PostgreSQL

## Account policy

- Use a separate Workspace super administrator for tenant administration when practical.
- Use the proposed operations account for the Gmail, Calendar, Drive, and Sheets connection. It should be a normal company-controlled account, not a personal Gmail account.
- Give the operations account only the Workspace permissions required by the documented workflow.
- Use individual employee Workspace identities for application login. Never share the operations-account password with employees.

## Completion result

This action is complete when the domain, connection account, initial app administrator, and production hostname are known. No password, OAuth secret, encryption key, or token should be recorded here.
