# Sharing the Floor Coverings International operations app

Source-code access and app access are separate. A developer needs the source repository to edit the application. An office user only needs access to the deployed app.

## Recommended source-code workflow

Use a private GitHub repository, preferably owned by the company. Do not use a synchronized Google Drive or OneDrive folder as the active Git repository; file sync can conflict with Git and can accidentally copy local credentials, build output, or databases.

1. Create an empty private GitHub repository.
2. Push this repository's `main` branch after the current release is committed.
3. Invite the developer with **Write** access, not **Admin** access.
4. Protect `main` and require a pull request before changes are merged.
5. Have each developer clone the repository and create their own uncommitted `.env.local` from `.env.example`.
6. Keep `GOOGLE_INTEGRATION_MODE=simulation` in local development. Production Google Workspace settings belong only in the hosting environment or Google Secret Manager.

Example commands after the private repository is created:

```powershell
git remote add origin https://github.com/YOUR-COMPANY/fci-operations.git
git push -u origin main
```

The invited developer can then use:

```powershell
git clone https://github.com/YOUR-COMPANY/fci-operations.git
cd fci-operations
Copy-Item .env.example .env.local
npm install
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

Until native Google Workspace sign-in is implemented, the hosted Sites build uses Sign in with ChatGPT for identity and the server-side office allowlist for data access. The eventual Google Cloud production deployment should use the company's Google Workspace identities and domain restrictions.

## Optional Drive copy

A ZIP snapshot can be stored in Google Drive for backup or reference, but it should not be edited in place and should never contain secrets, dependencies, local databases, or real customer data.
