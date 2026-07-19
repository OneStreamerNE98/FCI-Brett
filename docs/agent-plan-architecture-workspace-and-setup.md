# Agent execution plan: backend architecture, Google Workspace connection, and Settings/Setup alignment

Date: July 19, 2026 · Baseline: `main` @ `adc79b8` (PR #32 merged; that exact commit is
deployed as private Sites development version 40 and includes PR #30)

Ledger introduced on `main` by PR #31 at `88b5b01` on July 19, 2026.

This is the single distributable plan for three coordinated workstreams. It was produced by
auditing the architecture decision docs, the Google Workspace rollout guide, every task
checklist, the actual backend source (adapters, ports, platform, worker, API surface), and
the current Settings UI — then adversarially fact-checking the work items against the repo
(file paths, env vars, routes, line anchors). Each work item below is sized to be one agent
work packet. Owner-only steps are explicitly marked **OWNER** — agents never perform them.

**Coverage of the owner's request.** This document answers, in order: (1) *fix the
architecture* → Workstream A; (2) *the plan for connecting the FCI Cherry Hill Google
Workspace, and how backend SQL, data storage, Gmail, Google Drive, etc. will take place* →
"Current state in one page" + Workstream A (storage) + Workstream B (connection and
per-service data flows); (3) *make the web-app Setup/Settings UI make sense and align with
Workspace setup, background-data setup/maintenance, and common maintenance items* →
Workstream C; (4) *make sure updates land in the repo docs so there is no confusion about
current tasks and what needs to be completed* → the doc-truth packets (BE-01, WS-03), the
per-item doc updates throughout, and the **Task tracking and doc reconciliation** section
below, which also covers the state of GitHub itself (issues/PRs).

---

## How to use this document

- Give one work item (or one small dependent chain) to one agent as a packet, along with
  this document's **Global guardrails** section.
- Branch naming: `codex/<short-feature-name>`; PRs require passing tests, a production
  build, and a short data/security impact note (README repository rules).
- An item is done only when its **Acceptance** line passes in this repo.
- IDs: `BE-*` backend architecture & data storage · `WS-*` Google Workspace connection ·
  `SET-*` Settings/Setup UI · `TRK-*` task tracking/doc reconciliation · `KPI-*` flooring
  KPIs & reporting · `OIDC-*` BE-04 post-merge security follow-ups (in
  [`docs/be04-oidc-review-and-followups.md`](be04-oidc-review-and-followups.md)).
  Dependencies are listed per item.

## Global guardrails (include in every packet)

1. **Secrets never touch the repo or an agent.** OAuth client secrets, token-encryption
   keys, and passwords go only into ChatGPT Sites runtime environment settings marked as
   secrets (development) or Secret Manager (production). Items that need them are OWNER
   items.
2. **Fail-closed defaults are intentional, not bugs.** Zero-resource Terraform defaults,
   `503 feature_unavailable` provider routes on the Cloud Run image, and
   `cutoverReady:false` in the rehearsal are deliberate. "Fixing" them without the gate
   passing is an unauthorized production change.
3. **PostgreSQL migrations are append-only and checksummed.** `app/platform/postgres/
   production-schema-migrations.ts` locks v1–v5 with SHA-256 checksums verified by
   readiness probes and source-contract tests. Never edit an existing migration; append
   v6+. **All five migrations are unapplied everywhere — no Cloud SQL instance exists.**
   (Do not read "migrations 4–5 remain unapplied" in the audit doc as implying 1–3 are
   applied; BE-01 fixes that phrasing.)
4. **The D1 drizzle sequence (0000–0011) is applied by Sites at deploy and is also
   append-only.** Never drop or alter existing D1 tables; the dev environment is the only
   live environment.
5. **Single-user / test-data boundary holds.** Only `FCI TEST — DO NOT USE` records in any
   live Workspace step; no second user and no real client data until the development
   acceptance run (WS-11) passes.
6. **Two OAuth clients, never merged.** The broad data-connector client
   (drive/gmail.modify/calendar/sheets) and the future employee-login client
   (openid email profile only) are separate; the production connector never receives the
   Sites development callback URI.
7. **UI never fabricates backend state.** Every status shown in Settings must come from a
   real endpoint; backend-planned capabilities appear only as clearly-badged "Planned"
   placeholders. Server-side `requireOfficeUser({admin:true})` gates stay untouched — UI
   admin-gating is honesty, not security.
8. Visual/design remediation through PR #30 is included in private Sites development
   version 40 and is tracked in `docs/design-critique-fix-plan.md`. The source-only
   `codex/actionable-lists` Phase 3 slice is complete in PR #33 and is not deployed.
   The source-only `codex/settings-panel-extraction` SET-01 slice is complete in source and merged in PR #35 and
   is not deployed. SET-02 has passed source acceptance in draft PR #37 and is not
   deployed; KPI-01 takes the next `FloorOpsApp.tsx` queue slot after PR #37 lands. Do not
   re-litigate visuals; coordinate Settings component work with the relevant Phase 3/4
   entries in that ledger.

## Current state in one page

- **Live today:** Cloudflare Sites/Workers app, D1 database (drizzle 0000–0011), R2 for
  uploads, ChatGPT sign-in with office/admin allowlists
  (`app/lib/workspace-auth.ts`), `GOOGLE_INTEGRATION_MODE=simulation` — durable simulated
  Gmail/Drive/Calendar/Sheets, partitioned from live data by connectionKey
  (`workspace-simulation` vs `google-workspace`, `app/lib/google-oauth.ts:219`).
- **Implemented, waiting on configuration:** the dev Google connection path —
  OAuth+PKCE with AES-GCM refresh-token storage (`app/lib/google-oauth.ts`), real REST
  clients for Drive/Gmail/Calendar/Sheets (`app/lib/google-drive.ts`, `google-gmail.ts`,
  `google-calendar-client.ts`, `google-sheets.ts`), verification routes under
  `app/api/v1/integrations/google/**`. WS-03 adds the missing fail-closed check that the
  Gmail intake mailbox is the same single account authorized for OAuth; no new provider
  flow is otherwise required to go live in development. The remaining blockers are owner
  setup steps (WS-01…WS-08).
- **Source-only production foundation (nothing provisioned):** fail-closed Cloud Run image
  (`Dockerfile.cloud-run`, `production-runtime/src/*`), PostgreSQL schema v1–v5 with
  identity/audit/integration/file tables, idempotency + outbox repositories, least-
  privilege SQL, zero-resource Terraform (`infrastructure/google-cloud/`), bounded
  D1→PostgreSQL rehearsal that always reports `cutoverReady:false`. Provider routes 503 by
  design; there is **no login route** on the Cloud Run router yet.
- **Pending owner inputs (block the gated items):** region/billing, production hostname/
  DNS, RPO/RTO, Cloud SQL standalone-vs-HA profile, alert recipients, deployment approver,
  rollback owner, `operations@cherryhillfci.com` custodian — all recorded in
  `docs/task-checklists/00-setup-inputs.md` when decided.

## Owner decision gate (blocks marked items only)

| Decision | Recorded in | Blocks |
|---|---|---|
| Workspace resources + intake==connection account | checklist 00/01 | WS-02+ (whole owner track) |
| GCP inventory approval, OAuth client creation | checklist 02 | WS-05, WS-06 |
| Scope review (narrower Drive/Gmail?) before first consent | checklist 02 | WS-06 (scope changes later force disconnect/reconnect) |
| Region, billing, deployment approver | checklist 00 | any `terraform apply`, staging rehearsal, deploy (BE-11 authoring is NOT blocked) |
| Production hostname/DNS | checklist 00 | live OIDC login (BE-04 authoring is NOT blocked) |

---

# Workstream A — Backend architecture & data storage (BE)

Goal: take the backend from today (Sites/Workers/D1/R2 + simulation) to the accepted
production core (Cloud Run + Cloud SQL PostgreSQL + Secret Manager + Workspace OIDC)
without breaking the development environment. Order follows the audit roadmap
(`docs/complete-product-and-google-cloud-architecture-audit.md`).

### BE-01 · Documentation truth pass (small, no deps) — DO FIRST
**Status:** Complete — PR #32, July 19, 2026.

**Why:** Stale docs will cause agents to redo finished work. README "Prioritized next
work" items 1–3 present the costed infrastructure definitions, production-persistence
boundary, and simulated access contexts as future although the audit doc (roadmap items
3–5) records them merged. The amending ADR still carries a "Next worker assignment" that
`infrastructure/google-cloud/README.md` already fulfills. The audit doc's "migrations 4–5
remain unapplied" phrasing wrongly implies 1–3 are applied somewhere. Several checklist
passages used Sites version 37 as current-state evidence even though version 39 was the
latest deployment at the time of reconciliation; other version-37 references were
accurate release history and had to be preserved as such.
**Do:** Replace the README next-work list with pointers to the authoritative ledgers;
tighten the "normal paths 503" claim (dashboard/search/projects/clients/logout/admin are
served from PostgreSQL on the foundation image; only provider actions 503). Annotate the
ADR's worker assignment as fulfilled (dated note; don't delete accepted-ADR text). Rewrite
the migration phrasing: NO migration (1–5) is applied anywhere; no Cloud SQL instance
exists. Distinguish stale current-state version references from accurate historical release
evidence. Sweep docs for a root `wrangler.jsonc` (only `wrangler.local.jsonc` exists;
hosted bindings come from `.openai/hosting.json`).
**Files:** `README.md`, the fulfilled rollout ADR, architecture/status handoff docs,
`docs/complete-product-and-google-cloud-architecture-audit.md`, and the affected owner
checklists.
**Accept:** the README is a ledger pointer, current/deployed version wording is explicit,
historical release evidence remains truthful, no migration wording implies v1–v5 were
applied, and `npm test` passes.

### BE-02 · Bounded request bodies on five dev mutation routes (small, no deps)
**Status:** In review — PR #36 on `codex/request-and-schema-hardening`, July 19,
2026. Full local and GitHub checks pass; not merged or deployed.

**Why:** `app/lib/api-json-body.ts` (`parseBoundedJsonObject`) exists to cap JSON bodies,
yet raw `await request.json()` remains in POST /clients, POST+PATCH /projects, PATCH
/filing-rules/[ruleId], PATCH /settings/me, PATCH /settings/workspace (verified, 5 call
sites). `worker/index.ts`'s Env interface omits the `FILES` R2 binding that
`app/api/v1/uploads/route.ts` uses (verified) and still calls itself the vinext-starter
template.
**Do:** Swap each raw parse for `parseBoundedJsonObject` (filing-rules/settings 8,000
bytes; clients/projects 64,000 — match siblings), preserving validation and error shapes.
Add `FILES: R2Bucket` to the Env interface. (Leave `GOOGLE_WORKSPACE_PUBSUB_TOPIC` to
WS-03 — one owner.) Add oversized-body tests.
**Accept:** `npm test` passes; oversized bodies return the same 4xx contract as
POST /records does today; grep for raw `request.json()` in those routes returns nothing.

### BE-03 · Retire the legacy /api/v1/records surface (small, after BE-02)
**Why:** Generic JSON record store with no UI caller (verified: only
`tests/api-correctness-behavior.test.mjs:174` and `tests/rendered-html.test.mjs:97`
reference it); `actorFrom` in `app/api/v1/_workspace-data.ts:14` has zero call sites.
Porting dead surface to PostgreSQL would waste a packet.
**Do:** Delete the route (or 410 stub — pick one, note in commit), remove `actorFrom`,
update the two tests. **Keep** the assistant "records-only" assertion in
`tests/rendered-html.test.mjs` (~line 112) — it tests the assistant's answer mode, not
this route. Do NOT touch `db/schema.ts` or drizzle history; record
`records: excluded (legacy, no migration)` for BE-12's inventory.
**Accept:** `npm test` passes; grep `actorFrom` in app/ empty; local migrations unchanged.

### BE-04 · Workspace OIDC login, invitation redemption, session issuance on the Cloud Run router (large, no deps; VERIFIED)
**Status:** Complete — PR #38, July 19, 2026. Source-only; production identity,
infrastructure, sessions, and user admission remain unapplied. **Post-merge security review
found one launch-blocking correctness bug and hardening/test/doc gaps — see
[`docs/be04-oidc-review-and-followups.md`](be04-oidc-review-and-followups.md) (packets
OIDC-01..OIDC-04). OIDC-01 must land before any live employee login.**

**Why:** The single largest production gap: the Cloud Run image has no login.
`app/ports/identity-persistence.ts` (registerExternalIdentity/createSession, lines 67–68)
and its postgres adapter exist; `POST /api/v1/admin/invitations` mints credentials;
`secure-session-transport.ts` implements hashed `__Host-fci_session` + CSRF — but nothing
turns an OIDC assertion or invitation into a session row. Policy is fully specified in
`docs/authorization-simulation.md`.
**Do:** Add OIDC initiation + callback routes to
`app/platform/google-cloud/employee-request-router.ts` (state, nonce, PKCE; server-side ID
token verification; enforce `hd=cherryhillfci.com`; identity key = immutable Google `sub`,
never email). Single-use 7-day invitation redemption bound to one role, consumed
transactionally through the existing ports. Sessions via secure-session-transport
conventions (30-min idle / 8-h absolute). Extend `production-config.ts` with fail-closed
OIDC vars (exactly-one-of secret/secret-file, like the postgres password pair); absent
config leaves the image byte-identical. Uses the **employee-login** OAuth client only.
Emit security-audit events. Never read `oai-authenticated-user-email` in the platform
layer. JWKS-stubbed verifier in tests. **Conform to
`docs/administration-and-access-plan.md`:** the fixed policy (three roles, single-use
7-day invitations, 30-min/8-h sessions, final-Administrator protection, initial
Administrators `admincrm@cherryhillfci.com` and `brett@cherryhillfci.com` pending live
identity verification) is approved and not open for redesign.
**Accept:** `npm run build:cloud-run` + `npm test` pass; new suite covers happy path,
wrong hd, bad signature, expired/second redemption, idle+absolute expiry, logout; grep
confirms no ChatGPT header reads in `app/platform/`.

### BE-05 · Object storage behind the port: R2 + GCS adapters, wire uploads route (medium, no deps)
**Status:** In review — draft PR #40 on `codex/object-storage-adapters`, July 19, 2026.
Source-only; no GCS adapter composition, bucket provisioning, hosted configuration, or deployment.

**Why:** `app/ports/object-storage.ts` (create-only putIfAbsent/head/openRead,
sha256+generation) has only the in-memory adapter; the one real call site
(`app/api/v1/uploads/route.ts`) bypasses the port with `env.FILES.put`; Cloud Run file
routes have a ready file-metadata repository but no storage backend.
**Do:** Implement `app/adapters/r2/object-storage.ts`; refactor the uploads route through
it preserving exact behavior (20 MB/22 MB caps, magic-byte sniffing, key scheme).
Implement `app/adapters/gcs/object-storage.ts` (`@google-cloud/storage`, injectable
config, NOT composed into the router — provider routes stay 503). Parameterize the
contract tests over memory + fake-R2 + gated GCS.
**Accept:** `npm test` + upload e2e pass; grep `env.FILES.put` empty; GCS suite skips
cleanly when ungated.

### BE-06 · Leads & project meetings: ports, D1 adapters, PostgreSQL migration v6 (large, no deps)
**Why:** `leads` (drizzle 0010) and `project_meetings` (0009) are D1-only with inline SQL
in their routes; the rehearsal migrates only clients/contacts/projects/activity_events.
The client/project port pattern (`app/ports/client-repository.ts` + d1 + postgres adapters
+ `creation-idempotency.ts`) is the template.
**Do:** Define lead/meeting ports; extract route SQL verbatim into d1 adapters (byte-
identical dev behavior incl. activity events and L-YYYY-XXXXXXXX numbering); append
migration **v6** (new DDL module; never touch v1–v5 checksums) with CHECK constraints
mirroring domain validation; extend `infrastructure/postgres/least-privilege.sql` grants +
`database-readiness.ts` expectations; implement postgres adapters (transactions,
idempotency fingerprint, outbox event on create); unit + gated integration tests.
**Accept:** checksum contract tests green (v1–v5 unchanged, v6 registered); with local
PG16, `npm run db:migrate:postgres` applies v1–v6 and readiness passes; e2e dev flows
unchanged.

### BE-07 · Settings/preferences/filing-rules/mail-items ports + migration v7 + single calendar-ID authority (large, after BE-06)
**Why:** Four more D1-only tables with inline SQL; plus the accepted-but-unowned defect:
saved `workspace_settings` calendar/sheet IDs are runtime-inert while env vars win
(`app/lib/google-oauth.ts:193–194, 231–232`).
**Do:** Ports + d1 extraction + migration **v7** + postgres adapters (BE-06 pattern).
Make stored workspace_settings the single runtime authority with env as first-boot seed —
**coordinate with SET-05**, which implements the dev-surface resolver and UI source
labels; BE-07 preserves those semantics when porting. Check off the checklist-07 item.
**Accept:** v1–v6 checksums unchanged, v7 registered; precedence unit test (saved wins,
env fallback); settings e2e unchanged.

### BE-08 · Decouple Google clients from cloudflare:workers; key-version decryption; populate v3 integration tables (large, no deps)
**Why:** The real Google clients import `cloudflare:workers` and cannot compile into the
Cloud Run image; the v3 `integration_*` tables have no code path populating them from a
real OAuth flow; `google_connections.key_version` is written but `decryptGoogleSecret`
(`app/lib/google-oauth.ts:159`, verified) only ever uses the single current key — rotation
bricks every stored ciphertext.
**Do:** (1) Multi-key decryption selected by stored key_version (current-writer pair stays
`GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY`/`_VERSION`) — **coordinate with WS-04**, which
documents the rotation procedure; implement once. (2) Re-grep `cloudflare:workers`
importers (July 15 count was 22; may have drifted) and refactor the four clients +
google-oauth entry points to injected dependencies (fetch, clock, secret store,
persistence port) so they compile under `tsconfig.cloud-run.json`; Sites keeps a thin
D1-backed composition. (3) Implement the production OAuth persistence path through
`app/ports/integration-metadata.ts` into the v3 tables (hashed state, AES-GCM PKCE +
refresh ciphertexts with AAD, one-shot consumption). (4) Compose NOTHING into provider
routes — they keep returning 503 (activation is Gate C, owner-gated). Simulation mode
untouched.
**Accept:** `build:cloud-run` compiles the clients; grep `cloudflare:workers` over the
cloud-run bundle graph empty; key-rotation test (v1 ciphertext decrypts after rotation to
v2); provider routes still 503 in router tests.

### BE-09 · Port application writes to the production boundary; reconcile the dual API contract (medium, after BE-04+BE-06; VERIFIED)
**Why:** Cloud Run has no write path for core records — `production-composition.ts`
exposes per-request creation repository factories (lines 113–124, verified) that no route
uses. The same paths exist on both surfaces with different auth/shapes, and the management
UI calls `/api/v1/admin/*` paths that 404 on the current worker.
**Do:** Add POST /clients + /projects (+ leads/meetings GET/POST) to the employee router
via the shared use-cases with capability checks, {data} envelope, idempotency. Record the
per-route contract decision in `docs/google-cloud-runtime-foundation.md` (production =
session+CSRF+envelope; bare JSON = development-only). For the dev admin 404s pick and
document one remedy (thin D1-backed `/api/v1/admin/*` compatibility handlers, or feature
detection in the two admin clients). Provider routes still 503.
**Accept:** router tests: authorized create + idempotent replay, denial, scope-filtered
reads, provider 503 assertion; contract section exists.

### BE-10 · Rate limiting on both surfaces (medium, after BE-04; VERIFIED)
**Why:** No rate limiting exists anywhere (verified). Cost-bearing dev routes: assistant
(OpenAI), uploads (R2), sheets/sync + project drive provisioning (Google quota). The
acceptance checklist requires limits before go-live.
**Do:** Production: per-identity token bucket in a new
`app/platform/google-cloud/request-rate-limit.ts` applied before dispatch (in-memory
per-instance is acceptable at max two instances per CONNECTION-BUDGET.md); 429 +
Retry-After + security-audit event; configurable via production-config, fail-closed
defaults. Dev: light fixed-window per office user on the four cost routes. Document.
**Accept:** threshold tests (429 + audit event); under-threshold byte-identical.

### BE-11 · Deployment mechanism source definitions (medium; source complete in draft PR #47, unapplied; apply owner-gated)
**Why:** The migration runbook previously declared an implementation blocker: no Cloud
Run Job, deployment identity, image-build pipeline, or release mechanism existed in
source, yet the roadmap assumes staging rehearsal can execute.
**Do:** Extend `infrastructure/google-cloud/` with Artifact Registry, deployment service
account, Cloud Run service (deploy_service default false, zero min instances, max two),
and Jobs for `run-migrations.mjs` (migration mode, pool 1) and `run-core-rehearsal.mjs`
(rehearsal mode, `^fci_rehearsal_` schema) — every resource behind enable flags defaulting
false; no allUsers invoker. Add CI that builds `Dockerfile.cloud-run` on PR and only
pushes on manual dispatch with approval. Rewrite the runbook blocker section. **Never run
terraform apply.**
**Accept:** `terraform fmt -check` + `validate` green; default plan still zero resources;
`docker build -f Dockerfile.cloud-run .` succeeds; CI green with no push executed.

**Status (2026-07-19):** Draft PR #47 contains the default-off source definitions,
keyless protected-environment image workflow, gate/default-zero tests, and truthful
runbook update. Local Terraform 1.15.8 formatting, validation, and 29 mocked plans pass;
392 Node tests report 377 passing, 15 explicitly gated skips, and zero failures. This
host has no container engine, so the PR's unauthenticated Docker build must pass before
source acceptance. Nothing has been applied, published, deployed, executed, or configured.

### BE-12 · Rehearsal inventory expansion (medium, after BE-06; VERIFIED with corrections)
**Why:** The cutover requirement to classify EVERY source category as
migrated/transformed/excluded/blocking comes from
`docs/runbooks/google-cloud/migration-cutover-and-recovery.md`, "1. Staging migration
rehearsal" (lines 25–27) — **not** the platform ADR. `db/schema.ts` exports 21 tables;
the rehearsal covers 4, is silent on the other 17 plus R2 objects.
**Do:** Add an inventory section to the rehearsal report enumerating every schema-exported
table + R2, each classified with a reason (records: excluded legacy per BE-03;
workspace_simulation_state: excluded dev-only; google_connections: blocking until BE-08;
leads/meetings: migrated once v6 applies). Derive the table list from `db/schema.ts` so
new tables can't escape classification. Extend the snapshot format (major version bump) to
carry leads/meetings into v6 tables with hash verification; keep every existing guard
(FCI TEST name rule, 16 MiB/5,000-row caps, `^fci_rehearsal_` schema, refuse production,
exact acknowledgment). `cutoverReady` stays hardcoded false.
**Accept:** inventory covers all 21 tables (unit test fails on unclassified); extended
fixture imports green; `cutoverReady:false`.

### BE-13 · Fail-closed schema targeting (small, no deps)
**Status:** In review with BE-02 — PR #36 on
`codex/request-and-schema-hardening`, July 19, 2026. Full local and GitHub checks pass;
not merged or deployed.

**Why:** The migration runner defaults to `public` while production requires a dedicated
schema — omitting `FCI_POSTGRES_SCHEMA` would silently migrate/serve from public.
**Do:** In `loadProductionConfig`, require `FCI_POSTGRES_SCHEMA` whenever
`FCI_DEPLOYMENT_STAGE` is staging/production (all access modes); literal `public` only
with an explicit acknowledgment variable (same style as the password exactly-one-of).
Align both docs.
**Accept:** fail-closed config tests; dev-stage unchanged; docs agree.

### BE-14 · Degraded-mode contract + outbox drain entrypoint (medium, after BE-08/09/11)
**Why:** The cutover go/no-go gate requires defining behavior when Google is down; the
runbook states no degraded mode exists. The outbox machinery (claim/complete/retry/
dead-letter with fencing) is implemented but nothing drains it.
**Do:** Typed responses distinguishing `feature_unavailable` (not composed — current) from
`provider_degraded` (composed, Google unreachable) with retryability; enqueue-and-
acknowledge for safely deferrable ops (Gmail filing, Sheets mirror) — enumerate per route
in the runbook. Add a fourth entrypoint `run-outbox-drain.mjs` (bundled like the others,
no-op dispatcher registry until adapters compose, inert by default). Add the drain Job to
BE-11 Terraform (flag false).
**Accept:** build produces the drain bundle; drain-loop tests (claim/retry/dead-letter/
fencing); provider routes still deny by default; runbook blocker sentence gone.

---

# Workstream B — Google Workspace connection & data flows (WS)

Goal: from `GOOGLE_INTEGRATION_MODE=simulation` to a verified live connection for the FCI
Cherry Hill Workspace, targeting **operations@cherryhillfci.com as BOTH the OAuth
connection account and the Gmail intake mailbox** (domain-wide delegation is forbidden, so
gmail.modify only reaches the connection account's own mailbox — any other intake address
is silently unreachable). **The connection code is already fully implemented** — agent
items are docs/operability; owner items are the actual setup clicks. Rollback at every
stage: set the mode back to `simulation` (connectionKey partitioning keeps states
isolated).

**Verification order is fixed by code:** Drive root verify → Gmail labels → Calendar →
Sheets → Drive provisioning last → Gmail filing (filing requires a provisioned project
folder; provisioning requires oauthReady + provisioningEnabled).

### WS-01 · OWNER — Verify tenant preconditions, create Workspace resources (medium)
Checklist 01 has zero boxes checked. Verify cherryhillfci.com control and Shared Drive
support; create/confirm `operations@cherryhillfci.com` (named custodian in checklist 00);
as that account create Shared Drive **FCI Operations** (external sharing restricted),
empty spreadsheet **FCI Operations Directory** inside it, calendars **FCI • Client
Appointments** and **FCI • Field Schedule**; record the four non-secret IDs in checklist
01 and the intake==connection decision in checklist 00.
**Accept:** checklist 01 fully checked with IDs recorded.

### WS-02 · OWNER — Read-only GCP inventory, then approved API enablement + OAuth client (medium, after WS-01)
No recorded inventory exists anywhere. Brett performs the read-only inventory (rollout
guide Part 5); **STOP** for Jason's approval; then enable Drive/Gmail/Calendar/Sheets APIs
(Pub/Sub stays disabled), set audience Internal, create Web client "FCI Operations
Workspace Connector — Development" with exactly one redirect URI:
`https://groundwork-flooring-ops.jaggerisagoodboy.chatgpt.site/api/v1/integrations/google/callback`
(character-exact). Resolve the narrower-scopes question BEFORE first consent (later scope
changes force disconnect/reconnect). Admin console: mark the client trusted scoped to only
the connection account; NO domain-wide delegation. Client ID → checklist 02; secret stays
with the owner. **Risk to surface early:** the dev callback lives on a chatgpt.site domain
the company doesn't own — if Google's authorized-domain rules reject it, report back
immediately.
**Accept:** inventory + approval recorded; four APIs on; one client, exact URI; secret
never in repo.

### WS-03 · AGENT — Workspace docs reconciliation + env drift (small, no deps) — DO FIRST with BE-01
**Status:** Complete — PR #32, July 19, 2026.

**Do:** (1) State the intake==connection invariant explicitly in the rollout guide
(Parts 6–10) and checklist 03, enforce it fail-closed in `getGoogleRuntimeConfig`, and add
a regression test for matching, mismatched, and multiple approved accounts. Gmail uses
`users/me`, so documentation alone cannot make a different intake mailbox reachable.
(2) Remove `GOOGLE_WORKSPACE_PUBSUB_TOPIC` from
`.env.example` (verified: zero code references; future watch transport is WS-12's
decision). (3) Link `docs/google-workspace-organization.md` from the README validation
section. (4) Name the concrete dev secret mechanism (ChatGPT Sites runtime environment
settings, with sensitive values marked as secrets) so it is unambiguous and distinct from
`.openai/hosting.json`; Secret Manager remains production-only.
(5) Replace the hardcoded personal Gmail example in rollout guide Part 10 with a
role-based placeholder. (Version-37 refs are BE-01's — don't double-fix.)
**Files:** `.env.example`, `app/lib/google-oauth.ts`,
`tests/google-correctness-behavior.test.mjs`, `README.md`, the Workspace rollout guide,
and checklist 03.
**Accept:** greps confirm each; Gmail readiness accepts one matching account and rejects
mismatched or multiple approved accounts; `npm test` passes.

### WS-04 · AGENT — Rotation + token-failure recovery procedures (medium, no deps)
**Status:** In review with WS-12 — PR #39 on
`codex/workspace-rotation-sync-contracts`, July 19, 2026. Local acceptance is green (337
active tests, 13 environment-gated skips, lint, focused strict TypeScript, and 10/10
contract tests); all GitHub Node, Terraform, and Chromium checks are green.
Procedures, contracts, and local fakes only; no live provider resource is authorized.

**Why:** No rotation or invalid_grant recovery procedure exists anywhere, though the code
already flips status to `reauthorization-required` on invalid_grant (verified).
**Do:** Add three runbook entries to the rollout guide: (a) token-encryption-key rotation —
implement multi-key decryption keyed by `google_connections.key_version` (**one
implementation shared with BE-08** — coordinate) or document the honest interim
(disconnect + reconnect after key change); (b) OAuth client-secret rotation (new secret in
GCP console → hosted setting; no reconnect needed); (c) invalid_grant / revoked-token
recovery (status shows reauthorization-required → DELETE connection → re-authorize).
Mirror into checklist 08's rotation drill.
**Accept:** all three procedures exist; if code changed, rotation tests pass.

### WS-05 · OWNER — Hosted env + secrets configuration (small, after WS-01..04)
Enter the checklist-03 dotenv block into hosted settings: enabled services, client ID,
redirect URI, key version 1, allowed domain `cherryhillfci.com`, authorized account =
intake mailbox = `operations@cherryhillfci.com`, the four WS-01 IDs,
`GOOGLE_WORKSPACE_DRIVE_PROVISIONING_ENABLED=false`. Secrets (client secret + a fresh
`openssl rand -base64 32` token-encryption key) go into ChatGPT Sites runtime environment
settings marked as secrets only.
Leave mode=simulation; FCI_OFFICE/ADMIN_EMAILS unchanged (Workspace connection ≠ app
login).
**Accept:** Settings → Google Workspace readiness shows no missing values except the mode.

### WS-06 · OWNER — Flip to workspace mode and connect (small, after WS-05)
Set `GOOGLE_INTEGRATION_MODE=workspace`; as an FCI admin start the connection from
Settings (authorize → Google consent **as exactly operations@cherryhillfci.com** →
callback verifies scopes + Shared Drive root and stores the encrypted refresh token).
Match any error against the guide's troubleshooting table. **Rollback:** mode back to
simulation (simulation state untouched); to fully undo, DELETE the connection first
(revokes at Google).
**Accept:** connection route reports connected for the right account.

### WS-07 · OWNER — Service-by-service live verification (medium, after WS-06)
In order, recording evidence in checklist 03: **Drive** root verify; **Gmail** labels
prepare (creates exactly FCI/Intake, FCI/Needs Review, FCI/Filed) → list messages →
send-test → reply draft (draft only, sent:false) — do NOT file yet; **Calendar** events
list + test hold (then delete the hold in Google Calendar); **Sheets** status + sync
(Client Directory + Project Register tabs appear). Spot-check
`google_integration_events` after each step.
**Accept:** all four per-service gates in rollout guide Part 11 pass with evidence.

### WS-08 · OWNER — Enable Drive provisioning; provision ONE test project; verify Gmail filing end-to-end (medium, after WS-07)
Set provisioning=true; create one `FCI TEST — DO NOT USE` client+project; provision its
folders (5-minute lease; idempotent; blueprint check: `02_Projects/<year>/<number — name>/`
with 00_Admin…06_Closeout incl. Email Archive/Email Attachments; project folder NOT nested
under the client folder — deliberate). Then file one test message: read-only preview →
POST with projectId → archive state `filed`, .eml + attachments under 05_Correspondence,
FCI/Filed applied, INBOX retained. On failure read `last_error_code` before retrying
(flows are idempotent).
**Accept:** one provisioned project, one filed email, rows under connectionKey
`google-workspace`.

### WS-09 · AGENT+OWNER — Sheets mirror mechanics documented, then live-verified (medium, after WS-08)
**Agent:** document in `docs/google-workspace-organization.md` what
`app/lib/google-sheets.ts` actually does: triggers (client/project creation via the
DirectoryMirror port, post-provisioning, manual sync — **no scheduler exists**), app-owned
columns vs the spreadsheet-owned Account Notes column, overwrite behavior on manual edits,
per-entity `google_sheet_sync_state`. If Account Notes preservation turns out fragile
(positional), record it as a known limitation — don't silently fix. **Owner:** live test —
type an Account Note, edit an app-owned cell, sync, confirm the note survives and the edit
is overwritten.
**Accept:** mechanics section matches code; live test recorded.

### WS-10 · AGENT — Connection-health and sync-error operator surface (medium, after WS-03)
**Why:** An operator cannot list stuck/failed Google work: drive-operation leases +
`last_error_code`, failed gmail archives, and `google_integration_events` have no reader.
**Do:** Either a small admin-gated `GET /api/v1/integrations/google/operations` endpoint
surfaced in Settings, or documented D1 queries in the rollout guide — choose one, don't
half-do both. **Coordinate with SET-09** (integration audit viewer) — if SET-09 ships, the
events part is covered; this item then only adds stuck-leases/failed-archives. Add
troubleshooting entries: deleted FCI/* labels → re-run labels/prepare (idempotent); stuck
lease → wait out 5 minutes, never hand-edit Drive; failed archive → re-POST (idempotent by
fciArchiveId). Document that Intake/Needs Review labels accumulate (no automated cleanup).
**Accept:** admin can enumerate failures; three troubleshooting entries exist; tests pass
in simulation.

### WS-11 · OWNER — Development acceptance run (medium, after WS-08+09)
The gate for any second user or real client data. Run the 13-step rollout guide Part 12
lifecycle with only FCI TEST records, recording evidence per step in checklist 05 (an
agent may pre-build the evidence table template — no credentials involved): two projects
provisioned, mirror rows, reviewed filing with Inbox retention, unsent reply draft,
calendar hold, Otter meeting record, assistant citations resolving to filed evidence,
rejected unauthorized login, no FCI/Filed label without an archive row.
**Accept:** development half of checklist 05 fully checked with dated evidence + owner
sign-off.

### WS-12 · AGENT — Gmail watch/queue + Calendar channel contracts (medium, after WS-03; contracts + local fakes, no live resources)
**Status:** In review with WS-04 — PR #39 on
`codex/workspace-rotation-sync-contracts`, July 19, 2026. Provider-neutral durable-job,
failure/replay, encrypted sync-cursor, and Calendar channel-state contracts are covered by
local fakes and tests. Procedures, contracts, and local fakes only; no live provider
resource is authorized.

**Scope:** this agent ledger authorizes provider-neutral job/failure/replay and
Gmail/Calendar sync-state **contracts with local fakes** — so this item may ship typed
contracts, port definitions
targeting the existing postgres `integration_cursors`/`outbox_events` tables, and local
fake implementations with tests, not only the design doc below. Live watches, channels,
and Pub/Sub remain forbidden until the checklist-07 gates pass.
Write `docs/google-workspace-watch-and-queue-design.md`: Gmail users.watch-vs-polling
decision (align with the guide's no-Pub/Sub direction or reverse it explicitly), historyId
cursors in the existing postgres `integration_cursors`, renewal/expiry monitoring,
idempotent processing through the implemented outbox pattern, degraded behavior on lapse;
Calendar HTTPS channel lifecycle + sync tokens; the signed Otter intake endpoint (or an
explicit deferral). Banner: nothing implemented, no live watches/channels before the
checklist-07 gates. Link from README + checklist 07.
**Accept:** doc exists, linked, names both transport decisions, targets the postgres
tables.

### WS-13 · AGENT — Document the dev→production connection boundary (small, after WS-03)
**Why:** No migration story exists for the stored connection; a future agent might try to
"migrate" the token. The dev refresh token is deliberately non-portable (AES-GCM with
connection-scoped AAD).
**Do:** Rollout guide gains "Production connection is a new connection": dev token is
never exported — cutover = DELETE dev connection (revokes at Google) + fresh consent on
Cloud Run against a separate production OAuth client and freshly generated Secret Manager
key. Runtime-foundation doc records the gaps BE-08 closes (OAuth-on-Cloud-Run persistence,
platform-neutral clients) and that the 503 stubs are intentional. Note which D1 tables'
state is re-derivable at cutover (drive_folder_mappings/gmail_file_archives via
appProperties) vs discardable (oauth attempts, sync state).
**Accept:** both docs updated; checklist 07 links them.

---

# Workstream C — Settings/Setup UI alignment (SET)

Goal: make `/settings` a truthful, ordered control center for (a) first-time Workspace
setup, (b) background-data status and maintenance, (c) recurring admin tasks. IA/content/
wiring only — no visual redesign. All buildable and testable in simulation mode. Verified
anchors at the `aa8ed8f` baseline: `SettingsView` at `app/FloorOpsApp.tsx:1354`,
`GoogleWorkspacePanel` at `:1639`, `SETTINGS_SECTIONS` at `app/lib/operations-routes.ts:27`;
At that baseline, `GET /api/v1/settings/me` returned no `isAdmin`; draft PR #37 adds the
authenticated flag without weakening any server gate. No integration audit route exists.
(Anchors drift — locate by symbol name.)

### SET-01 · Extract the eight Settings panels into `app/settings/components/` (large, complete in source in PR #35; not deployed) — DO FIRST in the SET workstream
**Why:** Every Settings panel is inline in the ~2,100-line `FloorOpsApp.tsx`; every other
SET item edits those regions; the design ledger (items 94/103) already calls for the
split. Parallel packets collide without it.
**Do:** One file per panel (MyAccount, WorkspaceDefaults, InboxRules+RuleModal,
DirectorySync, DataSecurity, GoogleWorkspace+GmailFilingModal, TestingLaunch,
SettingsDataNotice). Move code **verbatim** — no visual or copy changes; keep class names.
SettingsView stays as a thin switcher passing existing props. Update the design ledger to
mark item 94's Settings scope fulfilled; don't touch item 103.
**Accept:** `npm test` passes; per-section rendered HTML byte-identical (diff before/
after); FloorOpsApp defines no panel bodies.

### SET-02 · Expose `isAdmin`; render admin-only controls honestly (small, after SET-01; source acceptance complete in draft PR #37, not deployed)
**Status:** In review — draft PR #37 on `codex/settings-admin-gating`, July 19, 2026.
`npm test`, lint, rendered admin/Office coverage, conflicting-`.env.local` reproduction,
and desktop/390 px visual QA pass. No server gate, schema, hosted configuration, or
deployment changed.

**Why:** Nine mutating routes are admin-gated server-side, but the UI renders
Save/Sync/Reset/Connect identically for non-admin office users, who discover the
restriction only via a failed request. `workspace-auth.ts` already computes isAdmin.
**Do:** Add `isAdmin` to GET /api/v1/settings/me; share one identity fetch; disabled
style + "Administrator action" note on every admin-gated control for non-admins (visible,
not hidden). Server gates untouched.
**Accept:** rendered tests for both identities; grep confirms server gates unchanged.

### SET-03 · Guided Workspace setup stepper with per-step live status (large, after SET-01+02)
**Why:** Setup is one dense panel with no sequencing, while the rollout guide prescribes a
strict lifecycle; after OAuth callback the panel says "Run the readiness check to refresh
this panel" instead of refreshing.
**Do:** Restructure GoogleWorkspacePanel into 5 ordered steps using existing patterns:
1 Connect (connectionStatus + requiresReauthorization; authorize/disconnect), 2 Shared
Drive (drive/verify + provisioning flag), 3 Gmail (labels/prepare, inbox, send-test,
filing modal), 4 Calendar (events, test-hold), 5 Sheets mirror (status + sync). Statuses
derived ONLY from endpoint responses (Complete / Ready / Blocked by previous step /
Simulated); later steps visible but disabled until the prior step is green. Auto re-fetch
readiness when the `?google=` callback param is present; drop the stale copy. Note under
step 5 that provisioning enablement is a hosted env value, not an in-app toggle.
**Accept:** simulation renders all steps "Simulated" with every control functional;
mocked readiness variants drive status changes; callback triggers auto-refresh.

### SET-04 · Structured environment-prerequisites surface (medium, after SET-01)
**Why:** Missing config appears as bare labels ("Still needed: …") with no hint these are
hosted env/secret values — while the Calendar panel shows same-named editable fields, a
direct contradiction.
**Do:** In `getGoogleRuntimeConfig`, build `{label, envVar, secret}` entries for every
var it reads; return `missingDetails[]` alongside `missing[]`. Panel renders a table:
label, exact env var, origin tag ("Hosted environment value" / "Hosted secret — never in
the app or Git"). One line: configured in the hosting environment, not this app. Presence/
absence only — never values.
**Accept:** selective-unset tests produce correct entries; no secret values in any
response body.

### SET-05 · Saved calendar IDs become runtime-authoritative with visible source (medium, after SET-01)
**Why:** The Calendar panel saves IDs that runtime ignores (env vars win) — accepted
direction in three docs; **coordinate with BE-07** (which ports the storage later).
**Do:** New `app/lib/workspace-effective-config.ts`: `resolveEffectiveCalendarIds` —
saved-value precedence, env fallback. Consume in calendar events + test-hold routes.
Extend GET /api/v1/google-workspace with per-calendar configured+source. Panel shows "In
use (saved setting)" / "In use (environment value — saving here will override it)" /
"Not configured". Update rollout guide Part 10 + checklist 03 (env = bootstrap, settings =
authoritative).
**Accept:** route tests for all three states; panel strings correct; docs updated.

### SET-06 · Truthful labels for persisted-but-inert settings and review-first rules (small, after SET-01)
**Why:** Reminder hours and office-notification email save but nothing consumes them;
custom filing rules are forced review-first, admitted only in a footnote.
**Do:** "Planned" FeatureStateBadge + one sentence ("Saved for the upcoming reminder
worker — nothing sends yet") on the inert fields (still editable/persisted); per-rule
"Review-first" pill on custom rules with tooltip; drop the now-duplicate footnote.
**Accept:** labels render; saves unchanged; rendered tests updated.

### SET-07 · Settings IA consistency: per-section badges, one deep-link label, nav/heading alignment (small, after SET-01)
**Do:** Add `featureState` to SETTINGS_SECTIONS entries and render per-section badges
(My account=Working; Google Workspace=In development; Calendar=Setup required, computed
from SET-05's payload once landed; Inbox rules=In development; Client Directory=computed
from sheets/status; Workflow=In development; Data & security=Planned; Testing &
launch=In development) — never compute a badge from state that has no endpoint.
Standardize the four different deep-link labels to one: "Open Google Workspace setup".
Make nav label match panel heading. **URL slugs must not change** (callback redirects
target `/settings?section=google-workspace`).
**Accept:** badges render per mapping; computed ones react to mocked payloads; single
deep-link string; slugs unchanged.

### SET-08 · Persist the launch checklists (medium, after SET-01+02)
**Why:** The 4 safeguard checkboxes are unbound inputs storing nothing; Testing & launch
is a static list that looks trackable. Persisting is accepted tracked work.
**Do:** Extend the workspace_settings JSON blob with
`launchChecklist: {[itemId]: {checked, actorEmail, checkedAt}}`, server-side itemId
allowlist, PATCH stays admin-only. Split items: VERIFIED rows computed live from endpoints
(no checkbox — e.g. "Workspace connected", "Mirror synced"); ATTESTED rows are persisted
checkboxes showing who/when. Copy notes this is the development checklist; production
acceptance stays in checklist 05, not in-app.
**Accept:** attestation persists with actor/timestamp; unknown itemId → 400; simulation
reset does NOT clear it (lives in workspace_settings, not connection-scoped tables —
assert in test).

### SET-09 · Integration audit viewer (medium, after SET-01+02)
**Why:** `google_integration_events` is written by every integration flow but has no
reader anywhere (verified: no audit route exists); the dev-section audit rates this
"Critical before live data".
**Do:** New admin-gated `GET /api/v1/integrations/google/audit`: SELECT-only, scoped to
the current connectionKey, newest-first, 50 + opaque cursor; bare-JSON dev conventions.
"Integration activity" card at the bottom of GoogleWorkspacePanel (non-admins see the
explanatory card, no fetch); empty state notes that simulation reset clears this history.
No retention/export controls (those are SET-12 placeholders). **Covers the events half of
WS-10.**
**Accept:** 403 for non-admin; ordered events with stable pagination; route contains no
mutations.

### SET-10 · Connection-health detail card (small, after SET-01+02+03)
**Why:** Connection health is boolean-only in the UI; the richer admin GET
/integrations/google/connection is used only for DELETE. Admins troubleshooting
reauthorization need account, granted-vs-enabled services, and mode in one place.
**Do:** In stepper Step 1 (admin only): detail card from the connection GET — account,
per-service granted/enabled, requiresReauthorization guidance, mode; move Disconnect into
the card. Extend the route only with data already persisted by `saveGoogleConnection` —
never invent freshness/expiry values not stored. Simulation shows the simulated connection
with a Simulated tag.
**Accept:** every rendered field maps to a payload key (exhaustive test); non-admin fires
zero requests to the admin route.

### SET-11 · Directory mirror maintenance surface (small, after SET-01+02+04)
**Why:** Mirror status loads once at app start; the panel has no refresh; the
unconfigured state dead-ends at a panel with no sheet-ID field (it's env-only).
**Do:** "Refresh status" button (office-readable status route; lift the app-start loader
into a shared callable); on unconfigured, name the env var and link to SET-04's
prerequisites table instead of the dead-end button; Sync now stays admin-gated; show
lastSyncedAt/lastError exactly as returned — no derived freshness claims.
**Accept:** refresh works without reload; failures show the notice and never block CRM
data; unconfigured state names `GOOGLE_WORKSPACE_CLIENT_DIRECTORY_SHEET_ID`.

### SET-12 · Data & security: Planned placeholders for backup/restore, retention/export, session revocation, live-data cleanup (small, after SET-01)
**Why:** The section has zero controls while the backend plans commit to all four; the
honest interim is named Planned placeholders, not silence.
**Do:** Four cards with "Planned" badges and one factual sentence each; NO status
indicators, NO buttons; identical render regardless of backend state (there is no endpoint
— rendered test asserts invariance under differing mocked payloads); live-data-cleanup
card cross-links the simulation reset. Code comment: replace, don't augment, when real
endpoints exist. No docs-path links in UI copy.
**Accept:** cards render invariantly; existing safeguards text + install panel unchanged.

---

# Workstream D — Flooring KPIs & reporting (KPI)

Goal: give the owner the handful of numbers every flooring-installation business runs on,
computed truthfully from data the app already captures, then sharpened with a minimal set
of additive inputs. Grounded in the real business: Floor Coverings International Cherry
Hill is a design-led franchise (mobile showroom, in-home consultation, subcontracted
installation crews, post-installation follow-up walkthrough) selling hardwood, carpet,
luxury vinyl, tile/stone, laminate, and specialty flooring; the franchisor's own headline
franchise metric is **gross booked-job revenue**, and the industry's universal operator
KPIs are close rate, average ticket/job value, booked and installed revenue, backlog,
install cycle time, and callback rate.

Rules for this workstream: (1) **simple over complete** — only KPIs every flooring
installer recognizes instantly; (2) every formula is pinned in one definitions doc so all
agents and reports compute identical numbers; (3) **dollar-value KPIs are
Administrator-only at rollout** per `docs/administration-and-access-plan.md` (the
single-user development copy shows everything today; wire the gate through SET-02's
`isAdmin` when available); (4) schema changes are additive-only and follow
`docs/development-d1-schema-migrations.md` (D1) and the append-only checksummed registry
(PostgreSQL); (5) no cost/margin capture, no external review data, no scheduling
dependencies — see the exclusions in KPI-01's definitions doc.

### KPI-01 · Tier-1 KPI report from existing data + definitions doc (medium, after the FloorOpsApp queue clears — no schema change)
**Why:** Six universal KPIs are computable today from fields that already exist on leads
{status active/converted/lost, stage, source, estimatedValue, createdAt, updatedAt} and
projects {status lifecycle, estimatedValue, createdAt, updatedAt}, but the Reports screen
only shows pipeline-by-stage and projects-by-status. The owner currently has no close
rate, booked-revenue, or backlog number anywhere.
**Do:** (1) Write `docs/flooring-kpis.md` — the single source of truth: each KPI's name,
exact formula, fields used, admin-only flag, and known approximations. Tier-1 set:
**Win rate** = converted ÷ (converted + lost) leads in period, overall and by `source`
(non-financial); **Booked value per month** = Σ estimatedValue of leads whose status
became converted in the month (financial — mirrors the franchisor's booked-jobs metric);
**Average job value** = mean estimatedValue of converted leads (and of created projects)
in period (financial); **Sales cycle days** = mean(conversion time − createdAt) for
converted leads (non-financial); **Backlog** = count and Σ estimatedValue of projects in
planning/mobilizing/installation/closeout (count non-financial, value financial);
**Jobs completed per month** = projects whose status became completed in the month
(non-financial). Document honestly that until KPI-02 lands, status-change time is
approximated by `updatedAt` (and improved by `activity_events` where loaded), and project
cycle time is deliberately EXCLUDED until real installation dates exist — no fake
precision. Record deliberate exclusions with reasons: gross margin (no cost capture),
material-vs-labor split (no invoice data), NPS/Google reviews (external data; candidate
later Google Business Profile integration for this Google-first company), crew utilization
(scheduling unbuilt). (2) Add a "Business KPIs" panel to the Reports view computing these
client-side from the already-loaded lead/project arrays (the same pattern as the existing
stage-value computation), with a month selector for the two per-month KPIs, the shared
panel/stat conventions, and each dollar KPI marked with the admin-only note (gate via
`isAdmin` from SET-02 once PR #37 lands). Extract the formulas into a pure helper module
(e.g.
`app/features/reports/flooring-kpis.ts`) so unit tests pin the math to the definitions
doc. (3) Keep drill-through consistency: where a KPI has a natural destination (win rate →
Leads, backlog → Projects Active filter), reuse the PR #27 bounded-filter links.
**Files:** `docs/flooring-kpis.md` (new), `app/features/reports/flooring-kpis.ts` (new),
`app/FloorOpsApp.tsx` (Reports region), `app/globals.css` (reuse existing panel/stat
classes; additions only if unavoidable), `tests/` (unit for every formula incl. zero-
denominator and empty-period cases; rendered coverage per repo convention).
**Accept:** unit tests pin every formula from the definitions doc (win rate with 0
decided leads renders an em-dash, not NaN — honest-empty-state rule); Reports renders the
panel with seeded data at desktop and 390px with axe serious/critical clean; `npm test`
and the Playwright suites pass; the ledger status line updates in the same PR.
**Deps:** FloorOpsApp queue after SET-02 / PR #37 merges; PR #34, which defines this KPI
workstream, is merged. One FloorOpsApp packet at a time. Effort: medium.

### KPI-02 · Tier-2 minimal inputs: flooring category, square feet, contract value (medium, after KPI-01)
**Why:** Three additive fields unlock the flooring-specific KPIs no generic CRM field can:
what we sell (product mix), how big jobs are (sq ft), and what they actually sold for
(vs. the estimate). All are known at booking time in this business model (the design
consultation produces exactly these), so they belong on the create-project form — no
workflow redesign.
**Do:** (1) `db/schema.ts`: add nullable columns to `projects` — `flooring_category`
(text; suggested values hardwood / carpet / luxury-vinyl / tile-stone / laminate /
specialty / mixed — validate against the list server-side but store text),
`square_feet` (integer), `contract_value` (integer dollars, the sold price at booking);
run `npm run db:generate` for immutable migration 0012 per
`docs/development-d1-schema-migrations.md` (additive, no unique indexes, no backfill).
(2) Extend POST /api/v1/projects validation (bounded, all three optional) and the
New-project modal with the three optional inputs (category select, sq ft, contract
value — modal field conventions from the accessibility pass); render them in the project
drawer stats. (3) Update `docs/flooring-kpis.md` and the KPI helper: **Product mix** =
job count and value share by category (value share financial); **Revenue per square
foot** = contract_value (fallback estimatedValue) ÷ square_feet, per job and period
average (financial); **Estimate accuracy** = contract_value ÷ estimatedValue where both
exist (financial); Booked value and Average job value now prefer contract_value with
estimatedValue fallback — the fallback rule is pinned in the definitions doc. KPIs render
only when at least one record carries the field ("Not yet captured" otherwise — never a
fake zero). (4) Do NOT add installation dates or callbacks here — that is KPI-03.
**Files:** `db/schema.ts`, `drizzle/` (generated), `app/domain/` project validation,
`app/api/v1/projects/route.ts`, `app/FloorOpsApp.tsx` (modal + drawer + Reports),
`docs/flooring-kpis.md`, `tests/`.
**Accept:** migration 0012 is additive-only and `npm run db:migrate:local` applies it;
create-project round-trips the three fields (API + e2e); KPI panel shows the new KPIs
with captured data and "Not yet captured" without; existing projects (null fields) never
break any KPI; full suites pass.
**Deps:** KPI-01. Effort: medium.

### KPI-03 · Installation dates + callback capture via audited drawer actions (medium, after KPI-02)
**Why:** Install cycle time and callback rate are the two operations/quality KPIs every
installer tracks — and this franchise's post-installation follow-up walkthrough makes the
callback question a natural existing step. But project editing does not exist yet
(tracked step-7 roadmap work). The repo already has the right interim pattern: the
audited, admin-only "Assign to me" drawer action.
**Do:** (1) Additive migration (0013): `installation_started_at` (ms),
`installation_completed_at` (ms), `had_callback` (integer boolean default 0),
`callback_note` (text, bounded) on `projects`. (2) Following the manager-assignment
pattern exactly (admin-only, same-origin, reason-free single-purpose action, activity
event on success): drawer actions "Record installation dates" (small modal, two date
inputs, completed ≥ started validation) and "Record follow-up result" (callback yes/no +
optional bounded note). (3) KPI updates in the definitions doc + helper: **Install cycle
days** = completed − started per job and period average (non-financial); **Callback
rate** = had_callback jobs ÷ completed jobs in period (non-financial); replace KPI-01's
documented `updatedAt` approximation for jobs-completed timing with
`installation_completed_at` where present (fallback rule pinned in the doc). (4) These
fields are the forward-compatible seed for the future Scheduling milestone — note in the
definitions doc that Scheduling must consume, not duplicate, them.
**Files:** `db/schema.ts`, `drizzle/`, `app/api/v1/projects/[projectId]/route.ts` (extend
the existing audited-action PATCH surface), `app/FloorOpsApp.tsx` (drawer),
`docs/flooring-kpis.md`, `tests/`.
**Accept:** both actions are admin-gated server-side and append activity events; invalid
date order fails closed; KPIs compute from the new fields with pinned fallbacks; full
suites pass.
**Deps:** KPI-02. Effort: medium.

### KPI-04 · PostgreSQL parity and rehearsal coverage for KPI fields (small, after KPI-02/03 + BE-06)
**Why:** Guardrail: the D1 dev schema and the production PostgreSQL boundary must not
drift. The postgres `projects` table (migration v1) predates the KPI columns.
**Do:** Append a new checksummed PostgreSQL migration (next free version after the ones
BE-06/BE-07 claim — coordinate version numbers via the registry, never renumber) adding
the same nullable columns with CHECK constraints (category allowlist, square_feet > 0,
contract_value ≥ 0, completed ≥ started); extend `infrastructure/postgres/
least-privilege.sql` grants and readiness expectations; extend the postgres project
repository row mapping; add the columns to the BE-12 rehearsal snapshot format and
inventory classification so migrated projects carry their KPI data.
**Files:** `app/platform/postgres/production-schema-migrations.ts` (append only),
`infrastructure/postgres/least-privilege.sql`,
`app/platform/google-cloud/database-readiness.ts`,
`app/adapters/postgres/project-repository.ts`, rehearsal modules per BE-12, `tests/`.
**Accept:** existing checksums unchanged, new version registered; gated PG16 integration
tests apply and round-trip the columns; rehearsal imports KPI fields with hash
verification; `npm test` passes.
**Deps:** KPI-02 (columns exist), BE-06 (version-number coordination), BE-12 (snapshot
format). Effort: small.

---

# Task tracking and doc reconciliation (the no-confusion rule)

**GitHub baseline:** PR #32 merged to `main` as
`adc79b855041db04cc3ca2a3eb232bc72408d33b` on July 19, 2026, and that exact commit is
deployed as private Sites development version 40. The deployment includes PR #30's
semantic Settings rules table. Delivery PRs may be in flight later; they mirror items in
these ledgers and do not become a separate task source of truth. The source-only
`codex/actionable-lists` branch is complete in PR #33; it is not deployed. The source-only
`codex/settings-panel-extraction` SET-01 slice is complete in source and merged in PR #35 and is not deployed.
SET-02 has passed source acceptance in draft PR #37 and is not deployed. PR #34 is merged;
KPI-01 is queued for the next `FloorOpsApp.tsx` slot after PR #37 lands.

**This document is the status ledger for these three workstreams** (the same pattern as
`docs/design-critique-fix-plan.md` for the UI critique). Rules for every agent packet:

1. All items are **Open** as of July 18, 2026. When an agent starts an item, it appends a
   dated status line to that item in this file in its own PR
   (`Status: In progress — <branch>`), and on merge updates it to
   `Status: Complete — PR #NN, <date>`. Owner-blocked items use
   `Status: Blocked — waiting on <checklist 00 input>`.
2. An item is marked Complete **only** when its Acceptance line passes — never from a
   visual or partial change.
3. Every packet that changes behavior also updates the docs that describe that behavior
   **in the same PR** (each item's Files list already names them). A doc that contradicts
   merged source is a defect — treat it like a failing test.

**Division of authority — which doc answers "what is the current state of tasks?":**

| Surface | Role | Rule |
|---|---|---|
| This document | Active agent work for architecture / Workspace / Setup-UI | Status lines updated per PR (rules above) |
| `docs/design-critique-fix-plan.md` | UI remediation ledger (PRs #24–#30) | Already canonical; SET work updates the relevant Phase 3/4 entries |
| `docs/task-checklists/*` | **Owner-facing** setup, connection, acceptance, and operations checkboxes | Owners check boxes; agents only fix stale facts (BE-01) or add evidence templates (WS-11) |
| `docs/complete-product-and-google-cloud-architecture-audit.md` roadmap | Architecture branch history and gates | TRK-01 cross-references its open items to BE/WS ids |
| `README.md` "Prioritized next work" | Entry point / pointer | BE-01 fixes its content; TRK-01 makes it point to the ledgers instead of duplicating them |
| `docs/administration-and-access-plan.md` | **Approved first-release access design** (fixed roles, five admin workflows, initial Administrators `admincrm@`/`brett@cherryhillfci.com`) | BE-04 and any access work must conform to it; do not re-open its decisions |
| `docs/pre-workspace-development-plan.md` | What can start now vs. must wait for Workspace/credentials | Consistent with this plan's owner gate; TRK-01 cross-links it |
| `docs/20-user-product-and-architecture-review.md` | P0/P1/P2 findings, corrected delivery order, go/no-go gates | The gates govern second-user/real-data admission; BE/WS items map onto its delivery order |

**Alignment rule:** `docs/task-checklists/README.md` remains an owner-facing dashboard and
points here instead of duplicating agent sequencing. The design ledger owns the
actionable-list and later UI consolidation sequence; WS-12 owns provider-neutral
job/sync-state contracts with local fakes; BE-12 owns migration-fixture expansion without
staging. No checklist checkbox is added merely to mirror those agent packets.

### TRK-01 · Reconcile every task-tracking surface to a single source of truth (small, after BE-01) — assign together with BE-01
**Status:** Complete — PR #32, July 19, 2026.

**Why (owner's ask):** task state is currently spread across the README next-work list,
ten task checklists, the audit-doc roadmap, and the design ledger — with the README and
several checklists already contradicting merged source (see BE-01). Without one rule for
where status lives, every future agent re-derives it and some will get it wrong.
**Do:** (1) In `README.md`, after BE-01's content fix, reduce "Prioritized next work" to a
short pointer paragraph: active agent work → this document; UI remediation → the design
ledger; owner setup/acceptance → `docs/task-checklists/README.md`; architecture branch
history → the audit-doc roadmap. (2) In `docs/task-checklists/README.md`, add a
"Where agent work is tracked" note pointing here, and state that checklists are
owner-facing. (3) In the audit doc's roadmap, annotate each still-open item with its
current owner: 10→unassigned pending the field-assignment domain, 11→BE-12, 12→BE-04,
13→WS-12 then BE-14, 14→WS-12/BE-14, 15→unassigned (BE-05 supplies only the
prerequisite storage adapters), 16→BE-10 for the rate-limit subset while the listed
observability work remains unassigned, 17/19→unassigned domain work,
and 18→the design ledger plus SET-01–SET-12. Annotate; don't rewrite completed history.
(4) Record the dated GitHub baseline; if issues appear later, they mirror items in these
ledgers and do not fork new state. (5) Add nothing new to any checklist — this item only
wires the surfaces together.
**Files:** `AGENTS.md`, `README.md`, `docs/task-checklists/README.md`, the architecture
roadmap, this file, related handoff/status ledgers, and
`tests/task-tracking-docs.test.mjs`.
**Accept:** each of the four surfaces names its role and links the others; the README is a
pointer, not a duplicate task list; every open audit-roadmap item carries an owning
BE/WS/SET or design-ledger reference, or an explicit "Unassigned" tag; automated tracking
contracts and `npm test` pass.

---

## Sequencing at a glance

**Start now, in parallel (no owner input needed):**
The source-only `codex/actionable-lists` slice in PR #33 is complete as the current
actionable-list packet; it is not deployed. The source-only
`codex/settings-panel-extraction` SET-01 slice is complete in source and merged in PR #35 and is not deployed.
SET-02 is in review in draft PR #37; after it lands, KPI-01 takes the next
`FloorOpsApp.tsx` slot. BE-02 + BE-13 are in review together in PR #36. BE-04 is in
review in draft PR #38, and WS-04 + WS-12 are in review together in PR #39.
All remain source-only. BE-05, BE-06,
BE-08, BE-11 (authoring), and WS-13 remain unclaimed and may proceed in parallel when
they do not touch that file. BE-01 + WS-03 and TRK-01 completed in PR #32.

**Chains:** BE-02→BE-03 · BE-06→BE-07→(coordinate SET-05) · BE-04+BE-06→BE-09→BE-10 ·
BE-06→BE-12 · BE-08+BE-09+BE-11→BE-14 · SET-01→SET-02→{SET-03..SET-12} ·
SET-03→SET-10 · SET-04→SET-11.

**Owner track (sequential):** WS-01 → WS-02 → WS-05 → WS-06 → WS-07 → WS-08 → WS-09(live
half) → WS-11. Agents should never be blocked idle on this track — every agent item above
is schedulable independently.

**Merge-conflict hotspot:** `app/FloorOpsApp.tsx`. Do not run two packets that touch it
concurrently. The source-only `codex/actionable-lists` branch is complete in PR #33.
The source-only `codex/settings-panel-extraction` SET-01 slice is complete in source and merged in PR #35.
SET-02 preserves that boundary in draft PR #37 and has passed its source acceptance.
KPI-01 is next in this queue after PR #37 merges; it must preserve the extracted Settings
boundary, shared actionable-list pattern, and `InboxRulesPanel`'s semantic `<table>`
markup, and keep their focused regression suites plus
`tests/e2e/accessibility-routes.spec.ts` green.

### Recommended first waves (reconciled July 19, 2026)

**Wave 1 — next PRs, in this order where they share files:**
1. **Doc-truth bundle: BE-01 + TRK-01 + WS-03** — complete in PR #32 at `adc79b8` and
   deployed as private Sites development version 40.
2. **Actionable-list pattern slice** — complete in PR #33, source-only on
   `codex/actionable-lists`: an accessible actionable-list for the whole-row Overview
   pipeline, Projects, and Clients views (do not force interactive rows into table
   semantics), following the PR #30 review pattern. It is not deployed. *Touches
   `FloorOpsApp.tsx` — do not overlap it with SET-01.*
3. **SET-01 Settings panel extraction** — complete in source and merged in PR #35 from
   `codex/settings-panel-extraction`; it is not deployed. **SET-02 has passed source
   acceptance in draft PR #37 and is in review.**
4. **BE-04 OIDC** — in review in draft PR #38 on `codex/workspace-oidc-login`; it remains
   the production long pole. **BE-02 + BE-13** — in review together in PR #36 with
   green checks. **WS-04 rotation procedures + WS-12 contracts/fakes** — in review in
   PR #39 on `codex/workspace-rotation-sync-contracts` with no live resources.

**Wave 2:** after SET-02 / PR #37 lands, KPI-01 takes the next `FloorOpsApp.tsx` slot.
SET-03/SET-04 may then proceed in the extracted Settings boundary without overlapping
that file (get the guided setup stepper and environment-prerequisites table in place
**before** the owner performs WS-05/WS-06, so the connection steps are self-verifying in
the UI) · BE-05 · BE-06 → BE-12 · design ledger Phase 4 guardrails (state-coverage axe,
hardened screenshot harness) before the big primitive/CSS consolidation tracks.

**Owner/Brett track (calendar time — start nudging now):** Brett's read-only GCP
inventory + Workspace resource verification (WS-01/WS-02, checklists 01/02) are the only
things gating the live connection; every agent item above proceeds without them. Jason's
open decisions live in checklists 00/06/10.

**FloorOpsApp single-file queue (one packet at a time):** PR #33 (actionable lists) →
SET-01 (Settings extraction) → SET-02 (draft PR #37) → KPI-01 (Tier-1 KPI panel) →
KPI-02 → KPI-03, interleaving other SET items in extracted modules as they become
independent after SET-02. Workstream D's KPI packets are
otherwise independent of the BE/WS tracks (KPI-04 coordinates PostgreSQL migration
version numbers with BE-06).

**Cross-item coordination (implement once):** multi-key token decryption (WS-04 ↔ BE-08);
calendar-ID single authority (SET-05 ↔ BE-07); integration events reader (SET-09 ↔ WS-10);
`GOOGLE_WORKSPACE_PUBSUB_TOPIC` removal (WS-03, referenced by BE-02); version-37 doc fixes
(BE-01, referenced by WS-03; preserve accurate historical release evidence).

## Verification appendix

Formally adversarially verified by independent checkers: BE-03, BE-04, BE-09, BE-10
(CONFIRMED), BE-12 (ADJUSTED — corrected doc citation and table count, reflected above).
Additionally spot-verified directly against the repo for this document: the five unbounded
`request.json()` call sites; `worker/index.ts` Env missing `FILES`; zero code references
to `GOOGLE_WORKSPACE_PUBSUB_TOPIC`; stale current-state versus accurate historical
"version 37" checklist references;
`decryptGoogleSecret` single-key behavior (`app/lib/google-oauth.ts:159`); connectionKey
partitioning (`:219`); `SettingsView`/`GoogleWorkspacePanel` anchors (`FloorOpsApp.tsx:
1346`/`1618`); `SETTINGS_SECTIONS` (`operations-routes.ts:27`); absence of `isAdmin` in
GET /settings/me; absence of any integration-audit route; existence of every cited port,
`infrastructure/google-cloud/`, `Dockerfile.cloud-run`, and `production-runtime/src`.
Line anchors will drift as work lands — packets should re-locate by symbol name, not line.
