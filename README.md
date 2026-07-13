# Floor Coverings International Operations

Commercial flooring operations software for client intake, independent project delivery, crew scheduling, and Google Workspace organization.

## View the hosted pilot

Open the [FCI Operations ChatGPT website](https://groundwork-flooring-ops.jaggerisagoodboy.chatgpt.site/) to view the current hosted application. Access requires an authorized ChatGPT sign-in. Use only clearly marked test data until the production acceptance checklist in this README passes.

[![Build and test](https://github.com/OneStreamerNE98/FCI-Brett/actions/workflows/ci.yml/badge.svg)](https://github.com/OneStreamerNE98/FCI-Brett/actions/workflows/ci.yml)

## Action Center

Open the [Google Workspace and product-readiness Action Center](docs/actions/README.md) for topic-by-topic owner tasks, current blockers, hosted configuration, the 20-user access model, production migration, staff-login development, operations, interface hardening, and acceptance checklists. Complete [Setup inputs and decisions](docs/actions/00-setup-inputs.md) first. Never enter passwords, OAuth secrets, encryption keys, or tokens in GitHub.

## Prerequisites

- Node.js `>=22.13.0`

## Local prototype

```bash
npm install
npm run dev
npm run build
```

Copy `.env.example` to `.env.local`. Keep `GOOGLE_INTEGRATION_MODE=simulation` while developing locally: Gmail, Calendar, Shared Drive, and Sheets use durable sample state and never contact Google. Switch to `workspace` only after the company has a Google Workspace tenant, Shared Drive, mailbox, calendars, Sheet, and administrator-approved OAuth client.

For local testing only, set `FCI_LOCAL_DEV_USER_EMAIL` in `.env.local` to your own email and add that same address to `FCI_ADMIN_EMAILS`. The fallback is available only to `npm run dev` on `localhost`; the hosted site still requires ChatGPT sign-in.

## Included capabilities

- Client Directory with repeat clients and multiple independent projects
- Email and file-filing rule configuration under Settings
- One protected company Google Workspace OAuth connection for Drive, Gmail, Calendar, and Sheets
- Local Workspace simulation with sample mail, calendar events, folders, drafts, and Sheet sync state
- Google Drive / Shared Drive and Google Sheet organizational blueprint
- Gmail review queue, Calendar test controls, client/project activity, and AI assistant prototype; project scheduling remains planned
- Durable project meeting notes with Otter links, summaries, decisions, action items, transcript excerpts, and assistant evidence
- D1-backed data-model and API foundation for clients, contacts, projects, meetings, rules, mail items, and workspace settings

## Current readiness

The application is ready for a controlled, single-user pilot using clearly marked test data. It is not yet approved for real client data or a multi-user company rollout.

The current build includes hosted authentication with an office allowlist, durable clients/leads/projects/meetings, review-first Gmail filing, Shared Drive project folders, a one-way Google Sheets mirror, Calendar test controls, and a records-based project assistant. Scheduling, messaging, full record editing, project tasks, closeout, production background workers, and permission-filtered document indexing are not complete.

Before real client data is stored, backup restoration, sensitive-action audit coverage, project permissions, and the complete test lifecycle must pass.

## Production architecture

The architecture decision is accepted. The current Sites/Workers/D1/R2 deployment remains a controlled pilot; production will use a small regional Google Cloud topology centered on Cloud Run, Cloud SQL PostgreSQL, Secret Manager, Cloud Tasks, Cloud Storage quarantine, Google Workspace OIDC, Gmail Pub/Sub notifications, and Calendar HTTPS webhooks. Defer `pgvector` until permission-filtered document indexing is scheduled. Complete this migration before building scheduling, messaging, or AI document indexing.

Read [`docs/architecture-decision-production-platform.md`](docs/architecture-decision-production-platform.md) for the migration boundary, cutover requirements, and consequences.

## Remaining launch decision

A controlled one-user pilot may continue with the current allowlisted ChatGPT sign-in. Implement Google Workspace OpenID Connect login, application roles, and project permissions before admitting a second user. The Google Workspace data connection does not provide application login.

## Prioritized next work

Complete the next product milestone in this order:

1. Build the Google Cloud production foundation and tested migration/cutover path.
2. Add Google Workspace OIDC plus Admin, Office, and Project Manager roles with server-enforced project permissions.
3. Add editing and archiving for clients, contacts, leads, projects, and meetings.
4. Implement lead conversion as one atomic transaction.
5. Add project dates, durable tasks/follow-ups, notes, file metadata, photo UI, and activity history.
6. Make saved Calendar IDs and settings authoritative in the live integration.
7. Connect uploads to project Files and Shared Drive, including scanning and quarantine.
8. Add route, integration, and browser-behavior tests; validate backup restoration; and add an administrator audit viewer.

After that foundation is accepted, build appointment state management and Calendar reconciliation; workers, crews, shifts, conflicts, publishing, and acknowledgements; provider-neutral messaging with consent and delivery tracking; durable Gmail review queues; and project closeout. Permission-filtered AI indexing, forecasting, retry dashboards, and a Workspace Marketplace add-on come later.

See the [20-user product and architecture review](docs/20-user-product-and-architecture-review.md) for the rollout verdict, architecture, access model, priority findings, and corrected delivery order. See [`docs/ui-and-product-readiness-review.md`](docs/ui-and-product-readiness-review.md) for the detailed page-by-page UI audit.

## Google Workspace pilot rollout

Use only records named `FCI TEST — DO NOT USE` until the production acceptance checklist passes.

1. Select a company-controlled Workspace connection account, ideally `operations@yourdomain.com`.
2. Create the `FCI Operations` Shared Drive, `FCI Operations Directory` spreadsheet, `FCI • Client Appointments` calendar, and `FCI • Field Schedule` calendar.
3. Create the company Google Cloud project, enable the required APIs, and configure an Internal OAuth application with the exact hosted callback URI.
4. Store the OAuth secret and token-encryption key only in encrypted hosted secret settings. Never commit, email, document, or place them in Drive.
5. Deploy the runtime configuration with Drive provisioning disabled.
6. Connect the exact authorized Workspace account and verify Gmail, Drive, Calendar, and Sheets independently.
7. Enable Drive provisioning only after Shared Drive verification succeeds, then create and inspect one test project folder.
8. Run the complete pilot lifecycle: two projects for one test client, Sheets mirroring, reviewed Gmail copy and attachments, a reply draft, Calendar test hold, meeting evidence, assistant citations, and a rejected unauthorized login.

The application remains the system of record. The directory spreadsheet is a one-way mirror except for its intentionally spreadsheet-owned Account Notes field. Gmail messages are copied only after explicit review and remain in the Inbox; replies are drafts until a person intentionally sends them.

See [`docs/google-workspace-rollout-guide.md`](docs/google-workspace-rollout-guide.md) for the exact administrator procedure, runtime values, troubleshooting, and production acceptance checklist. Also see [`docs/meeting-notes-and-otter.md`](docs/meeting-notes-and-otter.md) and [`docs/collaboration-and-sharing.md`](docs/collaboration-and-sharing.md).

## Repository and development handoff

Keep one canonical development repository outside OneDrive. Use a private, business-owned GitHub repository for collaboration and backup; use OneDrive for business documents, exports, training material, and a repository link rather than a second editable source tree.

- Protect `main` as the last accepted release.
- Use `codex/<short-feature-name>` feature branches and pull requests.
- Require passing tests, a production build, UI screenshots when applicable, and a short data/security impact note before merging.
- Give developers Write access rather than Admin access and use separate development OAuth credentials where needed.
- Share `.env.example`, never `.env.local`, OAuth credentials, encryption keys, tokens, `node_modules`, build caches, or production client exports.
- Preserve the current Google Workspace test integration and existing user data when continuing development.
- Do not deploy a public version without owner approval.

See [`docs/codex-project-handoff.md`](docs/codex-project-handoff.md) for moving this work between local Codex projects. For coworker collaboration, use the complete [`Codex-to-Codex handoff guide`](docs/codex-to-codex-handoff.md), including GitHub access, cloning, project setup, onboarding prompts, branch workflow, and handback requirements.

## Workspace Auth Headers

OpenAI workspace sites can read the current user's email from
`oai-authenticated-user-email`.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: build the application and run source-level prototype checks
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
