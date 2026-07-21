# Floor Coverings International Operations

Commercial flooring operations software for client intake, independent project delivery, crew scheduling, and Google Workspace organization.

## View the development site

Open the [FCI Operations ChatGPT website](https://groundwork-flooring-ops.jaggerisagoodboy.chatgpt.site/) to view the current hosted application. Access requires an authorized ChatGPT sign-in. Use only clearly marked test data until the production acceptance checklist in this README passes.

[![CI - automated build and tests](https://github.com/OneStreamerNE98/FCI-Brett/actions/workflows/ci.yml/badge.svg)](https://github.com/OneStreamerNE98/FCI-Brett/actions/workflows/ci.yml)

## Task Checklists

Open the [Google Workspace and product-readiness Task Checklists](docs/task-checklists/README.md) for topic-by-topic owner tasks, current blockers, hosted configuration, the 20-user access model, production migration, staff-login development, operations, interface hardening, and acceptance checklists. Complete [Setup inputs and decisions](docs/task-checklists/00-setup-inputs.md) first. These are human-owned checklists; the GitHub **Actions** badge above is the separate automated build-and-test service. Never enter passwords, OAuth secrets, encryption keys, or tokens in GitHub.

## Prerequisites

- Node.js `>=22.13.0`

## Local development

```bash
npm install
npm run db:migrate:local
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
- Source-only, default-off [Google Chat notifications](docs/google-chat-notifications.md) with typed one-way cards, secret-name-only routing, and simulation audit logging; no webhook is configured and no live message is sent
- Google Drive / Shared Drive and Google Sheet organizational blueprint
- On-demand Gmail review suggestions, Calendar test controls, client/project activity, and an in-development AI assistant; a durable Gmail queue/watch processor and project scheduling remain planned
- Durable project meeting notes with Otter links, summaries, decisions, action items, transcript excerpts, and assistant evidence
- D1-backed data-model and API foundation for clients, contacts, projects, meetings, rules, mail items, and workspace settings

## Current readiness

The hosted application is the working, single-user development copy and uses clearly marked test data. It is not yet approved for real client data or a multi-user company rollout.

The current build includes hosted authentication with an office allowlist, durable clients/leads/projects/meetings, review-first Gmail filing, Shared Drive project folders, a one-way Google Sheets mirror, Calendar test controls, and a records-based project assistant. Scheduling, messaging, full record editing, project tasks, closeout, production background workers, and permission-filtered document indexing are not complete.

Before real client data is stored, backup restoration, sensitive-action audit coverage, project permissions, and the complete test lifecycle must pass.

## Production architecture

The architecture decision is accepted. The current Sites/Workers/D1/R2 deployment remains the test-data development environment. The minimum production core is one regional Cloud Run application, one selected Cloud SQL PostgreSQL profile, Secret Manager integration, Google Workspace OIDC, and the required identity, authorization, audit, monitoring, backup, and restore controls. Cloud Tasks, Cloud Scheduler, Cloud Storage quarantine/scanning, Gmail Pub/Sub, Calendar HTTPS channels, SMS, and `pgvector` are activated only when their associated features and acceptance gates are approved.

The [Workspace-first, cost-controlled rollout decision](docs/architecture-decision-workspace-first-cost-controlled-rollout.md) explains how the company will reuse its existing Workspace subscription, keep staging on demand, compare standalone and HA Cloud SQL before choosing, use budget alerts, and keep optional infrastructure disabled by default. Three isolated project boundaries do not mean three continuously running stacks, and Sheets remains a derived projection rather than the operational database.

The first [Google Cloud runtime foundation](docs/google-cloud-runtime-foundation.md) is now reviewable in source: a separate fail-closed Cloud Run image, private Cloud SQL connector and bounded pools, a one-off migration command, exact migration-aware health checks, least-privilege role policy, and a test-only bounded core rehearsal. It has not been provisioned or deployed. PostgreSQL-backed dashboard, search, project list/detail/create, client list/create, lead list/create, project-meeting list/create, logout, and fixed administration paths are source-composed; authenticated mutations require the secure session and same-origin CSRF, while the four core-record creation POSTs additionally require an idempotency key and return the `{data}` envelope. File, Gmail, and Calendar provider actions intentionally return `503 feature_unavailable` until their production adapters are supplied. Workspace OIDC initiation/callback, durable invitation redemption, secure session issuance, the approved fixed application roles and capability ceilings, and project-scoped authorization are also source-composed. The broader interface and remaining routes are still outside this source-only boundary. OIDC-02 verifier/cookie hardening and OIDC-03 security-test coverage are complete in source in PRs #54/#55. Live identity configuration, PostgreSQL migration/grant apply, production session/UI composition, and deployment remain open.

The source-only [Google Workspace watch, queue, and sync-state design](docs/google-workspace-watch-and-queue-design.md) defines the future Gmail polling and Calendar HTTPS-channel decisions plus provider-neutral job/failure/replay and encrypted cursor contracts with local fakes. It provisions no queue, schedule, watch, channel, webhook, provider adapter, or hosted configuration.

Read [`docs/architecture-decision-production-platform.md`](docs/architecture-decision-production-platform.md) for the production boundary and the [cost-controlled rollout decision](docs/architecture-decision-workspace-first-cost-controlled-rollout.md) for provisioning phases, Workspace responsibilities, cost gates, and the historical infrastructure-definition assignment fulfilled in PR #15. The [active agent execution plan](docs/agent-plan-architecture-workspace-and-setup.md) owns current implementation status, while the [complete product and Google Cloud architecture audit](docs/complete-product-and-google-cloud-architecture-audit.md) retains the capability map, durable job/reminder design, integration reliability requirements, owner decisions, acceptance gates, and ordered branch history.

## Remaining launch decision

The one-user development environment may continue with the current allowlisted ChatGPT sign-in. Workspace OIDC, durable invitation/session issuance, the approved application roles, project-scoped authorization, verifier/cookie hardening, and the negative/real-PostgreSQL login test matrix now exist in source through PR #55. Before admitting a second user, configure live identity with explicit owner approval, apply the PostgreSQL migrations and grants, compose the production session/UI boundary, deploy, and pass the recorded acceptance gates. The Google Workspace data connection does not provide application login.

## Prioritized next work

Use the repository ledgers instead of copying a task list here: the [agent execution plan](docs/agent-plan-architecture-workspace-and-setup.md) is authoritative for active backend, Workspace, and Settings work; the [design-critique remediation plan](docs/design-critique-fix-plan.md) owns UI remediation; the [owner task checklists](docs/task-checklists/README.md) own setup and acceptance actions; and the [architecture audit roadmap](docs/complete-product-and-google-cloud-architecture-audit.md#ordered-branch-sized-implementation-roadmap) preserves branch history and gates. The [Pre-Workspace development plan](docs/pre-workspace-development-plan.md) distinguishes work that can proceed locally from work that needs credentials or approval. GitHub issues and pull requests may mirror these ledgers for delivery and review, but they do not create a separate task source of truth.

See the [20-user product and architecture review](docs/20-user-product-and-architecture-review.md) for the rollout verdict, architecture, access model, priority findings, and corrected delivery order. See [`docs/ui-and-product-readiness-review.md`](docs/ui-and-product-readiness-review.md) for the detailed page-by-page UI audit.

Development can continue safely before the live Google connection. Follow the [Pre-Workspace development plan](docs/pre-workspace-development-plan.md) for the parallel owner decisions, portable platform work, interface improvements, authorization foundations, and tasks that must wait for Workspace resources or credentials. The completed [portable client and project creation slice](docs/portable-record-creation.md) documents the provider-neutral boundaries and development-environment compatibility. The source-only [production PostgreSQL foundation](docs/production-postgresql-foundation.md), [PostgreSQL repository slice](docs/production-postgresql-repositories.md), and [Google Cloud runtime foundation](docs/google-cloud-runtime-foundation.md) document the constrained core schema, immutable runner, repository/runtime composition, safety controls, and work that still must happen before a complete Cloud SQL cutover.

## Google Workspace development validation

Use only records named `FCI TEST — DO NOT USE` until the production acceptance checklist passes.

1. Select one company-controlled Workspace connection account, ideally `operations@cherryhillfci.com`, and use that exact same account as the Gmail intake mailbox. Gmail operates as the connected account and cannot silently read a different mailbox.
2. Create the `FCI Operations` Shared Drive, `FCI Operations Directory` spreadsheet, `FCI • Client Appointments` calendar, and `FCI • Field Schedule` calendar according to the [Google Workspace organization blueprint](docs/google-workspace-organization.md).
3. Inventory the reported company-account project candidate and verify its Google Cloud identifiers, parent organization, purpose, IAM, billing status, and enabled APIs. After the owner reviews that inventory, reuse the verified development project and approve any required API or Internal OAuth changes; do not create a duplicate.
4. Store the OAuth secret and token-encryption key only in the ChatGPT Sites project's runtime environment settings, with both entries marked as secrets. Google Secret Manager is reserved for the future production environment. Never commit, email, document, or place secret values in Drive.
5. Deploy the runtime configuration with Drive provisioning disabled.
6. Connect the exact authorized Workspace account and verify Gmail, Drive, Calendar, and Sheets independently.
7. Enable Drive provisioning only after Shared Drive verification succeeds, then create and inspect one test project folder.
8. Run the complete development validation lifecycle: two projects for one test client, Sheets mirroring, reviewed Gmail copy and attachments, a reply draft, Calendar test hold, meeting evidence, assistant citations, and a rejected unauthorized login.

The application remains the system of record. The directory spreadsheet is a one-way mirror except for its intentionally spreadsheet-owned Account Notes field. Gmail messages are copied only after explicit review and remain in the Inbox; replies are drafts until a person intentionally sends them.

See [`docs/google-workspace-rollout-guide.md`](docs/google-workspace-rollout-guide.md) for the exact administrator procedure, runtime values, troubleshooting, and production acceptance checklist. Also see [`docs/meeting-notes-and-otter.md`](docs/meeting-notes-and-otter.md) and [`docs/collaboration-and-sharing.md`](docs/collaboration-and-sharing.md).

## Repository and development handoff

Use this GitHub repository as the canonical collaboration history and keep one active local clone. The owner's current clone is in a OneDrive-synchronized folder and the GitHub repository is public; do not create a second editable copy, watch for synchronization conflicts, and never commit secrets or real business/client data. The owner may make the repository private before operational configuration begins.

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
- `npm run build:cloud-run`: type-check and build the separate fail-closed Google Cloud service, migration, and rehearsal entry points
- `npm test`: build both runtime targets and run the API, portable-service, migration, Cloud foundation, and product-contract checks
- `npm run db:generate`: generate Drizzle migrations after schema changes
- `npm run db:migrate:local`: explicitly apply checked-in Drizzle migrations to the local D1 database before development
- `npm run db:migrate:postgres`: build and run the separate PostgreSQL migration command; use only in an explicitly approved environment
- `npm run db:rehearse:postgres-core -- --snapshot <test-file>`: run the bounded non-production core rehearsal; it never proves full cutover readiness

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
