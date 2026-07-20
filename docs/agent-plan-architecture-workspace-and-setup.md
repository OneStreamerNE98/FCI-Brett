# Agent execution plan: backend architecture, Google Workspace connection, and Settings/Setup alignment

Date: July 19, 2026 · Status reconciled: July 20, 2026 · Source baseline: `main` @
`71f6745` (PRs #54/#55 completed OIDC-02/OIDC-03; PR #60 reconciled OIDC-02;
PR #61 expanded the Fable follow-up instructions; PRs #51–#53 and #56–#57 remain open drafts). Deployment baseline: `adc79b8`, private Sites development version 40,
which includes PR #30. The later source changes are not deployed.

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
   production-schema-migrations.ts` locks v1–v6 with SHA-256 checksums verified by
   readiness probes and source-contract tests. Never edit an existing migration; append
   v7+. **All six migrations are unapplied everywhere — no Cloud SQL instance exists.**
   (Do not read "migrations 4–5 remain unapplied" in the audit doc as implying 1–3 are
   applied; BE-01 fixes that phrasing.)
4. **The deployed D1 drizzle sequence (0000–0011) is append-only.** Draft PR #52 adds
   source-only migration 0012, but it is not part of `main` and has not been applied to
   Sites. Never drop or alter existing D1 tables; the dev environment is the only live
   environment.
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
   The source-only `codex/settings-panel-extraction` SET-01 slice is complete in source in PR #35 and is not deployed.
   SET-02 is complete in PR #37, KPI-01 is complete in PR #41, and SET-03/SET-04 are
   complete in PR #44. None is deployed. KPI-02 is in review in draft PR #52 and occupies
   the sole `FloorOpsApp.tsx` queue slot. Do not
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
  (`Dockerfile.cloud-run`, `production-runtime/src/*`), PostgreSQL schema v1–v6 with
  identity/audit/integration/file tables, idempotency + outbox repositories, least-
  privilege SQL, zero-resource Terraform (`infrastructure/google-cloud/`), bounded
  D1→PostgreSQL rehearsal that always reports `cutoverReady:false`. Provider routes 503 by
  design. Workspace OIDC initiation/callback, invitation redemption, and session issuance
  now exist in source through PRs #38/#48; configuration, migration/apply, deployment, and
  live employee admission remain gated.
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
**Status:** Complete — PR #36, July 19, 2026. Source-only and not deployed.

Full local and GitHub checks passed.

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
**Accept:** `npm test` passes; oversized bodies return each route's explicit 413 JSON
contract before persistence; grep for raw `request.json()` in those routes returns nothing.

### BE-03 · Retire the legacy /api/v1/records surface (small, after BE-02)
**Status:** Complete — PR #46, July 19, 2026. Source-only and not deployed.

The unused route is deleted rather than retained as a 410 stub, `actorFrom`
is removed, and the assistant's separate records-only answer mode remains covered.
The immutable D1 history is unchanged; BE-12 must classify the table as
`records: excluded (legacy, no migration)`.

**Why:** At packet start, the generic JSON record store had no UI caller and was
referenced only by two source-contract tests; the adjacent `actorFrom` helper had zero
call sites. The retirement regression now verifies that neither application surface
returns.
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
found a launch-blocking callback issue that PR #48 resolved, plus remaining hardening,
test, and documentation gaps — see
[`docs/be04-oidc-review-and-followups.md`](be04-oidc-review-and-followups.md) (packets
OIDC-02..OIDC-04).**

**Why (at packet start):** The single largest production gap was that the Cloud Run image
had no login.
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
**Status:** Complete — PR #40, July 19, 2026. Source-only and not deployed.

No GCS adapter composition, bucket provisioning, or hosted configuration was performed.

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
**Status:** Complete — PR #42, July 19, 2026. Source-only and unapplied.

`npm test` passed 355 active tests with 13 expected PostgreSQL-gated skips;
lint and both builds pass. Source-only; no migration, grant, database, hosted
configuration, or deployment has been applied.

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
**Status:** Complete — PR #45, July 19, 2026. Source-only and uncomposed.

Local acceptance is green (395 tests, 380 passed and 15 environment-gated skips, plus
lint); provider routes, production secrets/grants, infrastructure, and deployment remain
uncomposed and unapplied.

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
**Status:** In review — draft PR #51 from `codex/be09-production-writes`, July 20, 2026. Source-only and not merged, applied, configured, or deployed.

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

### BE-10 · Rate limiting on both surfaces (medium, after BE-04+BE-09; VERIFIED)
**Why:** No rate limiting exists anywhere (verified). Cost-bearing dev routes: assistant
(OpenAI), uploads (R2), sheets/sync + project drive provisioning (Google quota). The
acceptance checklist requires limits before go-live.
**Do:** Production: per-identity token bucket in a new
`app/platform/google-cloud/request-rate-limit.ts` applied before dispatch (in-memory
per-instance is acceptable at max two instances per CONNECTION-BUDGET.md); 429 +
Retry-After + security-audit event; configurable via production-config, fail-closed
defaults. Dev: light fixed-window per office user on the four cost routes. Document.
**Accept:** threshold tests (429 + audit event); under-threshold byte-identical.

### BE-11 · Deployment mechanism source definitions (medium; source complete, apply owner-gated)
**Status:** Complete — PR #47, July 19, 2026. Source-only, unpublished, unapplied, and undeployed.

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

PR #47 contains the default-off source definitions, keyless protected-environment image
workflow, gate/default-zero tests, and truthful
runbook update. Local Terraform 1.15.8 formatting, validation, and 29 mocked plans pass;
392 Node tests report 377 passing, 15 explicitly gated skips, and zero failures. PR CI
also passes the unauthenticated Docker build, Terraform validation, Node suite, and
Chromium suite; the image-publish job correctly skips. Nothing has been applied,
published, deployed, executed, or configured.

### BE-12 · Rehearsal inventory expansion (medium, after BE-06; VERIFIED with corrections)
**Status:** In review — draft PR #53 from `codex/be12-rehearsal-inventory`, July 20, 2026. Source-only and not merged, applied, configured, or deployed.

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
**Status:** Complete — PR #36, July 19, 2026. Source-only and not deployed.

Full local and GitHub checks passed.

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
**Status:** Complete — PR #39, July 19, 2026. Source-only and not deployed.

Local acceptance is green (337
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
**Status:** Complete — PR #39, July 19, 2026. Source-only and not deployed.

Provider-neutral durable-job,
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

### WS-14 · OWNER — Calendar-management scope review and consent re-grant (small, after WS-02; gates SET-20)
**Why:** Dashboard calendar creation needs `https://www.googleapis.com/auth/calendar`
(`calendars.insert`/`calendarList.list`), which the current consent does not hold
(`calendar.events` only). Adding it is a consent-surface expansion the owner must
approve under checklist-02 scope-review discipline; the app never widens consent
silently. See [dashboard workspace setup design](dashboard-workspace-setup-design.md).
**Do (owner, guided):** Review the scope-addition rationale (calendar creation and
listing from the setup dashboard); confirm the connector OAuth client's consent screen
lists the calendar scope (the two OAuth clients are never merged); set
`GOOGLE_WORKSPACE_CALENDAR_MANAGEMENT=true` in hosted configuration; disconnect and
reconnect Workspace from Settings, approving the new consent; confirm the SET-10 health
card shows the scope granted.
**Accept:** connection status shows `auth/calendar` granted; the audit trail records one
reauthorization pair; no other scope changed; checklist-02 row checked with a date.

---

# Workstream C — Settings/Setup UI alignment (SET)

Goal: make `/settings` a truthful, ordered control center for (a) first-time Workspace
setup, (b) background-data status and maintenance, (c) recurring admin tasks. IA/content/
wiring only — no visual redesign. All buildable and testable in simulation mode. Verified
anchors at the `aa8ed8f` baseline: `SettingsView` at `app/FloorOpsApp.tsx:1354`,
`GoogleWorkspacePanel` at `:1639`, `SETTINGS_SECTIONS` at `app/lib/operations-routes.ts:27`;
At that baseline, `GET /api/v1/settings/me` returned no `isAdmin`; PR #37 added the
authenticated flag without weakening any server gate. No integration audit route exists.
(Anchors drift — locate by symbol name.)

### SET-01 · Extract the eight Settings panels into `app/settings/components/` (large, complete in source in PR #35; not deployed) — DO FIRST in the SET workstream
**Status:** Complete — PR #35, July 19, 2026. Source-only and not deployed.

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

### SET-02 · Expose `isAdmin`; render admin-only controls honestly (small, after SET-01; merged in PR #37, not deployed)
**Status:** Complete — PR #37, July 19, 2026. `npm test`, lint, rendered admin/Office
coverage, conflicting-`.env.local` reproduction, and desktop/390 px visual QA passed. No
server gate, schema, hosted configuration, or deployment changed.

**Why:** Nine mutating routes are admin-gated server-side, but the UI renders
Save/Sync/Reset/Connect identically for non-admin office users, who discover the
restriction only via a failed request. `workspace-auth.ts` already computes isAdmin.
**Do:** Add `isAdmin` to GET /api/v1/settings/me; share one identity fetch; disabled
style + "Administrator action" note on every admin-gated control for non-admins (visible,
not hidden). Server gates untouched.
**Accept:** rendered tests for both identities; grep confirms server gates unchanged.

### SET-03 · Guided Workspace setup stepper with per-step live status (large, after SET-01+02)
**Status:** Complete — PR #44, July 19, 2026. Source-only and not deployed.

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
**Status:** Complete — PR #44, July 19, 2026. Source-only and not deployed.

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
**Do:** Consume SET-13's `app/lib/workspace-effective-config.ts` resolver (do not
create the file) in the calendar events + test-hold routes.
Extend GET /api/v1/google-workspace with per-calendar configured+source. Panel shows "In
use (saved setting)" / "In use (environment value — saving here will override it)" /
"Not configured". Update rollout guide Part 10 + checklist 03 (env = bootstrap, settings =
authoritative). Add `POST /api/v1/integrations/google/calendar/verify` (events.list
probe with the current `calendar.events` scope; adopt-by-ID into the SET-13 registry).
After SET-13.
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
**Status:** In review — draft PR #56 from `codex/set10-connection-health`, July 20, 2026. Source-only and not merged or deployed.

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
Once SET-16 lands, the unconfigured state points to the Workspace-setup spreadsheets
action instead of naming the env var (env stays documented as fallback).
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

### SET-13 · Workspace resource registry + effective-config layer + resources card (large, after SET-03+04 and after SET-10 lands) — FIRST in the dashboard-setup feature
**Why:** Owner-approved direction ([design doc](dashboard-workspace-setup-design.md)):
dashboard-created resource IDs persist app-side and become runtime-authoritative with
env fallback and a visible source badge. Today `authorize` gates on `oauthReady`, which
requires resource-ID env vars — so nothing can be created from the dashboard because
you cannot connect first. Generalizes SET-05's accepted resolver pattern to all four
resource IDs.
**Do:** (1) Append-only D1 migration (next unused number) creating `workspace_resources`
per the design doc §1, plus adapter `app/adapters/d1/workspace-resources.ts`
(list/upsert on the unique connection+type+key index). (2) New pure
`app/lib/workspace-effective-config.ts`: `resolveEffectiveWorkspaceResources` (app > env
> none, source-tagged) and `applyEffectiveWorkspaceConfig` (filters — never rewrites —
the four resource-ID `missingDetails` entries when app-satisfied; recomputes
`missing`/`oauthReady`; adds `connectReady` = nothing missing outside the resource-ID
set). `getGoogleRuntimeConfig` stays byte-for-byte untouched. (3) Async
`getEffectiveGoogleRuntimeConfig()` composition in `app/lib/google-oauth-sites.ts`.
(4) The authorize route gates on `connectReady` (deliberate change; replace its pinned
tests mutation-sensitively: new allow + retained OAuth-client/secret denials). (5) New
admin `GET /api/v1/integrations/google/setup/resources` (registry+env+blueprint status,
no Google calls). (6) "Workspace setup → Resources" card skeleton in
`GoogleWorkspacePanel.tsx` (status rows, state chips, source badges; action buttons
arrive with later packets). (7) Simulation reset deletes simulation registry rows.
**Accept:** resolver unit matrix (all source×presence combinations, `connectReady`
split, filter-not-rewrite); a pin test proving base `getGoogleRuntimeConfig` output
unchanged on a fixture env; authorize connects with resource IDs absent but still 409s
on missing client ID/secret; resources GET 403 for non-admins and contains no secret
values; migration guard updated; simulation e2e reset round-trip. All existing
`missingDetails`/readiness pins pass unmodified except the authorize-gate cases.
**Effort:** large. **Coordinates:** SET-05 (consumer), SET-09 (card order), BE-07/BE-08
(storage port later).

### SET-14 · Workspace blueprint: model, seed, persistence, structured editor (large, after SET-13)
**Why:** Owner requirement: the folder tree, spreadsheets, templates, and setup
attributes must be owner-definable in the dashboard, not hardcoded; `DRIVE_BLUEPRINT`
becomes the seed of a versioned, persisted blueprint the setup engine consumes.
**Do:** Append-only D1 migration creating `workspace_blueprints` (one current row per
connection, `version`, `blueprint_json`); `app/lib/workspace-blueprint.ts` with the
types, `seedWorkspaceBlueprint()` built from the `DRIVE_BLUEPRINT` literals, and
`sanitizeWorkspaceBlueprint()` enforcing the system/owner rule set, slug-key format,
depth ≤ 2, count bounds (≤50 folders, ≤20 templates, ≤10 spreadsheets), naming-token
validation ({code} {name} {number} {year}), and `targetFolderKey` referential integrity
— system-node mutation returns 400 naming the exact path (system set per the design
doc: `99_Unsorted Intake`, the `05_Correspondence` subtree, the client-directory
spreadsheet entry, `FCI/*` labels, calendar keys). `GET`/`PUT
/api/v1/integrations/google/setup/blueprint` (expectedVersion optimistic concurrency,
409 on conflict, `setup.blueprint_updated` event with change summary). Blueprint editor
card: structured folder tree (add/rename/remove owner nodes; lock badges with reason
tooltips on system nodes), Templates/Spreadsheets list forms with target-folder
dropdowns, Business-attributes form (display name, naming patterns with token legend,
calendar defaults), "Planned" rows for later catalog items, explicit Save. Migrate
`resolveDriveWorkspace` storage name + Gmail labels prepare to read the (identical)
seed values. Simulation reset deletes the simulation blueprint row.
**Accept:** sanitizer matrix (system-path 400s, bounds, tokens, references); seed ≡
legacy `DRIVE_BLUEPRINT` pin; PUT version-conflict 409; bounded-body rejection; editor
e2e (rename owner folder + add template + locked `05_Correspondence` attempt → Save →
GET reflects version+1); office user sees no editor; reset restores seed.
**Effort:** large.

### SET-15 · Shared Drive adopt/verify + blueprint-driven root folder tree + rename (medium, after SET-14)
**Why:** Owner starter set: Shared Drive adopt/verify plus the standard folder tree —
now blueprint-driven, so next year's folder is a dashboard edit, not a code change.
Shared Drive creation stays manual in checklist 01 (adoption covers the real path).
**Do:** `GoogleDriveClient.getSharedDrive`/`findSharedDriveByName` (`drives.get`/
`drives.list`, existing `auth/drive` scope; surface `restrictions` for the
external-sharing verification chip). `POST /api/v1/integrations/google/drive/shared-drive/adopt`
(ID verify-adopt with `env-adopted` origin for env-sourced values; name search from
`blueprint.drive.sharedDriveName`; zero matches → 404 with checklist guidance; multiple
→ 409 with candidates for explicit re-POST). `POST .../drive/folders/ensure-roots`
iterating blueprint roots (children included) with `getOrCreateFolder` identity
`fciRootKey=<node.key>` + `reuseByName` (adopts and stamps same-name manual folders);
setup lease `<connectionKey>:setup:drive-roots`. `POST .../drive/folders/rename`
(owner-managed keys only, 400 for system keys; updates the Drive name and the blueprint
node atomically; `setup.folder_renamed` event). Migrate `drive/verify` and the project
provisioning route to effective config. Wire Resources-card rows and buttons.
Simulation parity throughout.
**Accept:** mocked route tests for adopt-by-ID/by-name/zero/multi branches, rename
system-key 400, lease-conflict 409, non-admin and cross-origin 403s; ensure-roots is
idempotent (second run all `found`) and blueprint-driven (a fixture-blueprint folder
gets created); adopting flips `drive/verify` to the app-sourced ID with env unset;
simulation e2e adopt → ensure → rename journey; audit events asserted in D1.
**Effort:** medium.

### SET-16 · Spreadsheets: system client-directory + owner-defined extras (medium, after SET-15)
**Why:** `google-sheets.ts` maintains tabs/rows but cannot create workbooks — today the
owner hand-creates the directory sheet and records an env var; and the blueprint now
lets the owner define additional spreadsheets.
**Do:** `POST /api/v1/integrations/google/sheets/ensure` iterating
`blueprint.spreadsheets`: find by `appProperties {fciResourceKind:<key>}` within the
Shared Drive → else Drive `files.create` with the spreadsheet mimeType under the target
folder (Drive scope; no new scopes). For the system `client-directory` entry only, run
`prepareGoogleDirectorySpreadsheet` (new thin export over `ensureSheetTabs` +
`ensureHeaders`, no row sync). Registry rows; `setup.spreadsheets_ensured` (+
created/adopted detail) events. Migrate `sheets/status` + `sheets/sync` to effective
config with the source surfaced in the status payload
(`GOOGLE_WORKSPACE_CLIENT_DIRECTORY_SHEET_ID` becomes fallback). Resources-card rows;
Step-5 unconfigured copy points here.
**Accept:** create and adopt branches (mocked); created file carries the identity
`appProperties`; ensure is idempotent; an owner-defined extra spreadsheet in a fixture
blueprint is created without tab preparation; the mirror runs against the app-managed
ID and env fallback is labeled; simulation e2e; existing sheet-sync tests untouched.
**Effort:** medium.

### SET-17 · Templates: blueprint-driven ensure with seed content (medium, after SET-15; parallel with SET-16)
**Why:** Owner starter set: Doc/Sheet templates in a Templates folder, created via Drive
upload-conversion — no new scopes, no Docs API — with the template list owner-definable.
**Do:** `app/lib/workspace-templates.ts`: five seed template bodies (HTML for
`estimate-proposal`, `installation-work-order`, `change-order`,
`pre-install-checklist`; CSV for `project-budget`) rendered with
`business.displayName` and the closed token legend; a minimal titled-shell generator
for owner-added templates (definition lives in the blueprint, content is authored in
Google afterward). Extend `GoogleDriveClient` multipart upload so metadata `mimeType`
(Google-native target) may differ from the media content type (Drive upload-conversion
under the held `auth/drive` scope), preserving `findOrUploadManagedFile` idempotency.
`POST /api/v1/integrations/google/drive/templates/ensure` — ensures the Templates
folder (identity `fciFolderKind='templates'`), then iterates `blueprint.templates` with
`fciTemplateKey` identities; setup lease; registry rows; `setup.templates_ensured`
event; Resources-card rows with Open links. Simulation parity.
**Accept:** conversion request shape pinned (metadata target type + media source type);
per-template idempotency (second run finds, no re-upload); an owner-added blueprint
template gets a shell file; the five-slug seed set is pinned so additions are
deliberate; template content contains no secrets or env values; simulation e2e.
**Effort:** medium.

### SET-18 · Reconcile & drift maintenance (medium, after SET-15+16+17)
**Why:** Owner requirement: blueprint edits after resources exist must drive a drift
view — defined-but-missing offers create; removed-from-blueprint is shown unmanaged and
is **never deleted**.
**Do:** `POST /api/v1/integrations/google/setup/reconcile` — Google reads only (root
children + Templates children via identity `appProperties`, registered
sheets/calendars); computes key-matched drift with states `missing` (action: create via
the relevant ensure route), `renamed` (actions: rename-in-Drive via
`/drive/folders/rename`, or adopt-name-into-blueprint via blueprint PUT; system keys
offer rename-in-Drive only), and `unmanaged` (identity-stamped items whose key left the
blueprint, or unstamped items inside a managed root — informational, optional re-add,
no destructive action). `setup.reconcile_run` event with drift counts. Reconcile card
with the drift table, per-row actions, and an in-sync empty state. Simulation drift
fixtures.
**Accept:** drift matrix against mocked Drive listings; **a mutation-sensitive suite
records every outbound Google call across all setup modules and asserts zero deletion
endpoints/methods**; renamed system key offers rename-drive only; e2e: blueprint-add →
missing → create → in-sync, and blueprint-remove → unmanaged with the resource still
present.
**Effort:** medium.

### SET-19 · Domain & tenant guided checklist card (small, after SET-13; parallel with SET-14)
**Why:** Owner decision: Admin-console/DNS/OAuth/API-enablement/secrets/Groups stay
manual; the dashboard should guide them with instructions, external deep links, and
safe verification instead of dead-ends.
**Do:** Guided checklist card in `GoogleWorkspacePanel.tsx` (shown before connection,
collapsible after): rows for domain verification, operations account, API enablement,
OAuth client + redirect URI, hosted secrets, role-aligned Google Groups — each one
instruction sentence, an external console deep link (`admin.google.com`,
`console.cloud.google.com/apis/credentials`), and a verification chip computed only
from existing payloads (SET-04 `missingDetails` presence, connection GET,
`connectReady`, and the SET-15 Shared Drive `restrictions` chip once available). No new
endpoints; no repo-doc links in UI copy; presence/absence only, never values.
**Accept:** rendered tests across unconfigured/partial/connectReady mocked states;
grep-verified zero new routes and no env values in markup; non-admin variant renders
informational copy only.
**Effort:** small.

### SET-20 · Calendar create-or-adopt behind the granted-scope gate (medium, after SET-05 + WS-14)
**Why:** `calendars.insert`/`calendarList.list` require `auth/calendar`, which the
consent does not hold; creation sits behind the owner's WS-14 scope review, while
verify/adopt-by-ID lands earlier via amended SET-05.
**Do:** `GOOGLE_WORKSPACE_CALENDAR_MANAGEMENT=true` opt-in elevates the requested
calendar scope at the next Connect (absence valid; only an invalid value joins
`missingDetails`); superset mapping in `assertGrantedGoogleServiceScopes` so a granted
`auth/calendar` satisfies the `calendar.events` requirement (without it reconnect
breaks). `POST /api/v1/integrations/google/calendar/ensure`: hard 409 naming the
required scope unless the stored connection's granted scopes include `auth/calendar`;
find-by-summary from the blueprint calendar names → adopt, else `calendars.insert`;
registry + `setup.calendar_created` events; created IDs become runtime-authoritative
through the resolver. Resources-card calendar rows un-gate from the connection GET's
granted scopes. Simulation grants everything.
**Accept:** scope-gate 409 names the exact scope; without the flag the requested scopes
are byte-identical to today (pin); superset mapping keeps reconnect tests green;
create/adopt branches mocked; simulation e2e.
**Effort:** medium.

### SET-21 · Project/client provisioning consumes the blueprint (medium, after SET-15) — LAST in the dashboard-setup feature
**Why:** Per-project/client provisioning must consume the blueprint's folder sets and
naming patterns, or "add a project subfolder" still needs a code change.
**Do:** `buildProjectFolderPlan` + `provisionProjectFolders` consumers read
`blueprint.drive.clientFolders`/`projectFolders` and `naming.*` patterns (token
substitution; the sanitizer guarantees the system `05_Correspondence` subtree
survives); child-folder identities move to blueprint keys (existing stamps remain
valid — additive properties, no re-stamping); reduce `DRIVE_BLUEPRINT` to the seed
literal inside `workspace-blueprint.ts`; keep `resolveManagedProjectFolderPath`
compatible.
**Accept:** provisioning against the seed blueprint is behavior-identical (pin: same
folder names/paths as today for a fixture project); a blueprint-added project subfolder
appears on the next provisioning; filing to `05_Correspondence / Email Archive` still
resolves (existing Gmail file-route tests green); simulation e2e provisioning walk.
**Effort:** medium (touches live provisioning — sequenced last deliberately).

### SET-22 · Create Google files in project folders from the app (medium, after SET-17; UI half after KPI-02/#52 merges)
**Why:** Owner request: from the projects dashboard, create a Google Doc, Sheet, or
Slides file (the Word/Excel/PowerPoint equivalents) inside the project's Drive folder —
blank or from a blueprint template — so the provisioned folder structure and template
library become useful in daily work, not just at setup time.
**Do:** (1) `POST /api/v1/projects/[projectId]/drive/files` — same-origin; office-user
gated (routine project work, deliberately NOT admin-only like provisioning); bounded
body `{kind: "doc"|"sheet"|"slides", name, templateKey?, folderKey?}` with validated
name and closed kind set. Requires the project's provisioned folder mapping
(`drive_folder_mappings`) — otherwise 409 with "provision the project folder first"
guidance. Blank create via Drive `files.create` with the Google-native mimeType
(document/spreadsheet/presentation) and parent = the project folder (or the blueprint
project-subfolder named by `folderKey`); template create via Drive `files.copy` of the
registered template file (SET-17 registry) into the target folder with the new name —
both plain `auth/drive` operations, no new scopes. Response: file id, name, and
open-in-Google URL. Writes an `activity_events` row and a
`google_integration_events` `drive.file_created` event; project files are content, not
setup resources — no `workspace_resources` rows. (2) Extend the blueprint template
`kind` enum with `"slides"` (sanitizer + editor dropdown) so Slides templates can be
defined too. (3) UI: "New document" action on the project drawer/dashboard — type
picker, template picker fed from the blueprint GET, name field, success link.
`app/FloorOpsApp.tsx` is the single-file queue: the UI half waits for KPI-02/#52 to
release the slot; the route + tests are buildable before that. Simulation parity
(fixture file IDs and links, same events).
**Accept:** route tests — office non-admin allowed, cross-origin 403, unprovisioned
project 409 with guidance, blank create for all three kinds, template copy request
shape pinned (`files.copy` parent + name), invalid kind/name/template 400s, simulation
branch, audit rows; blueprint sanitizer accepts `"slides"`; the never-delete suite's
scope extends over this module (zero deletion calls); simulation e2e: provision →
create blank Sheet + create from template → links rendered; existing provisioning and
filing tests untouched.
**Effort:** medium. **Depends:** SET-15 (effective config for the blank-only path),
SET-17 (templates), KPI-02/#52 merged for the `FloorOpsApp.tsx` slot.

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
Administrator-only at rollout** per `docs/administration-and-access-plan.md` (PR #41
wires the gate directly through SET-02's authenticated `isAdmin`); (4) schema changes are
additive-only and follow
`docs/development-d1-schema-migrations.md` (D1) and the append-only checksummed registry
(PostgreSQL); (5) no cost/margin capture, no external review data, no scheduling
dependencies — see the exclusions in KPI-01's definitions doc.

### KPI-01 · Tier-1 KPI report from existing data + definitions doc (medium, after the FloorOpsApp queue clears — no schema change)
**Status:** Complete — PR #41, July 19, 2026. Source-only and not deployed.

SET-02 is merged in PR #37, so the implementation gates every dollar-value KPI directly
with its authenticated `isAdmin` flag. Full builds, 350/350 runnable Node tests, lint,
and 2/2 focused desktop/mobile Playwright checks passed; no schema, migration, or hosted
configuration changed.

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
panel/stat conventions, and each dollar KPI marked with the admin-only note (gated via
`isAdmin` from SET-02). Extract the formulas into a pure helper module
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
**Deps:** Satisfied by merged PRs #34 and #37. One FloorOpsApp packet at a time. Effort:
medium.

### KPI-02 · Tier-2 minimal inputs: flooring category, square feet, contract value (medium, after KPI-01)
**Status:** In review — draft PR #52 from `codex/kpi02-flooring-inputs`, July 20, 2026. Source-only and not merged or deployed.

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

**GitHub baseline:** source is reconciled against `main` at `71f6745` after PRs #54/#55
completed OIDC-02/OIDC-03 in source, PR #60 reconciled OIDC-02, and PR #61 expanded the
Fable follow-up instructions. PRs #51–#53 and #56–#57 remain open drafts. None of these source changes is deployed.
The exact deployed baseline
remains PR #32 at `adc79b855041db04cc3ca2a3eb232bc72408d33b`, private Sites development
version 40, which includes PR #30's semantic Settings rules table. The listed source
packets from PR #33 through PR #61 are undeployed. Delivery PRs mirror items in these ledgers and do
not become a separate task source of truth.

**This document is the status ledger for these three workstreams** (the same pattern as
`docs/design-critique-fix-plan.md` for the UI critique). Rules for every agent packet:

1. Items without a status line remain **Open**. When an agent starts an item, it appends a
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
OIDC-04 is complete in PR #49, with its closure guarded by PR #50. OIDC-02 and OIDC-03
are complete in source in PRs #54/#55. The remaining reviewed merge train consists of
BE-09 (#51), BE-12 (#53), KPI-02 (#52), SET-10 (#56), and the logo refresh (#57).
Those drafts must not be reassigned. The unclaimed independent packets are coordinated BE-07+SET-05, SET-11,
SET-09+WS-10, and WS-13. All are source-only; none authorizes external configuration,
apply, deployment, live login, another user, or real data.

**Chains:** BE-02→BE-03 · BE-06→BE-07→(coordinate SET-05) · BE-04+BE-06→BE-09→BE-10 ·
BE-06→BE-12 · BE-08+BE-09+BE-11→BE-14 · SET-01→SET-02→{SET-03..SET-12} ·
SET-03→SET-10 · SET-04→SET-11 · OIDC-01→OIDC-02→OIDC-03. OIDC-04 was the
documentation/guard reconciliation; it is complete in PRs #49/#50 and does not change
the runtime dependency chain.

**Owner track (sequential):** WS-01 → WS-02 → WS-05 → WS-06 → WS-07 → WS-08 → WS-09(live
half) → WS-11. Agents should never be blocked idle on this track — every agent item above
is schedulable independently.

**Merge-conflict hotspot:** `app/FloorOpsApp.tsx`. Do not run two packets that touch it
concurrently. PR #33 (actionable lists), PR #35 (SET-01), PR #37 (SET-02), and PR #41
(KPI-01) are merged source-only. KPI-02 occupies the slot in draft PR #52; no second
`FloorOpsApp.tsx` packet should start until #52 is resolved. It must preserve the extracted
Settings boundary, shared actionable-list pattern, KPI-01 formulas/gating, and
`InboxRulesPanel`'s semantic `<table>` markup, with the focused regression suites and
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
   `codex/settings-panel-extraction`; SET-02 is complete in PR #37, KPI-01 in PR #41, and
   SET-03/SET-04 in PR #44. All are source-only and undeployed.
4. **Backend/Workspace merge train** — BE-02+BE-13 (#36), BE-04 (#38), WS-04+WS-12
   (#39), BE-05 (#40), BE-06 (#42), BE-08 (#45), BE-03 (#46), BE-11 (#47), and OIDC-01
   (#48) are complete in source. Latest combined-main Node/build/lint, Terraform, and
   Chromium checks are green; nothing was applied, configured, published, or deployed.

**Wave 2 — current:** merge the remaining reviewed drafts in order #51 → #53 → #52 → #56 → #57,
running the complete post-merge flip after each. After shared UI siblings merge, rerun the survivor's focused browser tests.
BE-10/BE-14 wait for #51; KPI-03 waits for #52. The unclaimed parallel-safe tracks are
BE-07+SET-05, SET-11, SET-09+WS-10, WS-13, and design-ledger Phase 4 guardrails before the
broad primitive/CSS consolidation tracks.

**Owner/Brett track (calendar time — start nudging now):** Brett's read-only GCP
inventory + Workspace resource verification (WS-01/WS-02, checklists 01/02) are the only
things gating the live data connection. Jason must review that inventory before any API,
IAM, billing, OAuth, or Admin-console change. The agent packets above proceed without
those inputs; Jason's other open decisions live in checklists 00/06/10.

**FloorOpsApp single-file queue (one packet at a time):** PR #33 (actionable lists) →
SET-01 / PR #35 → SET-02 / PR #37 → KPI-01 / PR #41 are complete in source. The queue is
now KPI-02 → KPI-03, with KPI-02 occupied by draft PR #52 and KPI-03 waiting for its
review and merge. Interleave other SET items only in extracted modules that do not
touch `FloorOpsApp.tsx`. Workstream D's KPI packets are
otherwise independent of the BE/WS tracks (KPI-04 coordinates PostgreSQL migration
version numbers with BE-06).

**Cross-item coordination (implement once):** multi-key token decryption is complete in
BE-08 / PR #45 under WS-04's documented boundary; calendar-ID single authority remains
SET-05 ↔ BE-07; integration events reader remains SET-09 ↔ WS-10;
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
