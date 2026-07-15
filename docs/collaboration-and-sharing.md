# Sharing the Floor Coverings International operations app

Source-code access and app access are separate. A developer needs the source repository to edit the application. An office user only needs access to the deployed app.

## Recommended source-code workflow

Use the existing [`OneStreamerNE98/FCI-Brett`](https://github.com/OneStreamerNE98/FCI-Brett) repository as the canonical collaboration history. It is currently public: anyone may read it, while an authorized collaborator still needs Write access to push an assigned branch. The owner should decide whether to make it private before operational configuration begins.

1. Keep one canonical editable clone per developer. The owner's current clone is in OneDrive; do not create a second editable copy, and stop to reconcile Git if synchronization creates conflicts or duplicate files.
2. Invite the developer with **Write** access, not **Admin** access.
3. Protect `main` and require a pull request before changes are merged.
4. Have each developer clone the repository and create their own uncommitted `.env.local` from `.env.example`.
5. Keep `GOOGLE_INTEGRATION_MODE=simulation` in local development. Production Google Workspace settings belong only in the hosting environment or Google Secret Manager.

Example commands for a new contributor:

```powershell
git clone https://github.com/OneStreamerNE98/FCI-Brett.git
cd FCI-Brett
Copy-Item .env.example .env.local
npm.cmd ci
npm.cmd run dev
```

## Never commit or share in chat

- `.env.local`, `.dev.vars`, or populated environment files
- Google OAuth client-secret downloads, refresh tokens, or token-encryption keys
- OpenAI, SMS-provider, or hosting credentials
- `.wrangler`, `dist`, `node_modules`, logs, or local databases
- real client exports, attachments, photos, or meeting transcripts

The tracked `.openai/hosting.json` contains non-secret project and storage binding identifiers. GitHub access alone does not grant permission to deploy the production site.

## Sharing the running app

The current hosted app and the GitHub repository have different access controls. Add source editors in GitHub. Add app users through the hosting access policy and the app's `FCI_OFFICE_EMAILS` or `FCI_OFFICE_DOMAINS` allowlist.

Until native Google Workspace sign-in is implemented, the hosted Sites development environment uses Sign in with ChatGPT for identity and the server-side office allowlist for data access. The accepted production architecture uses Google Cloud with the company's Google Workspace identities and domain restrictions; see `docs/architecture-decision-production-platform.md`, `docs/complete-product-and-google-cloud-architecture-audit.md`, and `docs/google-cloud-runtime-foundation.md`.

## Optional Drive copy

A ZIP snapshot can be stored in Google Drive for backup or reference, but it should not be edited in place and should never contain secrets, dependencies, local databases, or real customer data.
