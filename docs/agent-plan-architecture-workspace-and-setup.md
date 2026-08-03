# Agent execution plan: backend architecture, Google Workspace connection, and Settings/Setup alignment

Date: July 19, 2026 · Status reconciled: July 20, 2026 · Source baseline: `main` @
`599e39f` after PR #57 merged the reviewed application-logo asset refresh.
PR #52 previously completed the KPI-02 flooring booking inputs and reporting packet,
PR #53 completed the BE-12 rehearsal inventory packet, and PR #51 completed the BE-09
production core-record route packet. PRs #63/#64 added the
dashboard-driven Workspace setup workstream, and PR #65 codified the multi-agent
coordination protocol. PRs #54/#55 completed
OIDC-02/OIDC-03; PRs #60/#62 reconciled their merged status; and PR #61 expanded the
Fable follow-up instructions.
PR #66 completed TRK-02 tracking-guard hardening.
PRs #56/#57 are merged source-only and undeployed; the reviewed PR #51–#57 merge
train is complete. This revision adds Workstream E (Google-native integrations,
GI-01…GI-07), SET-23…SET-26, WS-15/WS-16, and the July 21 setup-panel review
amendments. Workstream F (dashboard design, DES-01…DES-09; design authority
`docs/dashboard-design-spec.md`) was added July 22, 2026, and Workstream G (AI
assistant & automation, AI-01…AI-09 with gated Tier-2 stubs; design authority
`docs/ai-assistant-spec.md`) on July 23, 2026.
**Deployment (corrected July 30, 2026 — the previous claim here was eleven days stale and
wrong).** This document previously read *"Deployment baseline: `adc79b8`, private Sites
development version 40 … the later source changes are not deployed."* That line was last
edited **July 19, 2026** and was never updated again, while merges continued for eleven
days. It was quoted as current fact during the July 30 session and was false.

**How deployment actually works:** the owner asks ChatGPT to deploy the private Sites app
from GitHub, and it deploys. It is **owner-triggered and on demand** — there is no GitHub
Actions deployment (`.github/workflows/cloud-run-image.yml` publishes an image only on
manual dispatch and states outright that it does not deploy). So the live site reflects
`main` **as of the owner's most recent deploy request**, not a commit pinned in this file.

**Therefore no commit or version number is recorded here on purpose.** Any such number
rots the moment the next deploy happens and then misleads whoever reads it — which is
exactly what happened.

**THE CANONICAL DEPLOYMENT RECORD IS GITHUB ISSUE #258** —
<https://github.com/OneStreamerNE98/FCI-Brett/issues/258>, "ChatGPT Sites deployment log
(canonical)", created by the owner July 30, 2026. Every deployment is appended there as a
comment with its Eastern and UTC timestamp, the exact source branch and commit SHA, the
Sites version, the result, the live URL, and whether source, hosted configuration,
migrations, or live data changed. **Read the newest entry there to learn what is live.** Do
not infer it from this document, and do not infer it from packet status lines (see the note
on the "undeployed" label below).

For the ordered owner procedure — including the build stamp, issue-comment template, and
on-screen verification — use the
[`deployment runbook`](runbooks/deployment.md). This ledger explains what is true; the
runbook explains what to do.

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
  KPIs & reporting · `GI-*` Google-native integrations · `DES-*` dashboard design ·
  `AI-*` AI assistant & automation · `EDIT-*` record editing (see
  [`# Record editing (EDIT)`](#record-editing-edit)) · `HINT-*` in-app guidance ·
  `OIDC-*` BE-04 post-merge security follow-ups (in
  [`docs/be04-oidc-review-and-followups.md`](be04-oidc-review-and-followups.md)).
  Dependencies are listed per item.

## Global guardrails (include in every packet)

0. **Guide currency (added July 23, 2026).** Any packet touching `app/settings/**`
   or the FloorOpsApp settings surfaces must update `docs/settings-guide.md` or
   state "Guide impact: none" in its Status line on completion.
   **Pinned-prose warning (added July 27, 2026):** parts of the guide (and of the
   rollout guide) are matched by exact pattern in CI — `ai-outbound-guard`,
   `set11-directory-sync`, `set24-employee-login-readiness`,
   `workspace-sync-contracts`, and `task-tracking-docs` all read them. The mandatory
   guide edit is therefore the edit most likely to turn CI red: when it does, search
   those suites for a phrase from your change before assuming a code problem, and
   update the pin and the prose together, deliberately.
1. **Secrets never touch the repo or an agent.** OAuth client secrets, token-encryption
   keys, and passwords go only into ChatGPT Sites runtime environment settings marked as
   secrets (development) or Secret Manager (production). Items that need them are OWNER
   items.
2. **Fail-closed defaults are intentional, not bugs.** Zero-resource Terraform defaults,
   `503 feature_unavailable` provider routes on the Cloud Run image, and
   `cutoverReady:false` in the rehearsal are deliberate. "Fixing" them without the gate
   passing is an unauthorized production change.
3. **PostgreSQL migrations are append-only and checksummed.** `app/platform/postgres/
   production-schema-migrations.ts` locks **every version it defines** with SHA-256
   checksums verified by readiness probes and source-contract tests. Never edit an
   existing migration. To add one, **read that file and append one past its highest
   `version:` — do not trust any number quoted in a document, including this one**, which
   is exactly how this guardrail rotted before (it said "append v7+" for three days after
   v7 shipped). Snapshot for sanity-checking only, July 26, 2026: the high-water mark is
   **v10** (`project_segment`, BE-16 / PR #198), so the next is v11.
   **No migration is applied anywhere — no Cloud SQL instance exists.**
   (Do not read "migrations 4–5 remain unapplied" in the audit doc as implying 1–3 are
   applied; BE-01 fixes that phrasing.)
4. **The D1 drizzle sequence is append-only.** Never drop or alter existing D1 tables; the
   dev environment is the only live environment. To add a migration, **list `drizzle/` and
   append one past the highest-numbered file** — again, read the directory rather than a
   quoted number. Snapshot for sanity-checking only, July 30, 2026: the highest is
   **0022** (`0022_mean_darkhawk.sql`), so the next is 0023. **This number goes stale every
   time a migration lands — the directory is the authority, never this sentence.** The
   previous snapshot here said 0019 and was four migrations behind within four days.
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
7b. **Golden hashes (THE canonical definition — AGENTS.md and the AI spec §10 point here).**
   Two SHA-256 digests in `tests/e2e/page-layouts.spec.ts` freeze the Overview and Reports
   section markup byte-for-byte. `npm run test:e2e` evaluates them against the live DOM;
   **three Node suites additionally pin the digest constants byte-for-byte** —
   `tests/ai04-today-view.test.mjs:529-530`, `tests/fix15-toast-and-folds.test.mjs:141-145`,
   `tests/nfix04-phone-polish.test.mjs:278-287` — so editing a digest also fails `npm test`.
   "Golden hashes untouched" in an Accept line means all of the above pass with the digests
   unchanged. A mismatch is a signal, not a chore: regeneration is a sanctioned,
   diff-reviewed event restricted to packets that explicitly say so (historically DES-05
   and DES-07), and it updates the three pinning suites in the same commit. Never paste a
   new digest in to make a suite pass.
8. Visual/design remediation through PR #30 is included in private Sites development
   version 40 and is tracked in `docs/design-critique-fix-plan.md`. The source-only
   `codex/actionable-lists` Phase 3 slice is complete in PR #33 and is not deployed.
   The source-only `codex/settings-panel-extraction` SET-01 slice is complete in source in PR #35 and is not deployed.
   SET-02 is complete in PR #37, KPI-01 is complete in PR #41, and SET-03/SET-04 are
   complete in PR #44. None is deployed.
   KPI-02 is complete in source in PR #52, remains undeployed, and has released the sole
   `FloorOpsApp.tsx` queue slot to KPI-03. Do not
   re-litigate visuals; coordinate Settings component work with the relevant Phase 3/4
   entries in that ledger.

## What "Source-only and undeployed" means in a packet status

**It is a snapshot of the moment that packet merged, not a live deployment record.** The
phrase appears on **62 `**Status:**` lines** carrying the exact wording "Source-only and
undeployed" (80 carry some Source-only variant; 74 carry "undeployed" or "not deployed" in
any form). An earlier version of this paragraph said "roughly 90", which matched no counting
method — recorded because an unverifiable number in a section about unverifiable numbers is
the wrong kind of irony. Each was written by whoever
merged that packet, and **none of them is ever revisited after a deploy** — there is no
process that goes back and clears them.

So the phrase means *"as of this packet's merge, it had not yet been deployed."* It does
**not** mean the work is absent from the live site today. Deployment is owner-triggered
from GitHub on demand (see the deployment note near the top), so a single deploy silently
makes dozens of these labels obsolete at once, and nothing updates them.

**Do not count these labels to estimate what is unshipped.** During the July 30 session
that was attempted twice, producing "61 undeployed packets" and then "75", both presented
to the owner as fact. The owner then pointed out he could see record editing — merged that
same day — running on the live site. The labels were the wrong instrument; the running app
is the authority. `docs/flooring-kpis.md` carries a similar frozen line ("Source-only and
undeployed · Migration 0012 not applied to Sites", pinned July 21) and is stale for the
same reason.

To answer "is this live?", ask the owner when they last deployed, or look at the app.

## Current state in one page

- **Live today:** Cloudflare Sites/Workers app, D1 database, R2 for
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

### DOC-06 · Deployment procedure runbook (small, no deps)
**Status:** Complete — PR #271, July 31, 2026. Docs-only; no source, schema, or configuration change.

**Why:** Issue #258 is the canonical deployment log and SET-39 exposes build identity in
Settings, but no operator procedure connects the owner-triggered Sites deployment, the
two required build-time values, the chronological issue comment, and the on-screen
verification. Without that connection, the build card can remain honestly unavailable
and the deployment record can drift again.
**Do:** Add a short owner-facing deployment runbook that names the manual ChatGPT Sites
flow, the image-only GitHub workflow boundary, the all-or-nothing build stamp, the complete
issue #258 comment template, and the Settings verification. Index it under operator
runbooks and link it from the deployment note above. Do not automate deployment or issue
updates, and do not copy a current deployment claim into the repository.
**Files:** `docs/runbooks/deployment.md`, `docs/README.md`, this ledger, and focused
source-contract coverage.
**Accept:** the runbook covers the owner trigger, non-deploying workflow, source-verified
build variable pair, issue-comment record, Settings verification, and the merging-is-not-
deploying boundary; the docs index and ledger link it; no actual deployed commit, Sites
version, or current-live claim is introduced; `npm test` and `npm run lint` pass.

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
The immutable D1 history is unchanged; BE-12 classifies the table as
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
`records: excluded (legacy, no migration)` in BE-12's inventory.
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

**Why:** At BE-06 packet start, `leads` (drizzle 0010) and `project_meetings` (0009) were
D1-only with inline SQL and the rehearsal migrated only clients, contacts, projects, and
activity events. PR #53 completed the source-only rehearsal expansion to the v6 lead and
meeting tables.
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
**Status:** Complete — PR #140, July 23, 2026. Source-only and undeployed; production PostgreSQL migrations v7 and v8 remain unapplied. Fable review: zero substantive findings — all eight migration checksums independently recomputed and matched, v1–v6 byte-untouched, D1 extraction byte-equivalent at every former call site, route contracts identical, saved-wins precedence pinned with env as read-only fallback (never written to storage). P3 residuals: registry-row-outranks-saved precedence nuance carried to SET-05 (surface the three-way source in its UI labels); garbled grant-policy comment in least-privilege.sql and the unpinned partial-index qualifier fold into FIX-12; PG-adapter strictness divergence (fail-closed TypeErrors vs D1 normalization) noted for BE-14's degraded-mode contract.

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
**Status:** Complete — PR #51, July 20, 2026. Source-only and not applied, configured, or deployed.

**Why (at packet start):** Cloud Run had no write path for core records —
`production-composition.ts` exposed per-request creation repository factories that no
route used. The same paths existed on both surfaces with different auth/shapes, and the
management UI called `/api/v1/admin/*` paths that 404 on the current worker.
**Do:** Add POST /clients + /projects (+ leads/meetings GET/POST) to the employee router
via the shared use-cases with capability checks, {data} envelope, idempotency. Record the
per-route contract decision in `docs/google-cloud-runtime-foundation.md` (production =
session+CSRF+envelope; bare JSON = development-only). For the dev admin 404s pick and
document one remedy (thin D1-backed `/api/v1/admin/*` compatibility handlers, or feature
detection in the two admin clients). Provider routes still 503.
**Accept:** router tests: authorized create + idempotent replay, denial, scope-filtered
reads, provider 503 assertion; contract section exists.

Merged PR #51 adds the four production creation paths and scoped lead/meeting reads through
portable application use cases. Authenticated mutations require the host-only employee
session and same-origin CSRF; the four core-record creation POSTs additionally require one
bounded `Idempotency-Key` and return the `{data}` envelope. The Sites/D1 routes retain
their existing development response
shapes. The two admin clients now fail locally with `secure_session_not_ready` when the
secure employee-session bootstrap is absent, so the development surface does not request
unsupported `/api/v1/admin/access` or `/api/v1/admin/audit` endpoints. No D1
administration compatibility handlers were added, and provider routes remain `503
feature_unavailable`.

### BE-10 · Rate limiting on both surfaces (medium, after BE-04+BE-09; VERIFIED)
**Status:** Complete — PR #82, July 21, 2026. Source-only and undeployed.

**Why:** No rate limiting exists anywhere (verified). Cost-bearing dev routes: assistant
(OpenAI), uploads (R2), sheets/sync + project drive provisioning (Google quota). The
acceptance checklist requires limits before go-live.
**Do:** Production: per-identity token bucket in a new
`app/platform/google-cloud/request-rate-limit.ts` applied before dispatch (in-memory
per-instance is acceptable at max two instances per CONNECTION-BUDGET.md); 429 +
Retry-After + security-audit event; configurable via production-config, fail-closed
defaults. Dev: light fixed-window per office user on the four cost routes. Document.
**Accept:** threshold tests (429 + audit event); under-threshold byte-identical.

**Implementation record:** [Request rate limiting](request-rate-limiting.md) pins the
two surface contracts, production configuration bounds, audit evidence, and per-instance
deployment limitation.

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
**Status:** Complete — PR #53, July 20, 2026. Source-only and undeployed; the bounded
integration ran only against a disposable GitHub CI
PostgreSQL 16 schema. No approved hosted development/staging rehearsal, production
migration or grant apply, live-data operation, hosted configuration, or deployment has
been executed.

**Why (at packet start):** The cutover requirement to classify EVERY source category as
migrated/transformed/excluded/blocking comes from
`docs/runbooks/google-cloud/migration-cutover-and-recovery.md`, "1. Staging migration
rehearsal" (lines 25–27) — **not** the platform ADR. At that point, `db/schema.ts`
exported 21 tables while the rehearsal covered 4 and was silent on the other 17 plus R2
objects.
**Do:** Add an inventory section to the rehearsal report enumerating every schema-exported
table + R2, each classified with a reason (records: excluded legacy per BE-03;
workspace_simulation_state: excluded dev-only; google_connections: transformed only by a
separately approved production reauthorization, never credential copying; leads/meetings:
migrated into the now-defined v6 tables). Every inventory-only category remains zero-only
and fails before database access; a disposition never authorizes silent data loss.
Derive the table list from `db/schema.ts` so new tables can't escape classification.
Extend the snapshot format (major version bump) to
carry leads/meetings into v6 tables with hash verification. Format v2 must also require
the project keys `flooringCategory`, `squareFeet`, and `contractValue`, preserve those
keys as null in prepared rows and hash evidence, and refuse any non-null value before a
database connection; KPI-04 owns the PostgreSQL columns and activation of those values.
Keep every existing guard
(FCI TEST name rule, 16 MiB/5,000-row caps, `^fci_rehearsal_` schema, refuse production,
exact acknowledgment). `cutoverReady` stays hardcoded false.
**Accept:** inventory covers all 24 current tables (unit test fails on unclassified); extended
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
**Status:** Complete — PR #178, July 24, 2026. Source-only and undeployed. Fable fleet + executed delta verification: typed feature_unavailable/provider_degraded split derived strictly from composition state; the 202 queued ack is Symbol-gated and, per the hardening revision, canonicalized (descriptor-safe, extra fields rejected); drain loop bounded and version-fenced with an empty registry proven a pure no-op; Terraform Job count-gated behind deploy_outbox_drain_job=false with a dedicated narrower drain SA and no scheduler. Provider actions remain uncomposed and nothing activates by default. Open seam items recorded for the future dispatcher-activation packet: per-provider event-key dedupe must be proven at composition, port attemptCount post-increment semantics need documenting, sparse files-array normalization admits a null element, batchSize is deliberately locked to 1.

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

### BE-15 · Atomic settings-blob writes across all workspace_settings writers (small-medium, after BE-07)
**Status:** Complete — PR #181, July 24, 2026. Source-only and undeployed. Fable fleet with execution-grade verification: one shared prepareWorkspaceSettingsMerge primitive feeds a single-statement D1 json_remove+json_patch upsert and a bounded transactional PostgreSQL upsert with strictly equivalent semantics; all four writers (workspace route, assistant features, launch checklist, Chat routing) submit key-scoped patches and zero whole-blob writers remain; key deletion proven end-to-end. Review fix (861c5d0) restored the 64KB limit on the MERGED document atomically in both adapters (byte-accurate guards, typed error, boundary-exact tests). Recorded residuals: null-stripping is stricter than RFC 7396 (latent — no writer emits nulls); same-key sub-writes within one surface remain last-write-wins by the stated top-level-granular contract. Guide impact: none.

**Why:** every `workspace_settings` writer (the workspace route,
assistant-config-sites, launch-checklist-sites) is a blob-granularity
read-modify-write — findById → merge → upsert rewrites the whole
`settings_json`, so two racing saves silently drop one write. Raised
independently by the SET-08 persistence review and the automated PR review
(July 24, 2026). Last-write-wins was accepted per-surface at merge time; the
durable fix belongs in one shared mechanism, not per-route patches.
**Do:** add a version fence (optimistic concurrency) or key-scoped merge to
the `WorkspaceSettingsRepository` port and apply it to ALL writers at once,
including the BE-07 PostgreSQL adapter; add a concurrent-write regression
test proving two racing saves to different top-level settings keys both
survive.
**Accept:** racing saves to different top-level keys both persist; a
stale-version write is rejected or safely merged, never silently dropped;
widen-on-read law preserved; D1 and PostgreSQL behavior identical.
**Effort:** small-medium. **Cost:** $0.

### BE-16 · PostgreSQL parity for the project segment (small, after BE-15 + DES-08 a-T2; filed July 24, 2026)
**Status:** Complete — PR #198, July 25, 2026. Fable fleet clean with executed proof (118 + 131 unit tests green, tsc clean): PostgreSQL migration v10 contiguous with v1–v9 byte-untouched and DDL parity with D1 0019 plus a named two-value CHECK; creation fingerprint includes segment; listProjectsForScope/getProjectForScope carry segment through production reads, closing a-T2's production modal segment-tap 400 end-to-end; rehearsal format v3 fail-closed with segment round-trip; least-privilege keeps segment creation-only. Real-PG integration suites were static-reviewed (CI is that gate). Residual notes (P3, informational): the PG creation-fingerprint kept `version: 1` while its input shape gained segment — bump the marker or note the policy next time the shape changes on a system that could hold live idempotency rows; pre-existing from PR #179, D1's INSERT-time segment derive uses SQLite LOWER(TRIM()) while all other paths use the shared JS helper (Unicode semantics) — flag for a future D1 cleanup packet. Source-only and unapplied; no migration, grant, rehearsal, deployment, or data change occurred.

**Why:** DES-08 a-T2 (PR #179) added the two-value `projects.segment` to D1
only, per the KPI-04 precedent of deferring production PostgreSQL parity to
its own packet; without it, the production repository cannot store or derive
segments and the KPI segment splits have no production data path.
**Do:** register a checksummed production PostgreSQL migration as the next
contiguous version (v10 expected; v1–v9 definitions AND checksums
byte-untouched) adding nullable `projects.segment` with a domain CHECK
byte-equal to the D1 catalog (`commercial`|`residential`); extend the PG
project repository with the segment mapping at D1 parity — explicit choice
stored, widen-on-read deriving from the joined client industry for
null/invalid rows, the private joined field never exposed (mirror the D1
adapter's semantics); update least-privilege grants; deferral docs updated
with dates. **Spec completions (July 24, 2026, per automated review):**
(1) include `segment` in `projectCreationFingerprintInput` so a reused
idempotency key with a changed segment is a DIFFERENT creation, not a dedupe
hit — and verify the D1 creation path's fingerprint/dedupe treats segment
identically (align if not); (2) route segment through the PRODUCTION READ
path — `AuthorizationRepository.listProjectsForScope` and
`getProjectForScope` in `app/adapters/postgres/authorization-repository.ts`
(incl. the derive-on-read client-industry join), not only the project
repository, or Cloud Run list/detail responses never expose it; (3) extend
the rehearsal format for segment PRESERVATION (format-v3 or an amended v2
per the KPI-04 fail-closed activation precedent) — today's exact
`PROJECT_KEYS` rejects the field while omission imports NULL and silently
drops explicit choices; activation stays fail-closed until registered.
**Accept:** v10 contiguous with prior checksums untouched; CHECK byte-equal
to the D1 domain rules; parity proven by the real-PG integration suite
(round-trip incl. derive-on-read and third-value rejection); a fingerprint
test proving segment-changed reuse of an idempotency key creates distinctly;
authorization-repository reads return the segment with derive-on-read
proven; a rehearsal test proving an explicit segment survives
snapshot→import; no runtime path assumes v10 applied (source-only law);
`npm test` green.
**Effort:** small. **Cost:** $0.

---

# Record editing (EDIT)

Filed July 26, 2026 after the owner reported that project fields — and most
fields on every other record — cannot be changed once created. Research
settled it as an **unbuilt gap, not a design boundary**: no repo document
states a read-only or immutability principle, record editing appears under no
"Deliberately omitted" list, and it is documented as missing in eight-plus
docs (`docs/ui-and-product-readiness-review.md:111` carries it as prioritized
step 7; `docs/development-section-audit.md:24` rates projects **Critical**,
leads and clients **High**). KPI-03 says it outright — the audited,
admin-only "Assign to me" drawer action is named an **interim pattern**, not
a policy. The only roadmap owner is row 17 of
`docs/complete-product-and-google-cloud-architecture-audit.md:327`, marked
"Unassigned domain work."

The data layer was built expecting edits that were never wired: every core
production PostgreSQL table already carries `version bigint NOT NULL DEFAULT
1`, clients/projects/leads carry `updated_by`, and `activity_events` is
trigger-enforced append-only
(`app/platform/postgres/production-schema-migrations.ts:170-176`). The series
sits at the tail of Workstream A because EDIT-03 extends exactly that data
layer; the four surface packets follow it so the series stays readable as one
unit.

**Sequence:** EDIT-01 is an independent fix assignable now (EDIT-02 is
retired — Resolved in PR #135; see its status line, which is the dispatch
authority, not this sentence). EDIT-03 is the foundation and gates
EDIT-04…EDIT-07. Order after that
follows the cost of the gap: leads (cheapest — the API already accepts the
fields), projects (largest gap), clients + contacts, tasks UI. **Meetings
editing is deliberately sequenced last and is NOT yet filed** — create
coverage is complete and no update or delete route exists, so a meeting saved
with a wrong date is permanent; it earns its own packet once EDIT-03 has
shipped through at least one surface.

**SETTLED — owner decisions, July 26, 2026.** These were previously recorded here as
"Recommendations" with no decision surface anywhere in the repo, which made EDIT-05 and EDIT-06
unbuildable: EDIT-05 deferred project `status` to a who-may-edit answer that did not exist, and
EDIT-06's Accept criterion cited an archive-only decision that had never been made. Also recorded
as owner-decision rows in
[`task-checklists/06-20-user-operating-model-and-access.md`](task-checklists/06-20-user-operating-model-and-access.md).

1. **Who may edit — everyone edits; money and status are Administrator-only.** Any office user may
   change descriptive fields (names, sites, contacts, next actions, notes). **Administrator-only on
   EDIT:** `contractValue`, `estimatedValue`, and project `status`. The precedent is create's
   `contractValue` gate (`app/api/v1/projects/route.ts:65-67`) — but note the precedent covers only
   that one field: lead create currently **requires** `estimatedValue` from any office creator
   (`app/domain/lead.ts:117`), and project create leaves `estimatedValue` open. This decision gates
   the *edit* path only and deliberately leaves creation behavior unchanged; the asymmetry (an
   office user can set `estimatedValue` at creation but not change it later) is accepted, not an
   oversight.
   **Enforcement caveat every EDIT packet must honor:** with the capability system self-granted
   (EDIT-01), **`isAdmin` is the only authorization primitive that actually works today.**
   "Administrator-only" is therefore real and enforceable now; any finer role distinction is not,
   and no packet may pretend otherwise.
2. **Archive vs delete — archive only; core records are never deleted.** Precisely scoped, because
   the earlier wording here overstated twice: **(a)** `archived` exists today on three of the five
   core enums — clients, leads, projects. **Tasks are `["open","done"]`** (`app/domain/task.ts:4`)
   and **contacts have no status column at all** (`db/schema.ts:47-59`), so applying archive to
   either needs an explicit additive change in its packet, not an assumption. **(b)** "No delete
   endpoint" is true for **core records** (leads, clients, contacts, projects, meetings, tasks) —
   but two *configuration* DELETE routes exist and stay: filing rules
   (`app/api/v1/filing-rules/[ruleId]/route.ts:38-48`, with the matching PostgreSQL grant) and the
   Google connection (`integrations/google/connection/route.ts:15`). Any "no delete endpoint"
   source assertion in an EDIT Accept line must therefore be scoped to core-record routes, not
   repo-wide. The decision itself stands: archive-only for records, preserving the audit trail,
   filed-email links, and project history, matching append-only migrations, the trigger-enforced
   append-only `activity_events`, and SET-18's never-delete reconcile rule.
3. **Conflict UX.** On a 409, show the conflict and let the user re-apply
   rather than auto-merging — `docs/task-checklists/09-frontend-and-multi-
   user-hardening.md:52` asks for exactly this.
4. **Sequencing (owner decision, July 27, 2026): projects before leads.**
   EDIT-05 ships before EDIT-04. The previous cheapest-first order optimized
   for implementation cost; the owner's original report was project fields,
   and `docs/development-section-audit.md` rates projects Critical vs leads
   High. The FloorOpsApp queue appendix carries the full reordered claim
   order.

### EDIT-01 · Lead edit auditing, and recording the authorization gap honestly (small, no deps)
**Status:** Complete — PR #222, July 27, 2026. Source-only and undeployed. All 13 lead fields audited with before→after details via a type-pinned action map (`satisfies Record<keyof ValidatedLeadValues, …>` — a 14th field breaks the compile until audited); audit INSERTs guarded by `WHERE EXISTS (id, updated_at)` so a stale write leaves zero audit rows; the six/one capability split recorded in `docs/authorization-simulation.md`; the no-`creationAuthorizationFor` pin shipped. Bot clean, CI green, orchestrator line-review passed. EDIT-03 upgrades the guard token to `version` (named exception).
**Why:** this packet replaces an earlier EDIT-01 that would have produced security theater.
The original said to wire `AUTHORIZATION_CAPABILITIES.leadsUpdate` into the lead PATCH route "using
the call shape an existing capability-gated route already uses". That instruction was executable —
nine such call sites exist across six routes, including a near-identical PATCH-by-id at
`app/api/v1/tasks/[taskId]/route.ts:32-44` — **but the pattern it points at enforces nothing.**
Every route hard-codes the capability array it then checks:
`creationAuthorizationFor({ actorId, capabilities: [AUTHORIZATION_CAPABILITIES.x] })`, and
`canCreate` merely tests `capabilities.has(x)` on that same set
(`app/application/creation-authorization.ts:25-34`) — **always true by construction**. No route
derives capabilities from the actor's role: `requireOfficeUser` returns only `{ email, isAdmin }`
(`app/lib/workspace-auth.ts:4-7`), and `authorization-policy.ts` reaches the request path only
through the Cloud Run runtime — its five non-test importers are `employee-oidc.ts`,
`employee-request-router.ts`, `app/application/authorization-service.ts`, and the two Postgres
identity/admin-access adapters, and the latter three are themselves consumed only from the Cloud
Run composition, never from `app/api/**` on the Sites transport. Shipping the original would have
closed a security finding on paper while changing nothing, which is worse than leaving the gap
visible.
Two real, independent things remain, and this packet does the first.
**Do (a) — close the audit hole, which needs no identity work.** Lead PATCH accepts 13 fields
(`MUTABLE_KEYS`) but audits only `stage` and `nextAction`
(`app/api/v1/leads/[leadId]/route.ts:57-78`), so changing an email, owner, or estimated value
lands with **no evidence at all**. Write one `activity_events` row per edit with a before→after
detail, following the existing form at `:64` (`${current.stage} → ${values.stage}`) — the only
before/after diff in the codebase. **Atomicity is new work, not existing behavior:** the D1 lead
adapter's activity INSERTs are plain unguarded statements batched with the UPDATE
(`app/adapters/d1/lead-repository.ts:40-51`) — a zero-row UPDATE still commits the INSERTs and
only then reports lead-not-found, so "same batch" alone does NOT stop an audit row outliving a
failed update. Guard each audit INSERT with a `WHERE EXISTS` predicate matching the update's own
row-identity condition — **`id` + `updated_at` today**, since leads have no `version` column
until EDIT-03 adds one (PR #222 implements exactly this shape) — and add a test in which a
stale-`updated_at` PATCH leaves **zero** audit rows.
This packet owns the **lead** audit closure exclusively — EDIT-03 builds the shared
audit/validator pattern for the *other* entities and must not respecify lead fields, with one
named exception: **EDIT-03 upgrades this guard's token from `updated_at` to `version`** in the
same change that adds the column.
**Do (b) — record the authorization gap, do not paper over it.** Add a short subsection to
`docs/authorization-simulation.md` (or the nearest authorization doc) stating plainly, with the
precise split: **six capabilities are handed in self-granted** at the nine route call sites —
`recordsRead` (×3), `leadsCreate`, `tasksUpdate` (×3), `meetingsUpdate`, `createClient`, and
`createProject` — while **`leadsUpdate` is simply unconsumed** (zero call sites; it enforces
nothing for the different reason that nothing checks it). Both facts land in the same place:
`isAdmin` is the only working authorization primitive today, and real enforcement is blocked on
durable identity (owner decision, July 26, 2026 — record it, defer the fix). Do **not** delete the
capability scaffolding and do **not** build roles here.
**Do NOT:** wire `leadsUpdate` into the route. It would pass unconditionally and make the gap
invisible. When durable identity lands, that wiring becomes a one-line change on an
already-audited route.
**Files:** `app/api/v1/leads/[leadId]/route.ts`, `app/ports/lead-repository.ts` (the audit
`action` union), the D1 and PostgreSQL lead adapters, `docs/authorization-simulation.md`, tests.
**Accept:** every one of the 13 mutable fields produces an audit row with a before→after detail;
a failed update writes **no** audit row; `advanceLead` keeps its existing behavior and audit
string byte-identical; the authorization doc records the six/one split (six capabilities
self-granted at nine call sites; `leadsUpdate` unconsumed) and the
`isAdmin`-only reality; a source assertion pins that the lead PATCH route does **not** call
`creationAuthorizationFor`, so nobody re-adds the decorative check believing it enforces
something; `npm test` green.
**Effort:** small. **Cost:** $0.

### EDIT-02 · `phone-call` meeting type PostgreSQL parity (RETIRED — filed on a false premise)
**Status:** Resolved in PR #135, July 23, 2026. The premise was wrong; no work is needed.
**Why it was withdrawn:** this packet claimed the production CHECK omits `phone-call`, citing
`app/platform/postgres/lead-project-meeting-schema.ts:128-130`. That omission is real but
**historical**: it is the v6 baseline `CREATE TABLE`. Migration **v8**
(`app/platform/postgres/task-schema.ts:74-75`, `TASK_SCHEMA_STATEMENTS`, added by commit
`4256a2d` "Build AI-01 task foundation" in **PR #135**) then does
`ALTER TABLE project_meetings DROP CONSTRAINT project_meetings_type_check` and re-adds it
**including `'phone-call'`**. Migrations apply cumulatively and are checksum-immutable, so the
last writer wins and earlier DDL is unpatchable by design — a v11 rewriting the same constraint
would be a no-op.
The packet was also internally incoherent: its **Files** named
`lead-project-meeting-schema.ts` for editing while its **Do** required prior checksums stay
byte-untouched — editing that file changes v6's checksum and throws at validation.
**The lesson, recorded so it is not repeated:** "the constraint omits X" says nothing about the
applied schema in a cumulative migration system. Always follow the chain to the last migration
that touches the constraint, never read a single schema file as the live state.
**Residual worth keeping (small, optional, no deps):** nothing exercises this constraint against
real PostgreSQL. `tests/production-postgres.integration.test.mjs` runs every migration on a live
instance and asserts two other `project_meetings` constraints, but only ever inserts `'client'`
and `'internal'` — never a `phone-call` row, and never an out-of-catalog rejection. The only
existing proofs are a source-regex assertion and a plan-level rehearsal assertion. If refiled,
the scope is **regression coverage only**: insert a `phone-call` meeting on real PG and assert an
out-of-catalog value is rejected. Requires `TEST_POSTGRES_URL`, which is unset locally and set in
CI.

### EDIT-03 · Optimistic concurrency + edit auditing foundation (medium; gates EDIT-04…EDIT-07)
**Status:** Complete — PR #225, July 27, 2026. Source-only and undeployed. PG v11 + D1 0020 additive with all prior checksums byte-untouched; CAS (`WHERE id AND version`, 409 with current version) proven on both adapters for all four entities; guarded audit INSERTs with zero rows on conflict; the EDIT-01 named exception executed exactly (lead guard token upgraded `updated_at`→`version`, nothing respecified); `patch.version` optional with current-version fallback so version-less clients (TodayPanel) keep working while echoing clients get true 409s. Review: 6-lens fleet, 11 raw → 4 confirmed, 7 refuted; P1 CI-red fixture fix + a narrowed test pin restored on-branch by the orchestrator; two P2s dispositioned into EDIT-05/EDIT-06 (recorded in their packet text). Bot silent through the final window.
**Why:** production PostgreSQL updates do `version = version + 1 WHERE id =
$n` — a counter with no guard
(`app/adapters/postgres/lead-repository.ts:346-352`;
`app/adapters/postgres/project-repository.ts:371-377,411-419,466-473`) — and
D1 has no `version` column at all, so two concurrent editors silently
overwrite each other the moment any edit form ships. Auditing has a matching
hole: lead PATCH accepts 13 fields but writes activity rows for stage and
next-action only (`app/api/v1/leads/[leadId]/route.ts:57-78`), so an email or
estimated-value change lands today with no evidence it happened.
**Do:** (1) add `version` to the D1 core tables as an additive drizzle
migration after `drizzle/0019_demonic_lady_vermin.sql`, existing rows
defaulting to 1. (2) Change every core update on BOTH adapters to `WHERE id =
? AND version = ?`, returning a typed 409 carrying the current version when
zero rows change — reuse the proven in-repo pattern rather than inventing
one: `app/adapters/d1/workspace-blueprints.ts:115-144` already implements
`expectedVersion` and states the law, *"A zero-change result is an
optimistic-concurrency conflict, never a retry."* (3) Add one field-update
member to each entity's closed `action` catalog
(`app/ports/project-repository.ts:25,57,79,87` and the client/task ports) and
write exactly one audit row per edit, **guarded so a failed or conflicted
write leaves zero audit rows**. Do not assume the batch gives this: the
existing D1 lead adapter's activity INSERTs are plain unguarded statements
(`app/adapters/d1/lead-repository.ts:40-51`) — a zero-row UPDATE still
commits them — so each audit INSERT needs a `WHERE EXISTS` predicate matching
the update's own row-and-version condition, per adapter, as new work (for the
lead adapter this means upgrading EDIT-01's shipped `updated_at` token to the
new `version` column — the one named exception to "adopts, never respecifies"). Detail
strings follow the only before→after diff in the codebase today
(`app/api/v1/leads/[leadId]/route.ts:64`, `${current.stage} → ${values.stage}`).
**Lead-field audit closure is EDIT-01's scope, not this packet's** — EDIT-03
builds the shared pattern for projects, clients, and tasks, and adopts (never
respecifies) whatever EDIT-01 shipped for leads. (4) Build the partial-update
validators on the one true template, `normalizeTaskPatch`
(`app/domain/task.ts:210-253`): `Object.hasOwn` per field, a `Partial<{...}>`
validated type, a separately exported patch-key list, per-field errors. Leads
currently fake patch semantics by merging over the current row inside the
route — move that into the domain. No UI in this packet.
**Files:** `db/schema.ts`, a new `drizzle/` migration,
`app/platform/postgres/production-schema-migrations.ts`,
`app/adapters/d1/{lead,project,client,task}-repository.ts`,
`app/adapters/postgres/{lead,project,client,task}-repository.ts`,
`app/ports/{lead,project,client}-repository.ts`, `app/domain/lead.ts`,
`app/api/v1/leads/[leadId]/route.ts`,
`app/platform/google-cloud/database-readiness.ts`,
`app/platform/migration/core-record-rehearsal.ts`, tests.
**Accept:** two updates against the same `version` — the second returns 409
with the current version and writes nothing — proven on BOTH adapters,
mirroring the existing blueprint concurrency suite; exactly one
`activity_events` row per successful edit carrying a before→after detail, and
zero audit rows when the write fails or conflicts — proven per adapter with a
stale-version test; lead-field auditing is covered by EDIT-01 and merely
re-verified here, not respecified; the four
project operations and `advanceLead` keep their behavior and audit strings
byte-for-byte; the D1 migration is additive and no runtime path assumes it
applied; golden hashes untouched; `npm test` green.
**Effort:** medium. **Cost:** $0.

### EDIT-04 · Lead editing (small-medium, after EDIT-01 + EDIT-03)
**Status:** Complete — PR #231, July 28, 2026. Source-only and undeployed. Review: 4-lens fleet, 4 confirmed P2 / 0 refuted — create-mode prefill welded open (the AI-10 (f) implement-once contract, now pinned), terminal statuses Lost/Archived pinned, the create-contract change recorded; the pre-existing assistant `owner_email` evidence leak is recorded for a separate orchestrator PR. Guide impact: `docs/settings-guide.md` gains the Editing-a-lead and Editing-a-project sections in this flip. Reusable create/edit `LeadModal` (create mode carries optional prefill — the AI-10 (f) implement-once contract); all 13 lead fields round-trip through changed-key/version-fenced PATCH; Administrator-only estimated-value edits fail before conflict disclosure; scoped saved-value conflict re-apply, office-identity email projection (owner/createdBy filtered; contact email consciously office-visible client data), dashboard refresh, and stable focus fallback are pinned. **Create-contract change, recorded:** `POST /api/v1/leads` now rejects a non-office `ownerEmail` with 400 (previously 201 with an owner that immediately projected as null) — coherent with the projection rule, tested, and disclosed.
**Why:** the lead PATCH route already accepts all 13 fields
(`app/api/v1/leads/[leadId]/route.ts:14`) while the UI sends only `stage`
through `advanceLead` (`app/FloorOpsApp.tsx:948-986`). `nextAction` is
displayed at `app/FloorOpsApp.tsx:1608` and can never be changed; a typo in a
name, email, or address is permanent; a lead cannot be reassigned or marked
`converted`, `lost`, or `archived` by hand.
**Do:** add an edit surface for an existing lead reusing the Add-lead modal's
markup and field validation with values pre-filled — note `LeadModal`
(`app/FloorOpsApp.tsx:1572-1574`) is an **uncontrolled `FormData` form with
no `defaultValue`s** and needs an `initialValues` prop before it can be
pre-filled at all. Submit only changed keys as a partial patch against the
EDIT-03 validator, send the row's `version`, and on 409 show the conflict and
let the user re-apply rather than auto-merging. Leave `advanceLead` exactly
as it is — it stays the fast path for stage moves. Apply the settled
who-may-edit decision above: `estimatedValue` is Administrator-only via
`isAdmin`; every descriptive field is open to office users.
**Files:** `app/FloorOpsApp.tsx` (`LeadModal` — the merge-conflict hotspot;
takes one queue slot), `app/api/v1/leads/[leadId]/route.ts`,
`app/domain/lead.ts`, tests + simulation e2e.
**Accept:** every editable lead field round-trips through the form and
persists; each edit writes exactly one audit row with a before→after detail;
a stale `version` returns 409, changes nothing, and the UI surfaces the
conflict for re-apply; a non-admin's edit of `estimatedValue` returns 403
via `isAdmin` (the only enforceable primitive — see the settled decisions
and EDIT-01) and the field is read-only in the non-admin form, while
descriptive-field edits succeed for any office user; `advanceLead` behavior
and audit strings unchanged; golden
hashes untouched (the form lives in a modal, outside the byte-pinned
dashboard markup); `npm test` green.
**Effort:** small-medium. **Cost:** $0.

### EDIT-05 · Project editing (medium-large, after EDIT-03)
**Status:** Complete — PR #228, July 28, 2026. Source-only and undeployed. All nine project columns editable end-to-end on both adapters with version-fenced CAS and guarded before→after audits; `status`/`contractValue`/`estimatedValue` Administrator-only on edit via `isAdmin`; a project moves planning → installation → completed. D1 creation obtains the canonical version through GET-after-create (the carried EDIT-03 disposition, stated and implemented). Review: 5-lens fleet + a hand-run golden lens after one fleet agent died — golden digests byte-identical, pinning suites untouched, the placeholder pin honestly evolved into the real Edit-project pin. Orchestrator fixes on-branch: the PATCH response now applies the collection GET's manager-disclosure filter (an offboarded manager's email no longer resurfaces through the mutation), and the uncovered no-op branch gained a version-unchanged/zero-audit test. Owning-agent follow-up verified: the 409 body carries `currentValues` scoped to the caller's own patched keys with the admin-only `forbidden` check firing before any conflict is built, so conflict responses cannot leak admin-only or disclosure-filtered values, and the modal shows saved values beside conflicted fields with explicit-overwrite semantics. The archived-client dropdown parity note is recorded as a product-enhancement candidate, not a defect. Bot silent through the final window. Guide impact: none.
**Why:** nine project columns have **no mutation route at all** — `name`,
`status`, `site`, `clientId`, `estimatedValue`, `flooringCategory`,
`squareFeet`, `contractValue`, `segment` — so a project cannot move
`planning` → `installation` → `completed` from anywhere in the product, and
`projects.status.update` is role-mapped with no endpoint behind it. Mutations
today go through a collection-level PATCH with an action discriminator
(`app/api/v1/projects/route.ts:89-135`) exposing four named operations only.
This is the owner's original report and the audit rates it **Critical**.
**Do:** add a NEW per-project route `app/api/v1/projects/[projectId]/route.ts`
— none exists — whose PATCH takes a partial body validated by an
EDIT-03-style patch validator and fenced by `version`. Keep `contractValue`
admin-gated exactly as the create route does
(`app/api/v1/projects/route.ts:65-67`). Per the settled who-may-edit decision,
**`status` and `estimatedValue` are Administrator-only too, enforced via
`isAdmin`** — the only authorization primitive that works today (EDIT-01);
every other project field is open to office users. Leave the four existing collection-level operations
untouched and do NOT re-route them through the new handler, so their audit
strings cannot drift. UI: an edit surface on the project detail view sending
only changed keys, with the 409 conflict shown for re-apply. Meetings editing
is deliberately sequenced last and is not yet filed — add no meeting mutation
here.
**Carried disposition from the EDIT-03 review (PR #225):** D1 creation
responses omit `version` while PG's accepted path includes it
(`app/application/create-project.ts` — the port's `created` outcome carries no
payload). This packet's edit flow must NOT assume the 201 body carries
`version` on D1: either normalize the created-response shape (preferred,
additive) or GET-after-create before opening the edit surface, and say which
in the PR.
**Files:** `app/api/v1/projects/[projectId]/route.ts` (new),
`app/api/v1/projects/route.ts` (behavior unchanged; verify), a new project
patch validator beside `app/domain/project-creation.ts`,
`app/adapters/d1/project-repository.ts`,
`app/adapters/postgres/project-repository.ts`,
`app/ports/project-repository.ts`, `app/FloorOpsApp.tsx`, tests + simulation
e2e.
**Accept:** each of the nine columns is editable end-to-end and persists on
both adapters; `contractValue` returns 403 for a non-admin and is absent from
the non-admin form; `status` and `estimatedValue` likewise return 403 for a
non-admin via `isAdmin` while descriptive fields succeed for any office user;
a stale `version` returns 409 with no write; one audit row per edit with a
before→after detail; the four existing project operations and their audit
strings stay byte-identical; a `planning` → `installation` → `completed` move
is proven in one test; golden hashes untouched; `npm test` green.
**Effort:** medium-large. **Cost:** $0.

### EDIT-06 · Client and contact editing (medium, after EDIT-03)
**Status:** Complete — PR #249, July 30, 2026. Source-only and undeployed; D1 migration 0022 is unapplied.
**Why:** clients have no update endpoint, no edit control, and no domain
update validator, and there is **no contacts route of any kind** — so a
client rename or an address correction is impossible after creation. Three
fields are additionally unreachable even at create time:
`primaryContact.phone`, `primaryContact.role`, and `status: "archived"`.
`docs/development-section-audit.md:24` rates clients **High**.
**Do:** add a per-client PATCH route and a contacts route, both fenced by
`version` and validated by an EDIT-03-style patch validator; make the three
unreachable fields reachable on both the create and the edit path so the two
accept the same shape. Archive is a `status` transition, never a delete — no
**core-record** delete endpoint exists (the filing-rules and Google-connection
DELETE routes are pre-existing configuration deletes; see the settled archive
decision) and none is added here. UI: an edit surface on the client detail
view with the 409 conflict shown for re-apply. Meetings editing remains
deliberately sequenced last and is not yet filed.
**Carried dispositions from the EDIT-03 review (PR #225):** (a) type the
**duplicate outcome on the client update port** before wiring the edit
surface — `normalized_name_key` is UNIQUE on PG and `name` is unique on D1,
but `ClientFieldUpdateRepositoryResult` has no `duplicate` member and update
has no 23505/constraint handling (create does), so a rename-to-existing-name
currently surfaces as an untyped 500; the Accept below gains "renaming to an
existing client name returns a typed 409/duplicate on both adapters, never an
unhandled exception". (b) The D1-vs-PG created-response `version` divergence
recorded under EDIT-05 applies to client creation identically.
**Files:** `app/api/v1/clients/[clientId]/route.ts` (new), a contacts route
(new), `app/domain/client-creation.ts` plus a new client patch validator,
`app/adapters/d1/client-repository.ts`,
`app/adapters/postgres/client-repository.ts`,
`app/ports/client-repository.ts`, `app/FloorOpsApp.tsx`, tests + simulation
e2e.
**Accept:** client fields and primary-contact `phone`/`role` round-trip on
create and on edit; `status: "archived"` is reachable and reversible per the
owner's archive-only decision; a stale `version` returns 409 with no write;
one audit row per edit with a before→after detail; every new route keeps the
`requireOfficeUser` gate ahead of all work (401/403 for non-office callers —
the only enforceable boundary; client fields carry no admin-only gate under
the settled who-may-edit decision); a source assertion proves no
**core-record** delete endpoint was introduced (the filing-rules and Google
connection DELETE routes are pre-existing configuration deletes and stay);
golden hashes untouched; `npm test` green.
**Effort:** medium. **Cost:** $0.
**Residual (recorded in review, PR #249):** migration 0022's unique index on
`normalized_name_key` is **partial** (`WHERE normalized_name_key IS NOT NULL`)
and existing rows are left `NULL`, so it is inert until each row is next
written. For a **pair** of rows created under the old `LOWER(name)` uniqueness
that collapse to one normalized key (`"Acme  Corp"` vs `"Acme Corp"`), the
first row edited claims the shared key and the second then legitimately
reports `duplicate`. That is a real data conflict needing a rename, not the
artificial lock the review fixed — the unconditional pre-scan that made *both*
rows permanently uneditable, including the archive transition this packet
delivers, is gone. A backfill is the proper closure and is not written.
**Structural lesson (binding on later EDIT packets):** the row chip and the
client drawer both read `client.industry`, so no single fallback value could
satisfy `des08a1-industry-surfacing.spec.ts:263` ("Commercial") and
`edit06-client-contact-editing.spec.ts:145` ("Unspecified") at once. Two
successive fixes each satisfied one pin and broke the other. **A display
field with two consumers needs both consumers enumerated before it is
changed** — the same discipline as auditing every call site when a parameter
changes, applied to presentation.

### EDIT-07 · Task management UI (medium, after EDIT-03)
**Status:** Complete — PR #248, July 30, 2026. Source-only and undeployed.
**Why:** both task endpoints are live and validated (`app/api/v1/tasks/
route.ts`, `app/api/v1/tasks/[taskId]/route.ts` behind `normalizeTaskPatch`),
but **no task list, form, or detail view exists anywhere in the product**.
The only reachable mutation is `status: "done"` from the Today panel
(`app/assistant/components/TodayPanel.tsx:286`), so a task completed by
accident can never be reopened. Pure UI against a finished API.
**Do:** build the task list, create form, and detail/edit view against the
existing endpoints, reusing the shared actionable-list pattern rather than
forcing interactive rows into table semantics. Every field
`normalizeTaskPatch` accepts becomes editable, including reopening a `done`
task; send only changed keys plus `version` and show the 409 conflict for
re-apply. Add no new endpoint and no new table — if a field cannot be edited
the gap is in the UI, not the API. Meetings editing stays deliberately last
and unfiled.
**Files:** new task components under `app/assistant/components/`,
`app/assistant/components/TodayPanel.tsx`, `app/FloorOpsApp.tsx`, tests +
simulation e2e.
**Accept:** a task can be created, listed, edited, completed, and
**reopened** from the UI; every `normalizeTaskPatch` field is reachable; a
source assertion proves the task API surface gained no route and no table;
task mutations keep their existing `requireOfficeUser` gate (tasks carry no
admin-only field under the settled who-may-edit decision, so office-level is
the correct and only enforceable boundary); a stale
`version` returns 409 with no write and the UI shows the conflict for
re-apply; one audit row per edit with a before→after detail; the Today
panel's existing complete action keeps its behavior; golden hashes untouched;
`npm test` green.
**Effort:** medium. **Cost:** $0.
**Residual (recorded in review, PR #248) — the task list is bounded and now
says so.** `MAX_TASK_LIST_RESULTS` (200) is a hard server ceiling: a request
above it is rejected (`app/domain/task.ts:304`), so the client cannot fetch
one extra row to detect truncation and a full page is the only available
signal. Three things compound — the panel's default filter carries **no
status**, so completed tasks consume the same budget; and the server orders
`due_date IS NULL, due_date, updated_at DESC` (PostgreSQL: `due_date NULLS
LAST, updated_at DESC, id`), so **undated rows sort after every dated row** and
are the group at risk once the cap is reached. A full page now renders an
honest notice naming both the cap and the ordering. Pagination is **not** built.
**Corrected July 30, 2026 by independent audit (PR #256):** this residual
previously said "a newly created task with no due date is therefore exactly
what goes missing." That overstated it. Within the undated group the secondary
sort is `updated_at DESC`, so the **newest** undated task is retained ahead of
older undated ones; the **oldest** undated tasks fall off first. A brand-new
undated task is only lost when 200 dated tasks consume the entire cap before
the undated group is reached. The shipped notice was correct; the ledger prose
describing it was not.
**Open follow-up worth its own packet (owner decision):** there is **no
`GET /api/v1/tasks/[taskId]`** — only `PATCH`. So the 409 recovery
(`readCurrentTask`) must scan up to four capped lists hunting an exact version
match, which is why recovery can fail at all and why a task beyond the cap can
never be recovered. Adding the by-id read collapses four requests into one and
removes both failure modes. The current dead-end is **deliberate and pinned**
(`tests/e2e/edit07-task-management-ui.spec.ts:402`), so this is an
enhancement, not a defect — but it is the natural EDIT-08, or a rider on
EDIT-03's concurrency foundation.

### EDIT-08 · Read a single task by id (small, after EDIT-07)
**Status:** Complete — PR #265, July 31, 2026. Source-only and undeployed. `GET` was added to the existing `[taskId]` route rather than a new file; auth runs ahead of all work; the four capped-list searches in `readCurrentTask` are gone. The dead-end e2e decision at `edit07-task-management-ui.spec.ts:402` was re-pointed **consciously** to assert successful row-201 recovery and re-apply, as the packet required.
**Filed July 30, 2026 on the owner's decision**, from the EDIT-07 review residual above.
**Why:** `app/api/v1/tasks/[taskId]/route.ts` exports **only `PATCH`**. There is no way to
read one task. Two consequences, both live today: the EDIT-07 conflict recovery
(`readCurrentTask` in `TaskManagementPanel.tsx`) must fetch up to **four capped lists** and
scan them for an exact version match, and a task beyond the 200-row cap can therefore
**never** be recovered from a 409 at all — the editor dead-ends and the user's draft is
unsaveable. A by-id read collapses four requests into one and removes both failure modes.
**Do:** add `export async function GET` to the existing
`app/api/v1/tasks/[taskId]/route.ts` — **no new route file**. Keep the established shape:
`requireOfficeUser` ahead of all work, no-store helpers, 404 for a missing id, and the same
record shape `isTaskManagementRecord` already validates so the client needs no new parser.
Then re-point `readCurrentTask` at it and delete the four-search fallback.
**Deliberately in scope:** the e2e spec
`tests/e2e/edit07-task-management-ui.spec.ts:402` ("a rejected 409 recovery read disables
re-apply and cannot issue a second PATCH") pins the **current** dead-end as intended
behaviour. It must be re-pointed **consciously** and the packet must say so — that spec is a
recorded design decision, not a safety rail, and silently editing it is the failure mode
this ledger keeps warning about.
**Accept:** a 409 on a task outside the first 200 rows recovers and re-applies successfully;
the by-id read is admin/office-gated identically to `PATCH` and returns 401/403 before any
database work; `GET` adds no write keyword to the route; the four-search fallback is gone;
the re-pointed e2e spec asserts successful recovery rather than the dead-end, with the
change explained in the PR; `npm test`, `npm run test:e2e`, `npm run lint` all named with
outcomes.
**Effort:** small. **Cost:** $0.

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

**Staging rehearsal recorded August 3, 2026 — the sequence has been run end to end, on a
different tenant.** The owner worked through WS-01…WS-08 against the `grass.wedding`
Workspace rather than `cherryhillfci.com`, deliberately rehearsing the setup before
committing the production domain. **The packets below stay open, and that is correct:** each
one names `cherryhillfci.com`, and that tenant is still untouched. This paragraph is a
rehearsal record, not a completion claim — read it before concluding from the absent status
lines that nothing has ever been set up.
Evidence, read live from `GET /api/v1/integrations/google/operations` on the deployed site
that day: `runtimeMode=workspace`, `simulation=false`, and 29 recorded events between
2026-08-02T23:49Z and 2026-08-03T09:46Z — `oauth.connected`, `setup.shared_drive_adopted`,
`setup.drive_roots_ensured`, `setup.templates_ensured`, `setup.spreadsheets_ensured`,
`setup.reconcile_run`, `gmail.labels_prepared`, `gmail.test_sent`,
`calendar.workspace_events_listed` ×2, `calendar.workspace_hold_created`,
`sheets.directory.synced` ×7, and `drive.project_folder_provisioned` ×2 (`mode=workspace`),
with zero failed archives.
**One step of the fixed verification order above has never been exercised: the last one,
Gmail filing.** No archive row exists and `driveOperations` is empty, so the single thing
this app does that Gmail cannot — a leased, idempotent, audited copy of an email into one
project's Drive folder — has still only ever run in simulation. WS-08 is open on exactly
that half.
**Moving the rehearsal to production is not a configuration change.** See **WS-19**, which
records what a tenant switch actually costs and why it currently fails silently rather than
closed.

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
**Status:** Complete — PR #253, July 30, 2026. Source-only and undeployed. Shipped the endpoint route (`GET /api/v1/integrations/google/operations`, admin-gated, SELECT-only, connection-scoped, 50 rows per category with a 51st-row `hasMore` probe) rather than the documented-D1-queries alternative, per the packet's "choose one, don't half-do both". Review fixed the empty activity state, which promised "Resetting simulation clears this history." in both runtime modes; it is now gated on `payload.simulation`. **This packet also shipped SET-09's events reader and activity card, so SET-09 was narrowed in the same PR to its genuine residual (opaque-cursor pagination past the first 50) rather than being left claimable against a premise this work made false.**

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
**Status:** Complete — PR #144, July 23, 2026. Docs-only. Opus review: zero findings — all four load-bearing claims verified against source (AES-GCM connection-scoped AAD, revoke-on-delete flow, appProperties re-derivability stamps, deferral paragraphs untouched).

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

### WS-15 · OWNER — Maps Platform billing, restricted API keys, budget alert (small, after WS-02; gates GI-03/GI-04)
**Why:** The adopted Maps integrations (job-site maps, address validation,
autocomplete) use API keys, not the connector OAuth account, and require a billing
account on the Google Cloud project. The owner budget is ≤$50/month; expected actual
usage is ~$0–10/month inside free tiers, and a budget alert enforces the ceiling. See
[Google integration opportunities](../google-integration-opportunities.md) — this file
lives at `docs/`, adjust the relative link if moved.
**Do (owner, guided):** Attach a company-controlled Cloud Billing account to the
verified development project (checklist 02); enable Maps Embed API, Address Validation
API, Places API (New), and (when GI-scheduling work starts) Routes API; create two
restricted keys — a browser key HTTP-referrer-restricted to the app's hostname and a
server key IP/app-restricted; set a Cloud Billing budget with alerts at $10 and $25;
record the non-secret key names (never key values) in the configuration inventory.
**Accept:** both keys exist with their restrictions; budget alerts configured;
checklist-02 rows checked with dates; no key value in the repo or checklists.

### WS-16 · OWNER — Google-native quick wins, no code (small, anytime)
**Why:** Four owner setup clicks deliver weekly value with zero development and zero
new scopes: client self-booking, professional outbound identity, a KPI dashboard, and
app-like installs. Bundled with two supporting confirmations.
**Do (owner, guided — full steps in `docs/task-checklists/11-google-quick-wins.md`):**
(1) Create a Calendar **appointment schedule** on `FCI • Client Appointments` for
site-visit/measurement slots and use its booking link in estimate follow-ups. (2)
Verify the **`ops@` send-as alias** in Gmail so app-sent mail uses the company
identity. (3) Connect **Looker Studio** (free) to the `FCI Operations Directory` sheet
and build the weekly ops dashboard (pipeline by stage, jobs by status, closeout
aging). (4) **Force-install/pin the PWA** for office staff via Chrome Enterprise Core
(free). (5) Create an **`FCI Holidays`** calendar (config-as-calendar for future
scheduling). (6) Confirm the **Workspace edition is Business Standard or higher**
(gates GI-06 Drive Labels and premium booking features).
**Accept:** each checklist-11 row checked with a date; booking link recorded; edition
recorded; no code or configuration change in the app itself.

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

### WS-17 · Google credential severance on employee disable/offboarding (small-medium)
**Status:** Complete — PR #241, July 30, 2026. Source-only and undeployed. An explicit Administrator-only disconnect tombstones the stored refresh credential in place (inline on D1, the credential record on PostgreSQL), keeps the connection row as `revoked` audit history, and requires fresh consent to reconnect; employee disable leaves the shared company connector untouched, pinned explicitly. Review: six-lens security fleet, twenty raw findings, seven fixed on-branch. The load-bearing one: the tombstone was unfenced, and the disconnect itself drives an in-flight refresh failure whose handler rewrote the status away from `revoked` — silently re-opening the credential reuse this packet exists to prevent, as the ordinary outcome under traffic rather than a race. All three state writers are now fenced on `revoked_at IS NULL`, so a tombstoned row is terminal except through a fresh-consent reconnect. Also fixed: a single-shot provider revocation made retryable, because local severance destroys the only copy of the token first and one 429/503 otherwise lost the ability to revoke a live Drive + Gmail + Calendar + Sheets grant forever; and four truthfulness defects, so a severed connection no longer reports an account, granted scopes, a live identity block, a success toast on a failed revocation, or a Disconnect button. Six P3s recorded and deliberately not fixed at this PR size (repeat-disconnect timestamp overwrite, stale audit pre-read, unbatched audit write, PostgreSQL stale rotation evidence, a column grant broader than tombstoning needs, untested DELETE body gate). Disable-triggered revocation stays deferred until connections carry owners — the per-user Gmail track owns that, and the deferral is recorded in the packet body. Guide impact: the settings guide now states the record is kept marked revoked and that an unconfirmed Google revocation warns with the manual remedy; the cutover doc no longer claims deletion.
**Why:** disabling a user never touches their Google credentials: `disableUser`
(`app/adapters/postgres/admin-access-persistence-repository.ts:1100-1167`) revokes sessions
and invitations but no Google token, and the production integration-metadata port has **no
revoke operation at all** (`app/ports/integration-metadata.ts:113-127`). Today, at one shared
connection, an offboarded admin's knowledge of the connected account outlives their access;
under per-user Gmail this becomes each departing employee keeping a live mailbox connection.
Flagged twice by research (July 27) and owned by no packet until now.
**AMENDED July 29, 2026 — owner decision, after Codex correctly refused the original
scope.** The first draft said "call it from `disableUser`" without saying *which*
connections. There is exactly one shared connection today and **no ownership field in
either store**: PostgreSQL `integration_connections.created_by_user_id` and D1
`google_connections.createdBy` both record who *configured* the connection, not who owns
it. Wiring revocation to `disableUser` would therefore take Gmail, Drive, Sheets and
Calendar offline for the whole company the moment the administrator who set Google up is
disabled. **Owner decision: disabling an administrator must NOT revoke the shared company
connector.** Codex proposed adding `owner_type`/`owner_user_id`; declined for now, because
per-user connections are blocked on durable identity (identity is a hosting-supplied header,
`workspace-auth.ts:64`), so ownership columns would be a model nothing can enforce — the
same decorative-authorization trap EDIT-01 exposed. That work belongs to the per-user Gmail
track. Also corrected: D1 stores the refresh token **inline** on the connection row
(`google_connections.refresh_token_ciphertext`), so there is no separate credential row to
delete there — it must be tombstoned in place. `revoked_at` already exists on that row and
the reconnect upsert already clears it (`d1/google-oauth-persistence.ts:110`), so the
fresh-consent transition is half-built.
**Do:** add a revoke operation to the integration-metadata port and both adapters —
tombstone the stored refresh token (in place on D1; the credential record on PostgreSQL) and
mark the connection `revoked`, **never hard-deleting the connection row** so audit history
survives, with the two adapters' observable behaviour identical and pinned in both suites.
Prove the fresh-consent transition on both stores: a revoked connection requires the full
OAuth flow and can never resurrect the old token. Give it a real consumer in the same PR —
an explicit admin **Disconnect Google** action on the existing
`app/api/v1/integrations/google/connection/route.ts` (admin-only, same-origin, bounded,
audited); this packet must not ship a capability with no caller, the mistake SET-06 spent a
whole packet correcting. Where a Google-side revocation endpoint call is appropriate it is
**fire-and-recorded** (an integration event row), never silently assumed. Simulation mode
short-circuits the Google call and still records the event.
**Do NOT:** call revoke from `disableUser`, or add ownership columns. Disable-triggered
revocation is **deferred until connections carry owners**, which is the per-user Gmail
track's job; that deferral is deliberate and recorded here rather than left implicit.
**Files:** `app/ports/integration-metadata.ts`, the D1 and PostgreSQL integration-metadata
adapters, `app/api/v1/integrations/google/connection/route.ts`,
`infrastructure/postgres/least-privilege.sql` (narrow connection/credential/event grants for
this path only — not broad ciphertext access; `tests/postgres-least-privilege-source.test.mjs`
pins the grant lists and must be re-pointed consciously), tests.
**Accept:** revoking leaves zero usable stored credentials for that connection; the
connection row survives with a `revoked` status and an audit event; reconnecting requires a
fresh consent flow and cannot resurrect the old token, pinned on both stores; **disabling an
employee leaves the shared connector untouched** — pin this explicitly, it is the decision
this packet turns on; simulation proves the path with no live Google call;
`npm test` + `npm run test:e2e` + `npm run lint` named with outcomes.
**Effort:** small-medium. **Sequencing:** independent now; **must land no later than the
per-user OAuth connect flow** in the per-user Gmail track.

### WS-18 · Decouple filed-email evidence reads from the connection key (small-medium)
**Status:** Complete — PR #246, July 30, 2026. Source-only and undeployed. Every filed-email read resolves archives by project, with `connection_key` a stored attribute rather than a filter, so a project's filed email is found regardless of which mailbox filed it; the filing write path, its lease and idempotency, and the `(connection_key, gmail_message_id)` uniqueness are untouched, and single-connection evidence output is byte-identical. Review correction, load-bearing: dropping the predicate outright merged the two ENVIRONMENTS as well as connections — simulation filings share the table under their own connection, so live deployments began adopting pretend filings as real evidence and a simulation reset could no longer purge them, because the reset deletes by connection key while the reads no longer cared about one. `app/application/archive-scope.ts` now centralises a scope rather than a key: live reads exclude the simulation connection, simulation reads see only it, so reads stay open across any number of REAL connections — which is what per-user Gmail needs — while the environments never mix. Four over-broad test assertions across three suites were consciously re-pointed: they banned the strings `connection_key`/`connectionKey`/`getGoogleRuntimeConfig` outright, which forbade that isolation, and now pin the actual contract plus a positive assertion that every filed-email read applies the shared scope. Guide impact: none.
**Why:** the first increment of the per-user Gmail track (owner request, July 27–28: each
login sees its own mailbox, additional mailboxes attachable to a login), chosen because it is
useful standalone and is a hard prerequisite for every multi-connection future. Today every
filed-email evidence read is keyed by the global `connectionKey` constant
(`app/application/assistant/project-evidence.ts` filed-archive reads; the `filed_email_records`
assistant tool; the dashboard filed-email count) — correct at one connection, wrong the moment
a second exists, and the kind of coupling that hardens the longer new readers copy it.
**Do:** make every filed-email *read* path resolve archives **by project**, treating
`connection_key` as a stored attribute of each archive row rather than a required filter —
reads return a project's filed emails regardless of which connection filed them, while writes
(the filing route) keep stamping the connection that performed the filing. No schema change:
`gmail_file_archives` already stores the key per row. No behavior change at one connection —
prove it: the evidence output is byte-identical on the current single-connection fixtures.
**Do NOT:** touch the filing write path's lease/idempotency, the composite uniqueness
`(connection_key, gmail_message_id)`, or any Gmail API call; this is a read-side query
refactor only.
**Files:** `app/application/assistant/project-evidence.ts`,
`app/application/assistant/tools.ts` (the `filed_email_records` tool),
`app/application/dashboard-data.ts`, tests.
**Accept:** all filed-email reads are project-keyed with `connection_key` no longer a filter
parameter on any read path (source assertion); evidence output byte-identical on
single-connection fixtures; a two-connection fixture proves a project's archives from two
different keys both appear; the filing write path untouched (diff-scoped assertion);
`npm test` + `npm run test:e2e` + `npm run lint` named with outcomes.
**Effort:** small-medium. **Sequencing:** dispatch **after AI-10 (a+b+c) merges** — both touch
assistant-adjacent read modules; zero `FloorOpsApp.tsx`.

### WS-19 · Tenant cutover — make a Workspace switch survivable (medium)
**Why:** the owner is live on a staging tenant (`grass.wedding`) and intends to move to the
production Cherry Hill Workspace. Today that move **corrupts state silently instead of
failing closed**, because nothing in the database records which tenant a Google identifier
came from. The fail-closed readiness gate at `app/lib/google-oauth.ts:408-432` protects the
*configuration*; nothing protects the *data*.
**The three findings, verified against source August 3, 2026:**
1. **`connection_key` is a mode constant, not a tenant key.** `app/lib/google-oauth.ts:439`
   yields exactly `"google-workspace"` or `"workspace-simulation"`. Both tenants therefore
   share one key, and `google_connections.connection_key` is `UNIQUE` (`db/schema.ts:302`),
   so **two Google connections cannot coexist even briefly** — reconnecting upserts over the
   old row (`app/adapters/d1/google-oauth-persistence.ts:150`).
2. **Around forty columns hold Google-side identifiers that become dangling pointers in
   place.** Drive folder/file ids on `clients` (`db/schema.ts:39-40`), `projects`
   (`:112-113`), `drive_folder_mappings` (`:359-361`), `gmail_file_archives` (`:247-254`) and
   `gmail_file_archive_artifacts` (`:278-279`); spreadsheet ids on `workspace_settings`
   (`:187`), `google_form_lead_intake_watermarks` (`:399`) and `google_form_lead_reviews`
   (`:415`); Gmail message/thread ids on `mail_items` (`:206-207`) and `gmail_file_archives`
   (`:244-245`); and `workspace_resources.external_id` (`:323`). Nothing compares the stored
   `google_subject`/`google_email` (`db/schema.ts:303-304`) against the newly connected
   identity, so no code path can notice the tenant changed underneath it.
3. **The only bulk-clear primitive is locked to simulation and is incomplete anyway.**
   `app/api/v1/integrations/google/simulation/reset/route.ts:15` returns 409 unless
   `config.simulation`, and its batch (`:18-33`) never clears `clients.drive_folder_id`,
   `projects.drive_folder_id`/`drive_url`, or `workspace_settings` — so even unlocked it
   would leave three record surfaces pointing at the discarded tenant.
**Do:** an Administrator-only **"start fresh on a new tenant"** reset that (a) runs in
workspace mode behind a typed confirmation naming the tenant being discarded, (b) extends the
existing batch to the three record surfaces it currently misses, and (c) refuses to run
unless the connection is already disconnected, so the destructive step can never race a live
token. State in the settings guide that a tenant move discards filed-email evidence — that
evidence points at Drive files in a tenant the app will no longer be able to read, so keeping
the rows would preserve the audit trail's appearance and not its substance.
**Deliberately NOT in scope:** a data-preserving migration that re-points identifiers across
tenants. It is far more work, and what it would preserve here is staging test data
(`Project 2`, `Test Project`, `New Proj`), not business history. Running two tenants at once
is a different and much larger packet: it requires making `connection_key` tenant-derived,
which changes four UNIQUE indexes (`db/schema.ts:229,263,405-408,429-433`) and the AES-GCM
AAD binding that ties every stored refresh token to its key — forcing a full reconnect.
**Owner decision:** confirm a tenant move may discard all staging records. **Interim
fallback if unanswered** (following EDIT-04's precedent rather than repeating EDIT-05/06's
unbuildable-without-a-decision trap): build exactly as specified. A typed confirmation naming
the tenant makes the discard the operator's explicit act rather than the packet's assumption,
so this is buildable either way; only the guide wording changes if preservation is later
wanted.
**Files:** `app/api/v1/integrations/google/` (a new sibling route — **not** an edit to the
simulation-reset route, whose simulation-only gate is a safety property worth keeping
intact), `app/settings/components/GoogleWorkspacePanel.tsx`, `docs/settings-guide.md`, tests.
Zero `FloorOpsApp.tsx`.
**Accept:** a reset in workspace mode requires both an explicit typed confirmation and an
already-disconnected connection, and is refused otherwise; it clears every table the
simulation reset clears **plus** the three missed record surfaces, leaving no row holding an
identifier from the discarded tenant (asserted per-table, not in aggregate); the
simulation-mode path keeps its existing behaviour unchanged; connecting a different tenant
afterwards provisions cleanly; the settings guide states the evidence-loss consequence;
`npm test`, `npm run test:e2e`, `npm run lint` all named with outcomes.
**Effort:** medium. **Cost:** $0.

### WS-20 · Attach additional shared mailboxes to the workspace (medium-large)
**Why:** owner request, August 3, 2026 — staff should be able to work shared inboxes
(`ops@`, `info@`, `sales@`) rather than the single connection mailbox, and eventually see
their own mail. **Those are two different features with very different costs, and this packet
is deliberately only the cheap half.**
**The split that makes this buildable:**
- **Attaching a shared or role mailbox needs no new identity work.** It is an ordinary OAuth
  connection created by signing in to that mailbox with credentials the owner already holds.
  Consent is inherent in the mechanism; there is no impersonation and no domain-wide
  delegation anywhere in the design.
- **Per-user mailboxes are blocked on durable identity**, not on Gmail. App identity is a
  hosting-supplied header (`app/lib/workspace-auth.ts:64`), and binding a Google refresh token
  to a header-asserted identity would be a real security defect rather than merely inelegant.
  That stays in the unfiled backlog behind the identity foundation.
**What is already paid for — this is less work than it looks:**
- `google_connections.created_by` is `NOT NULL` (`db/schema.ts:307`), so a login-to-many-
  connections link already exists; the PostgreSQL side has the same via
  `integration_connections.created_by_user_id`.
- `connection_key` is a real column on every Google table, so N mailboxes need **no new
  table**.
- WS-18 already decoupled filed-email reads from the key, and `app/application/archive-scope.ts`
  centralises a scope rather than a key — which is exactly what multi-connection reads need.
- **`users/me` is not a blocker here; it is correct.** Each connection carries its own token,
  so `app/lib/google-gmail.ts:9` resolves to precisely that connection's mailbox. The pin only
  obstructs impersonation, which this design does not use.
**What actually blocks it:**
1. **`connection_key` is a hardcoded mode constant** (`app/lib/google-oauth.ts:439`) and
   `google_connections.connection_key` is `UNIQUE` (`db/schema.ts:302`), so **only one real
   mailbox can exist at a time**. It must become a per-request lookup. This is the bulk of the
   work and it is the *same* blocker WS-19 hits — sequence them together.
2. **Readiness is a global single-account boolean.** `app/lib/google-oauth.ts:420-427` marks
   the config invalid unless `AUTHORIZED_ACCOUNTS` holds exactly one entry equal to
   `INTAKE_MAILBOX`. Listing every shared mailbox there does not enable multi-mailbox — it
   disables Gmail entirely. Readiness must become per-mailbox.
3. **Keys must be synthetic slugs.** The PostgreSQL CHECK is
   `connection_key ~ '^[a-z][a-z0-9_-]{0,127}$'`
   (`app/platform/postgres/google-form-lead-intake-schema.ts:22`), which permits hyphens but
   not `@` or `.`, so an email-shaped key is impossible. Store the address in `google_email`.
4. **Filing must record which mailbox a message came from.** `gmail_file_archives` is unique on
   `(connection_key, gmail_message_id)` (`db/schema.ts:263`) and **Gmail message ids are
   per-mailbox**, so once keys vary this is what keeps the duplicate-filing guard honest
   instead of silently degrading.
5. The Inbox needs a mailbox picker, and all six Gmail routes are currently admin-only — so
   "staff work a shared inbox" also requires deciding whether non-admin office users may reach
   it. Record that decision; do not assume it.
**Owner decision to surface, not to answer here:** the app's only Gmail scope is
`gmail.modify`. Attaching a mailbox therefore confers **send and delete** on it, not read-only
visibility. If shared inboxes are meant to be read-mostly, that needs a narrower scope, and a
scope change forces disconnect/reconnect for every existing connection.
**Deliberately NOT in scope:** domain-wide delegation (forbidden in six documents and two
checklists, and described by Google as bypassing end-user consent); per-user OAuth tokens;
and reading a staff member's personal mailbox without that person signing in — which this
design cannot do at any effort. **That limitation is a feature:** it means the app can never
become a silent surveillance tool through configuration drift.
**Accept:** two real mailboxes are connected simultaneously and both list messages; the Inbox
picker switches between them and the bucket counts follow; filing from either mailbox lands in
the correct project folder and a second filing of the same message from the *other* mailbox is
correctly treated as a distinct message; readiness reports per mailbox rather than one global
boolean; disconnecting one mailbox leaves the other working; every stored key matches the
PostgreSQL CHECK pattern; the settings guide states the `gmail.modify` consequence;
`npm test`, `npm run test:e2e`, `npm run lint` all named with outcomes.
**Sequencing:** after **WS-19** — both rewrite what `connection_key` means, and doing them in
either order separately would rewrite the same 191 references twice.
**Effort:** medium-large. **Cost:** $0.

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
**Status:** Complete — PR #279, August 3, 2026. Source-only and undeployed. Review fleet (45 agents) confirmed five findings; three fixed on-branch. The load-bearing one: a verified calendar writes a `workspace_resources` row that outranks the saved value, so the panel's "In use (saved setting)" was false and a later Save was inert — the opposite of this packet's own goal. The payload now returns the resolved `externalId` and the panel names the calendar actually in force. Two residuals recorded in the packet body (no lease/audit event on adoption; save remounts the form).

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
**Review residuals (Opus fleet, August 3, 2026 — 45 agents, 15 findings triaged, 5 confirmed;
three fixed on-branch, two deliberately deferred and recorded here rather than silently
dropped):**
- **Fixed:** the panel reported `In use (saved setting)` for an *adopted* calendar, which
  outranks the saved value — so a later Save looked applied and was inert. The resolver maps
  both states to `source: "app"`, so the payload now also returns the resolved `externalId`
  and the panel names the calendar actually in force when it differs from the field. Verify no
  longer lets the field snap back to a different id than runtime uses, and the simulation
  toast no longer claims it saved anything when it persists nothing.
- **Deferred — no lease and no audit event on adoption.** The registry write in
  `calendar/verify` takes no setup lease and emits no `setup.calendar_verified` integration
  event, so an adoption that silently redirects every appointment write leaves no audit row
  beside the drive/gmail/sheets adoptions. The D1 upsert's `DO UPDATE` list also omits
  `created_by`, so re-verifying does not re-attribute. Sized as its own packet: adding a lease
  and an event touches the shared setup-engine invariants this packet does not otherwise open.
- **Deferred — save/verify remounts the whole settings form.** `loadWorkspaceSettings(true)`
  after a successful write swaps the panel for its loading notice and back, losing focus and
  scroll on every save in both Calendar and Workflow modes; a failed post-save reload also
  renders the `role="alert"` "could not be loaded" notice beside the success toast. Pre-existing
  pattern, cosmetic, and shared with the Workflow mode — belongs with a panel-wide fix.

### SET-06 · Truthful labels for persisted-but-inert settings and review-first rules (small, after SET-01; AMENDED July 23, 2026 — absorbs holistic-review FIX-14 + FIX-16)
**Status:** Complete — PR #163, July 24, 2026. Source-only and undeployed. Opus review clean: the H-3 reminder-hours split verified (new clientReminderHours key, widen-on-read proven, independent round-trips e2e-pinned), H-7 inert custom rules render "Saved — not yet applied" with built-ins byte-identical, Planned badges honest. P3 note (July 24): an unrelated local-font console-error filter rode along in the e2e — harmless, recorded.

**Why:** Reminder hours and office-notification email save but nothing consumes them;
custom filing rules are forced review-first, admitted only in a footnote. The July
23–24 holistic review (docs/full-review-2026-07-24-findings.md) confirmed two
adjacent defects in the same truthful-labels territory, folded in here by owner
decision: (H-3) "Appointment reminder hours" and "Client reminder hours" both bind
to the SAME stored value (`settings.appointmentReminderHours` at
WorkspaceDefaultsPanel.tsx:146 and :170) — editing one silently changes the other;
(H-7) custom filing rules are inert (`getFilingRuleMatcher` returns null for
non-built-ins) yet render with active-looking Action badges, priority rank, and
"Enabled".
**Do:** "Planned" FeatureStateBadge + one sentence ("Saved for the upcoming reminder
worker — nothing sends yet") on the inert fields (still editable/persisted); per-rule
"Review-first" pill on custom rules with tooltip; drop the now-duplicate footnote.
PLUS (H-3) split the shared reminder-hours state so Client reminder hours binds its
own persisted field (additive settings key, widen-on-read; migrate nothing — the
current single value seeds the appointment field only), with a regression test
proving the two fields save independently; PLUS (H-7) render custom rules with an
honest inert state ("Saved — not yet applied" chip in place of the active Action
badge) until a real matcher consumes them.
**Accept:** labels render; saves unchanged; rendered tests updated; the two
reminder-hours fields round-trip independently (regression test); a custom rule's
row visibly communicates it is not driving suggestions (pinned copy).

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
**Status:** Complete — PR #169, July 24, 2026. Source-only and undeployed. Opus fleet clean across route-security, persistence, UI-honesty, and tests lenses: admin-gated PATCH with server-stamped actor/timestamp and client-forged metadata rejected 400; widen-on-read proven in both directions; simulation reset provably never touches workspace_settings. Review fix (b6f98be, July 24, 2026) labels the simulated environment honestly — live rows read Simulated, the summary never counts simulated rows as verified. Residuals recorded in FIX-17; the cross-cutting settings-blob write fence is noted there as a candidate BE packet. Guide impact: updated `docs/settings-guide.md` with the persisted development-checklist contract and the simulated-environment note.

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
**NARROWED July 30, 2026 — WS-10 shipped the events reader, so most of this packet is
already built.** The original text said `google_integration_events` "has no reader anywhere
(verified: no audit route exists)" and planned to build one. That premise is now false:
WS-10 shipped `GET /api/v1/integrations/google/operations` (admin-gated via
`requireOfficeUser(request, { admin: true })`, SELECT-only, connection-scoped, newest-first,
50 rows with a 51st-row `hasMore` probe) plus the "Recent integration activity" card in
`GoogleWorkspacePanel`. The two packets anticipated overlap in the *opposite* direction —
this one claimed to cover "the events half of WS-10" — and it resolved the other way round.
Left unamended, this packet has no status line and therefore stays dispatchable, so the next
agent to read it would rebuild a shipped reader. That is the DOC-02 duplicate-work trap.

**Residual scope — what is genuinely NOT built:**
**Why:** the shipped reader stops at 50 rows per category. It reports `hasMore` honestly but
offers no way to reach page two, so an operator cannot audit beyond the newest 50 events.
**Do:** add opaque-cursor pagination to the existing
`GET /api/v1/integrations/google/operations` — do **not** add a second `/audit` route — and
surface it in the existing card. Confirm whether non-admins should see an explanatory card
with no fetch; the route is admin-only today. No retention/export controls (SET-12
placeholders).
**Accept:** stable pagination past 50 with an opaque cursor; 403 for non-admin unchanged;
route still contains no mutations; the existing card keeps its honest empty state and its
`payload.simulation` gating.

### SET-10 · Connection-health detail card (small, after SET-01+02+03)
**Status:** Complete — PR #56, July 20, 2026. Source-only and undeployed.

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
**Status:** Complete — PR #162, July 24, 2026. Source-only and undeployed. Opus review: zero findings — refresh provably never syncs (call-recording + e2e write-counter), status/error verbatim with the shared mapper, raw-enum guard strengthened. Guide documents refresh-vs-sync, recorded mirror evidence, and Stage 3 fallback setup.

**Why:** Mirror status loads once at app start; the panel has no refresh; the
unconfigured state dead-ends at a panel with no sheet-ID field (it's env-only).
**Do:** "Refresh status" button (office-readable status route; lift the app-start loader
into a shared callable); on unconfigured, name the env var and link to SET-04's
prerequisites table instead of the dead-end button; Sync now stays admin-gated; show
lastSyncedAt/lastError exactly as returned — no derived freshness claims.
With SET-16 complete (PR #88), the unconfigured state points to the Workspace-setup
spreadsheets action instead of naming the env var (env stays documented as fallback).
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
Amendment (decision pinned): when backup/restore is eventually built, the mechanism is
a scheduled app-data export dropped into a `00_Company Admin/Backups` Drive folder
under the existing drive scope — native Google, no new infrastructure; the placeholder
card's sentence may say so.
**Accept:** cards render invariantly; existing safeguards text + install panel unchanged.

### SET-13 · Workspace resource registry + effective-config layer + resources card (large, after completed SET-03+04+10) — FIRST in the dashboard-setup feature
**Status:** Complete — PR #76, July 21, 2026. Source-only and undeployed; migration 0013 has not been applied to Sites.

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
(8) Amendments (July 21 review of the merged panel): the resources card gains
identity-summary rows (connected account ↔ intake-mailbox match, allowed domains,
mode) and copy-exact setup helpers (the OAuth redirect URI, a copyable dotenv template
of missing keys with placeholders, the `openssl rand -base64 32` key command — names
and placeholders only, never values); **mask the displayed connection account**
everywhere it renders (currently printed unmasked in both the health card and Step 1);
relocate the buried Disconnect button to the connection card level; new setup cards
render as siblings of the step list, and the SET-10 health card moves out of Step 1 to
match.
**Accept:** resolver unit matrix (all source×presence combinations, `connectReady`
split, filter-not-rewrite); a pin test proving base `getGoogleRuntimeConfig` output
unchanged on a fixture env; authorize connects with resource IDs absent but still 409s
on missing client ID/secret; resources GET 403 for non-admins and contains no secret
values; migration guard updated; simulation e2e reset round-trip. All existing
`missingDetails`/readiness pins pass unmodified except the authorize-gate cases.
**Effort:** large. **Coordinates:** SET-05 (consumer), SET-09 (card order), BE-07/BE-08
(storage port later).

### SET-14 · Workspace blueprint: model, seed, persistence, structured editor (large, after SET-13)
**Status:** Complete — PR #81, July 21, 2026. Source-only and undeployed;
migration 0015 has not been applied to Sites.

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
Amendments: remove the legacy static `drive-blueprint` card from the panel when the
editor lands (it would duplicate the editor's tree); the blueprint gains an
`FCI Holidays` calendar row (config-as-calendar — the WS-16 owner step creates it, the
blueprint records it for future scheduling consumers).
**Accept:** sanitizer matrix (system-path 400s, bounds, tokens, references); seed ≡
legacy `DRIVE_BLUEPRINT` pin; PUT version-conflict 409; bounded-body rejection; editor
e2e (rename owner folder + add template + locked `05_Correspondence` attempt → Save →
GET reflects version+1); office user sees no editor; reset restores seed.
**Effort:** large.

### SET-15 · Shared Drive adopt/verify + blueprint-driven root folder tree + rename (medium, after SET-14)
**Status:** Complete — PR #84, July 21, 2026. Source-only and undeployed.

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
setup lease `<connectionKey>:setup:drive-roots`. Amendment: rewrite the Step-2
"hosted environment value" on-screen note once the Shared Drive ID becomes
app-managed in this packet (the copy must follow the routes). `POST .../drive/folders/rename`
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
**Status:** Complete — PR #88, July 21, 2026. Source-only and undeployed.

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
Step-5 unconfigured copy points here. Amendment: rewrite the Step-5 provisioning
env-var on-screen note in the same spirit once the sheet ID is app-managed.
Amendment (July 21): blueprint `spreadsheets[]` entries gain a
`role: "system-mirror" | "import" | "reference"` field (sanitizer + editor dropdown;
the system client-directory entry is `system-mirror` and locked). The ensure action
creates/adopts sheets of every role; `import` sheets get their clearly-marked entity
tabs prepared (consumed by SET-25); `reference` sheets are registered for SET-27's
reader. Owner-named future example needing nothing today: a project details/ledger
reference table.
**Accept:** create and adopt branches (mocked); created file carries the identity
`appProperties`; ensure is idempotent; an owner-defined extra spreadsheet in a fixture
blueprint is created without tab preparation; the mirror runs against the app-managed
ID and env fallback is labeled; simulation e2e; existing sheet-sync tests untouched.
**Effort:** medium.

### SET-17 · Templates: blueprint-driven ensure with seed content (medium, after SET-15; parallel with SET-16)
**Status:** Complete — PR #92, July 22, 2026. Source-only and undeployed.

**Why:** Owner starter set: Doc/Sheet templates in a Templates folder, created via Drive
upload-conversion — no new scopes, no Docs API — with the template list owner-definable.
**Do:** `app/lib/workspace-templates.ts`: five seed template bodies (HTML for
`estimate-proposal`, `installation-work-order`, `change-order`,
`pre-install-checklist`; CSV for `project-budget`) rendered with
`business.displayName` and the closed token legend; a minimal titled-shell generator
for owner-added templates (definition lives in the blueprint, content is authored in
Google afterward). Amendment (adopted from the integration research): per-project
document creation from these templates upgrades to real Docs-API merge — `files.copy`
the template, then one `documents.batchUpdate` ReplaceAllText pass for the
`{{token}}` set, verified to work under the existing `drive` scope (enable the Docs
API on the GCP project; no new consent). The HTML-upload path remains only for
creating the seed template files themselves. Extend `GoogleDriveClient` multipart upload so metadata `mimeType`
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
**Status:** Complete — PR #227, July 28, 2026. Source-only and undeployed; every outbound Google call on the reconcile path verified read-only, SET-22's shipped template flows unregressed in the shared files. Review: 6-lens fleet, 8 raw → 7 confirmed P2 / 1 refuted; three test hardenings by the orchestrator (Gmail trash-ENDPOINT deny joined the Drive body rule; the provider census widened from a name list to every `app/lib/workspace-*.ts`; main's blueprint-rename audit pin restored beside the new reconcile-mode pin) and two behavior fixes by the owning agent, verified independently: renamed owner sheets/templates now offer **adopt-into-blueprint** (blueprint-only mutation; the helper throws on system-managed resources and routes through `sanitizeWorkspaceBlueprint`; rename-in-Drive stays folder-only; calendars honestly action-less pending SET-20), and the reconcile card labels simulation results, failing closed when the `simulated` flag is absent. 58/58 on the touched suites; bot silent through the final window. Guide impact: `docs/settings-guide.md` updated.
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
**Status:** Complete — PR #83, July 21, 2026. Source-only and undeployed.

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
Amendments: the card also shows the copy-exact setup helpers (shared with SET-13 —
implement once); retire the four decorative safeguard checkboxes at the panel bottom
(dead controls with no state — their content folds into this card), and reconcile with
the existing prerequisites section rather than adding a second table.
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
through the resolver. Amendment: add the optional Meet-link checkbox
(`conferenceData.createRequest`, existing scope) to hold/event creation in this
packet — a few lines, for virtual pre-qualification consults.
Resources-card calendar rows un-gate from the connection GET's
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

### SET-22 · Create Google files in project folders from the app (medium, after SET-17; KPI-02/#52 UI dependency satisfied)
**Status:** Complete — PR #217 + PR #221, July 27, 2026. Source-only and undeployed; no live Google operation or hosted configuration change. Google Docs API enablement remains an owner gate for live Doc-template merges; no new consent scope. Review record: 6-lens fleet found 11 confirmed P2s → 5 distinct defects (simulation honesty raised to P1); all addressed in #221 plus three orchestrator CI fixes on-branch (stale aria-label pin; accessible-name determinism for the Start-from select; the impossible "(development)" environment tag — `config.environment` is only `workspace|simulation`); one PostgreSQL lock-timeout flake cleared on the single permitted rerun; bot clean on the fix stack, silent on the final window. The sheet-template picker is deliberately limited to Doc templates until Sheets-native token merging exists. Guide impact: none.
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
`app/FloorOpsApp.tsx` is the single-file queue: KPI-02/#52 has released the slot, so the
UI half now waits only for this packet's other dependencies and queue coordination; the
route + tests are buildable before that. Simulation parity
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

### SET-23 · In-app document viewer (medium, after SET-15; UI in the FloorOpsApp queue)
**Why:** Owner request: clicking a document anywhere it is listed (project files,
templates, filed emails) opens it inside the app instead of bouncing to Drive.
**Do:** Viewer modal/panel embedding the Google Drive preview
(`https://drive.google.com/file/d/<id>/preview`) — renders Docs, Sheets, Slides, PDFs,
images, and Office files natively with no new scopes and no file bytes proxied (the
viewer's own Google session provides access via Shared Drive membership). Open-in-Google
and Download fallbacks; a clear guidance state when the preview is blocked (no Google
session or no access); CSP `frame-src` allowance for `https://drive.google.com` only;
simulation mode renders a placeholder preview card. Wire from the project files list
and the template rows (SET-17, merged PR #92).
**Accept:** rendered tests for viewer open/fallback/guidance states driven by mocked
payloads; CSP change pinned by a test; no new scopes (grep); simulation e2e clicks a
simulated file and sees the placeholder; office non-admin can view (viewing is routine
work). **Effort:** medium. **Cost:** $0.

### SET-24 · Employee-login readiness card + read-only policy cards (small, after SET-13; activates fully when login goes live)
**Status:** Complete — PR #158, July 24, 2026. Source-only and undeployed. Opus review clean (base + revision delta; the delta verifier ran the unit suite live, 8/8): presence-not-values proven, session-policy copy verified TRUE against the actual auth constants, invitation count reuses the existing admin-access read. P3 residuals to FIX-12: the bespoke runtime-env Proxy should share one env-presence helper with SET-36's route; the panel passes a hardcoded secureSessionReady=true to readAdminAccessOverview (honest-unavailable on failure, but inconsistent with AdminAccessPage's derived gate).

**Why:** The second OAuth client (employee login) has no setup surface — its config,
invitation state, and activation gate live in docs and the access page; and the fixed
role matrix / session policy invite "why can't I change this?" confusion.
**Do:** (1) Login-readiness card in the setup area: login-client configuration
presence (names only), open-invitation count from the existing access data, and the
owner activation-gate status — presence/absence, never values. (2) Read-only policy
cards using the locked-with-reason pattern: the role matrix
(Administrator/Office/Project Manager/Field link — what each can do) and the session
policy (30-minute idle / 8-hour absolute), each with one sentence on why it is fixed.
**Accept:** rendered tests across unconfigured/partial/ready mocked states; zero new
endpoints beyond one presence read; no secret or env values in markup; non-admin
variant informational only. **Effort:** small. **Cost:** $0.

### SET-25 · First-run data import: clients AND projects (medium-large, after SET-16) — OWNER PRIORITY (July 21)
**Status:** Complete — PR #213, July 26, 2026. Fable fleet (2 lenses + adversarial verify) confirmed the review-first contract by construction: `/confirm` is the only writer (preview builds its repository without the write lease, so any insert throws — zero-write assertion), every preview rowKey embeds a SHA-256 of that row's cells so an edited or swapped source 409s as stale instead of importing unreviewed data, projects provably cannot create clients (the insert selects `FROM clients c WHERE c.id = ?`), ambiguity is surfaced rather than guessed, and idempotency is real (durable-duplicate replay plus SQL NOT EXISTS guards inside the fenced batch). Review fixes on-branch (9f5ed6a): the red CI test was an APP bug — the post-confirm focus handoff used a single `requestAnimationFrame` that fired before React committed the reopen button, dropping keyboard focus to `document.body`; replaced with the `pendingFocusRef` + commit-effect idiom (jsdom/React 19.2.6 repro proved animation-frame → unfocused, commit-effect → focused). Also fixed: the gate notice is now the rendered constant (the acceptance test had asserted a string no user saw), over-long emails and control-character phones raise explicit `*_invalid` issues instead of importing blank, the "irreversible fingerprint" wording is corrected in both the guide and the UI (it is an unsalted SHA-256 of a low-entropy address), and the counts list uses real list semantics. Recorded residual: spreadsheet cells beginning with `=`, `+`, `-`, `@` are stored verbatim — inert today (React escapes on render, the Sheets client writes RAW, no CSV export exists) but must be revisited if a CSV export or a USER_ENTERED Sheets write is ever added. Source-only and undeployed; real-data import remains blocked behind WS-11. Guide impact: `docs/settings-guide.md` updated.

**Why:** Day-one onboarding gap: nothing loads the company's existing client and
project lists when real use begins — without this, launch starts with manual re-entry.
**Do:** Admin-gated, review-first import for BOTH entities, spreadsheet-first (the way
the owner already works): blueprint "import"-role spreadsheets (see the SET-16 role
amendment) provide clearly-marked Clients and Projects import tabs (CSV upload as the
alternative); the app reads via existing Sheets plumbing, presents a preview with
duplicate detection (clients: email/phone/address; projects: name+client+site), and
the admin confirms per-row or in bulk. Projects import AFTER clients and match their
client by code/name/email with an unmatched-review state — never silently creating
clients from project rows.
Imported records get a provenance marker in `activity_events`. Bounded batch size;
re-runnable safely (idempotent on the duplicate check); the import surface hides once
records exist unless explicitly reopened. Respects the test-data boundary: importing
REAL client data remains blocked behind the WS-11 acceptance gate — until then the
importer works on test data and says so.
**Known residual (July 26, 2026):** imported cells beginning with `=`, `+`, `-`, or `@` are stored verbatim — inert today because React escapes on render, the Sheets client writes `RAW`, and no CSV export exists; this MUST be revisited if a CSV export or a `USER_ENTERED` Sheets write is ever added.
**Accept:** preview/confirm/duplicate branches tested; idempotent re-run; provenance
rows written; the real-data gate notice asserted; simulation e2e imports a fixture
sheet. **Effort:** medium. **Cost:** $0.

### SET-26 · Project-document search (small-medium, after SET-15; UI in the FloorOpsApp queue)
**Why:** Daily-use glue: "find the change order for this project" from inside the app.
**Do:** Search box on the project files panel: Drive `files.list` with
`fullText contains '<query>'` scoped to the project's provisioned folder (and
`driveId`), existing `auth/drive` scope, server-side route (admin not required —
routine work) with bounded query length and result count; results open in the SET-23
viewer. Simulation searches the simulated registry/fixtures. Build the search as a
reusable server-side service: AI-03 registers it as the assistant's `drive_search`
tool once it exists (cross-reference recorded in both packets — build once).
**Accept:** route tests (scoping to the project folder asserted in the request shape,
bounded inputs, non-project files never returned in mocks); e2e simulated search →
viewer open; no new scopes. **Effort:** small-medium. **Cost:** $0.

### SET-27 · Reference-spreadsheet framework (medium, after SET-16)
**Why:** Owner requirement: a way to set up additional spreadsheets as reference
tables the app can read later (owner-named example: a project details/ledger table) —
the mechanism now, consumers when features need them.
**Do:** For blueprint spreadsheets with `role: "reference"` (created/adopted by
SET-16's ensure): a bounded generic reader — first row = headers, values typed as
strings, row/column caps, full-tab reads via existing Sheets plumbing — exposed as an
internal port plus one admin `GET /api/v1/integrations/google/sheets/reference/<key>`
endpoint (bounded, `no-store`); a Settings list card showing registered reference
sheets with Open links and an honest "No app feature reads this yet — available to
future packets" badge per unconsumed sheet. No write path to reference sheets ever
(they are owner-maintained). Simulation fixtures per registered key.
**Accept:** reader bounds and header typing tested; unknown key 404; zero write calls
to reference sheets (call-recording suite extended); the card renders the registry
truthfully; simulation e2e registers and reads a fixture reference sheet.
**Effort:** medium. **Cost:** $0.

### SET-28 · End-user settings foundation: "My settings" (medium, after SET-13; full value after live login)
**Status:** Complete — PR #87, July 21, 2026. Source-only and undeployed; migration 0016 has not been applied to Sites.

**Why:** Owner requirement: the setup surface must serve two audiences — initial/admin
organization setup, and each end user's own settings — so employee rollout does not
funnel everyone through admin screens.
**Do:** Split the Settings IA into "Workspace & company setup" (the existing
admin/office surface; slugs unchanged per SET-07) and a new per-user "My settings"
section: profile display (name as shown, from the session identity), per-user
notification preferences (consumed by GI-02's notifier when both land — until then
rendered with the honest "Planned" badge pattern), and per-user defaults (e.g.,
landing view) only where a consumer exists. Per-user rows persist keyed by the
employee identity (works for the single dev user now; scales with live login).
Server-side: users write only their own rows; admin gates untouched (UI gating is
honesty, not security).
Any future packet that grows the notification catalog MUST widen-on-read by merging
missing or unknown keys against defaults, or ship a data migration; the current
all-or-nothing normalizer would otherwise silently reset saved preferences.
**Accept:** own-rows-only enforced in route tests; unconsumed preferences carry
Planned badges (render-invariance test); non-admin users see My settings but no admin
cards; simulation e2e edits and persists a preference; SET-07 slug pins unchanged.
**Effort:** medium. **Cost:** $0.

### SET-29 · Workspace settings stage shell: status banner + four collapsible stages + InfoHint (medium-large; R2 — after the full-review R1 fix packets)
**Status:** Complete — PR #115, July 22, 2026. Source-only and undeployed. Two
review residuals fold into SET-30 (same file): the banner mode chip needs a
neutral loading/unavailable state (it currently asserts a mode before sources
answer), and the InfoHint trigger needs a ≥44px hit area at 390px.
**Why:** Owner-approved redesign (July 21, 2026): the Google Workspace section is a
nine-piece single-column scroll that restates the same mode/connection state nine
times from three independently loaded endpoints (full-review UI-honesty lens, P2, at
`58e4498`). Design authority: `docs/settings-redesign-spec.md` + the approved
`docs/settings-redesign-wireframe.html`.
**Do:** In `GoogleWorkspacePanel.tsx`, add the single status banner (mode chip +
plain-words headline with the next step + "Stage N of 4"), the reusable `SetupStage`
collapsible shell (auto-collapse complete stages, auto-expand the first incomplete
one), and the reusable `InfoHint` ⓘ primitive (hover/focus tooltip, tap-to-reveal at
390 px, `aria-describedby`, never env values) per spec §3.1/§4. Slot the EXISTING
cards into the four stages unchanged (checklist→1, connect step→2,
blueprint+resources→3, Gmail/Calendar/Sheets steps→4; connection-health card stays
temporarily in stage 2). Remove the old mode card — the banner replaces it. No API,
server, or behavior change.
**Accept:** banner is the only mode/connection readout it introduces (old mode-card
strings no longer render — render-invariance test); stage auto-collapse/expand
asserted; InfoHint keyboard/touch accessibility asserted; every existing
workspace-setup-stepper e2e behavior keeps an equivalent assertion against the new
frame (mutation-sensitive updates, no coverage deletions); SET-07 slug pins unchanged.
**Effort:** medium-large. **Cost:** $0.

### SET-30 · Stage 1 "Prepare the tenant" interior (small-medium, after SET-29)
**Status:** Complete — PR #122, July 22, 2026. Source-only and undeployed. Three
review residuals fold into SET-31 (same file zone): gate Stage-1 simulation
rendering on readiness simulation instead of bannerSimulation (kills the
live-mode flicker in simulation); refresh the stale
WorkspaceDomainChecklistCard.module.css.d.ts (add done/missing, drop removed
keys) and remove the now-unconsumed workspaceDomainChecklistSummary export;
give the per-stage chips a neutral pre-load state like the banner's.
**Why:** Hosting/env guidance is interleaved mid-flow in today's steps; tenant
preparation is Brett's outside-the-app lane and must read as one checklist
(spec §3.2).
**Do:** Move into Stage 1, in order: the domain/tenant checklist rows (DONE/MISSING
with one InfoHint per row), the hosted-configuration prerequisites (names only,
never values), and the copy-exact helpers with the Step-2/Step-5 env-var notes
relocated here. Stage completes at `connectReady`; chip shows "x of y".
**Accept:** copy-helper contents byte-identical to today's (existing assertions
retargeted); env-note text no longer renders inside Stages 2-4; completion flips
exactly at `connectReady`; checklist behavior tests stay green.
**Effort:** small-medium. **Cost:** $0.

### SET-31 · Stage 2 "Connect" with health as an expander (small, after SET-30)
**Status:** Complete — PR #125, July 23, 2026. Source-only and undeployed. Review
residuals: ~15 lines of now-dead Stage-2 global CSS (.workspace-connection card
rules and kin) fold into the next packet holding the globals.css lock; the
"Connection health" title inside the summary is a strong, not a heading
(deliberate details/summary tradeoff) — revisit if screen-reader nav feedback
warrants; mixed-mode Stage-1 rendering now follows readiness simulation by
design with completion still fail-closed.

**Why:** Connection health is connection detail, not a separate bottom card; the
Resources/Health near-duplicate tables are a verified P2 (spec §3.3).
**Do:** Stage 2 holds the connect/reconnect/disconnect actions and, in simulation
mode, the simulation reset with the "runs locally, nothing sent to Google"
explanation. Fold the bottom connection-health card into an expander inside Stage 2
(account, granted-vs-enabled services, reauthorization warnings). Delete the
standalone health card; its Mode/Status rows do not migrate (banner owns them).
**Accept:** health details render only inside the expander; the deleted card's
non-duplicate content (account, services, reauth warnings) all present; disconnect/
reauthorization flows keep their existing e2e coverage against the new location.
**Effort:** small. **Cost:** $0.

### SET-32 · Stage 3 unified define-and-create surface (medium, after SET-31)
**Status:** Complete — PR #129, July 23, 2026. Source-only and undeployed. Review
residuals fold into SET-33/SET-34 (same file zone): treat an empty owner-defined
resource group (e.g. zero templates) as vacuously complete so Stage 3 cannot
deadlock; give locked-row captions an aria association and name the actual unmet
dependency in degraded states; avoid the definite "VERIFY" chip when the registry
fetch failed; decide whether the allowed-domains list (dropped with the identity
dl) should re-surface in the Stage-1 checklist. Guard-breadth note for FIX-12:
the typography/control guards scan globals.css only, not module CSS.

**Why:** Blueprint editing and resource creation are one workflow ("decide what
exists, then create it — in order") artificially split across an editor, a table,
and per-row actions today (spec §3.4).
**Do:** Merge the Resources table + `WorkspaceDriveResourceActions` into a
dependency-ordered creation list beside the blueprint editor: Shared Drive
(adopt/verify) → folder tree (ensure-roots) → spreadsheets (directory + owner
extras) → templates → calendars (verify-only until WS-14, labeled). Each row shows
its own state and an InfoHint saying what will be created and where; each row
unlocks the next. Presentation unification ONLY: leases, review-first adoption,
never-delete, idempotency, and simulation parity are untouched server-side.
**Accept:** every setup action reachable today is reachable in the ordered list with
identical request/response behavior (existing route/e2e assertions retargeted); row
gating asserted (a later row is disabled until its dependency reports
created/adopted); stage completion ignores calendar verify-only rows while WS-14 is
pending.
**Effort:** medium. **Cost:** $0.

### SET-33 · Stage 4 "Verify & maintain" (small-medium, after SET-32)
**Status:** Complete — PR #133, July 23, 2026. Source-only and undeployed. Fable-fleet review: zero substantive findings — every verification/upkeep action byte-identical to merge-base endpoints, §3.5.1 copy byte-matched, READY latches derived only from real backend success, all three carried residuals landed with test pins. Review residuals fold into SET-34 (same file zone): thread the Stage-3 aria-describedby dependency pattern into the Stage-4 verification rows' disabled controls (reason spans at ~1080/1104 lack ids); restore an e2e pin for the empty-registry no-prior-data Shared Drive branch ("Adoption controls become available…" lost its assertion in the retarget) and add one for the Sheets row's UNAVAILABLE state; drop the duplicated notification-routing InfoHint body text.

**Why:** First-run service verifications and ongoing upkeep are different activities
mixed together today (spec §3.5).
**Do:** Stage 4 holds Gmail labels + test email, Calendar window/test hold, and
Sheets mirror sync, followed by the ongoing surfaces (drift/reconcile when SET-18
lands, renames, notification routing) labeled "ongoing". The stage chip reads READY
once each service verification has passed at least once; the stage never shows
"complete". Use the shared sheet-status label mapper from the full-review FIX packet
if merged; otherwise reuse the polished FloorOpsApp label map — never render raw
backend enum values.
**Accept:** raw mirror-status enums never render (mutation-sensitive assertion);
existing Gmail/Calendar/Sheets verification e2e coverage retargeted; ongoing items
visually distinct from first-run verifications.
**Effort:** small-medium. **Cost:** $0.

### SET-34 · Redesign cross-cutting sweep: anchors, naming, 390 px, duplicate-status audit (small, after SET-33)
**Status:** Complete — PR #138, July 23, 2026. Source-only and undeployed. The redesign series (SET-29…SET-34) is closed. Fable review: full §3.6 contract verified incl. all four SET-33 residuals; the FloorOpsApp collision with FIX-07 was fused in a reviewed manual merge (isAdmin gate + My-settings rename both preserved, full suite green). P3 residuals fold into FIX-12: the hash-targeted stage re-forces open and re-scrolls on its own completion transitions (scroll hijack on the anchored stage); the mode/connection invariance test is a source-text approximation rather than a render-derived whitelist; dead props retained on TestingLaunchPanel (`onGoogleSetup` voided) and DirectorySyncPanel (`onConfigure` required but unused).

**Why:** Close out spec §3.6: deep links should land on the relevant stage, the
non-admin nav/section naming mismatch confuses users, and the single-status rule
needs a final enforcement pass.
**Do:** Add per-stage URL anchors (`#workspace-stage-1`…`4`) with the SET-07 section
slug unchanged; retarget the Client Directory "Configure" and Testing & launch
bounce-links to their stage anchors; unify the non-admin nav label and section name
to "My settings" everywhere; verify 390 px behavior per stage (banner wraps, hints
tap-to-reveal); sweep the panel for any remaining mode/connection restatement
outside the banner and stage chips and remove it.
**Accept:** anchor navigation e2e (deep link opens the right stage expanded); SET-07
slug pins byte-identical; one name for the non-admin section in nav and switch;
a render-invariance test asserts the banner and stage chips are the only
mode/connection readouts in the panel.
**Effort:** small. **Cost:** $0.

### SET-35 · Per-user page layouts: Overview & Reports reorder + show/hide (medium, after SET-28 and FIX-05; FloorOpsApp queue) — OWNER PRIORITY (July 22)
**Status:** Complete — PR #107, July 22, 2026. Source-only and undeployed;
migration 0017 has not been applied to Sites.

**Why:** Owner requirement (July 22, 2026, scope confirmed): each user personalizes
their own Overview and Reports pages — reorder sections and show/hide them — with a
deliberately simple UI. One shared mechanism for both pages; per-user, riding the
SET-28 My-settings foundation.
**Do:** (1) Data: extend `user_preferences` with a `page_layouts_json` column via an
additive D1 migration (number assigned at merge time per the migration rule); shape
`{ overview: { order: string[], hidden: string[] }, reports: {...} }`. Follow
SET-28's widen-on-read law: missing/unknown keys merge against defaults — never
reset saved preferences; unknown section keys are dropped on read and rejected on
write against a closed per-page section catalog pinned in ONE shared module. Server:
extend `/api/v1/settings/me` GET/PATCH (add `pageLayouts` to the closed
PREFERENCE_KEYS set; existing bounded body and own-rows enforcement unchanged).
(2) UI: an "Edit layout" button on each page. Edit mode: drag handle to reorder,
✕ to hide, an "Add section" row listing hidden sections, and "Reset to default";
Done saves. Keyboard path required: per-section Move up/Move down buttons in edit
mode (drag is pointer-only sugar; no new dependency — native pointer/HTML5 DnD).
Scope is reorder + show/hide ONLY — no resizing, no free-form grid, no widget
gallery. (3) Honesty and gating: hiding is per-user presentation only; server-side
authorization is untouched. The section catalog a user sees (including the add-back
list) contains only sections that user can actually view — admin-gated sections
(e.g. dollar-value KPI panels) never appear for non-admins, and layout preferences
never widen access. Section keys map to the existing panel-level components; the
Overview metrics row counts as one section.
**Accept:** mutation-sensitive tests — reorder + hide persist across reload per
user (two users hold different layouts simultaneously; own-rows route tests
extended); reset restores the default order with nothing lost; unknown/stale
section keys in a saved layout are ignored without error (widen-on-read test);
keyboard-only reorder e2e passes; a non-admin's catalog and add-back list exclude
admin-gated sections (render-invariance); the default layout renders byte-identical
to today's pages for a user with no saved layout.
**Effort:** medium. **Cost:** $0. **Sequencing:** touches `FloorOpsApp.tsx` — runs
in the single-file queue AFTER FIX-05 (shared sheet-status label mapper) merges;
parallel-safe with the SET-29 series (no GoogleWorkspacePanel overlap).

### SET-36 · Read-only "Who has access" card in Data & security (small, independent)
**Status:** Complete — PR #157, July 23, 2026. Source-only and undeployed. Opus review clean: display-only proven (mutation-absence grep-guarded), env allowlist exactly the three identifier keys, render-invariance for non-admins incl. zero requests. P3 residual to FIX-17: the display domain-parse skips the gate's leading-@/lowercase normalization (a lone "@" value would suppress the fail-closed warning while the gate denies everyone).

**Why:** Owner request (July 22, 2026): the development gate's office/admin allowlists
live only in hosted configuration, so nothing inside the app shows who is currently
allowed in. A display-only card gives the owner that visibility without creating any
edit surface. Context for maintainers: this card covers the DEVELOPMENT env-gate
only; end-user access management for the Google-login era is already owned by
People & Access (invitations + roles) and supersedes this card once live login
lands — the card must say so.
**Do:** Add a read-only "Who has access" card to the admin-only Data & security
panel showing: the configured `FCI_OFFICE_EMAILS` list, `FCI_OFFICE_DOMAINS` list,
and `FCI_ADMIN_EMAILS` list (names/emails only — these are identifiers, never
secrets, keys, or tokens), an honest fail-closed empty state when unset ("Office
access is not configured — the app denies everyone"), and a plain-words note that
this list is maintained in hosting configuration and that live-login user
management happens in People & Access. Server: a small admin-gated GET (or an
extension of an existing admin settings read) — `requireOfficeUser(admin)`,
`Cache-Control: no-store`, display-only; NO mutation surface of any kind. The card
never renders for non-admins.
**Accept:** non-admin request to the endpoint returns 403 and the card is absent
from a non-admin's rendered settings (render-invariance); displayed values match
the configured environment exactly incl. multi-value lists and the unset
fail-closed state; grep-guard that the new endpoint contains no write/mutation
handler; no-store asserted; the People & Access note text pinned.
**Effort:** small. **Cost:** $0. **Sequencing:** touches `DataSecurityPanel.tsx` +
one small route — independent of the FloorOpsApp queue and the SET-29 series;
assignable anytime.

### SET-37 · Settings & daily-use guide (docs-only; owner-approved July 23, 2026)
**Status:** Complete — PR #150, July 23, 2026. Docs-only; the guide is a living
document under the currency rule below.
**Why:** no user manual existed; the owner wants a non-technical design &
reference document for administrators AND end users, anchored on Settings.
**Do:** publish `docs/settings-guide.md` — Part 1 "Using the app (everyone)" and
Part 2 "Administering the app", written from source truth (on-screen strings
verified), with a currency banner, glossary, and screenshot index (placeholders
fill as captures are curated). Repo doc now; one "Open the guide" link card in
Settings later as a small packet; no in-app viewer. CURRENCY RULE (added to
Global guardrails): any packet touching `app/settings/**` or the FloorOpsApp
settings surfaces must update the guide or state "Guide impact: none" in its
Status line.
**Accept:** guide published; truth pass against source (corrections logged);
tracking guard green.
**Effort:** small (drafting complete at publication). **Cost:** $0.

### SET-38 · Stage 3 declutter: collapsible subsections + border cleanup (owner enhancement, July 24, 2026; NOT prioritized)
**Status:** Complete — PR #190, July 24, 2026. Source-only and undeployed. Opus fleet clean: the subsections byte-reuse the stage-shell aria contract, content proven byte-invariant, the deterministic initial-state rule implemented with manual-choices-win semantics, session-only. Two review fixes recorded: the pre-existing DES-04 chip e2e re-pointed to expand the blueprint subsection first, and the disclosure init gated on the latest status request (workspaceResourcesLoadIdRef) so an OAuth-callback double-load cannot initialize from a stale completion — proven by an out-of-order e2e. Guide impact: `docs/settings-guide.md` documents the Stage 3 disclosure behavior.

**Why:** owner feedback (July 24, 2026): the Settings → Google Workspace →
Stage 3 "Define & create your workspace" area is visually congested, and the
nesting depth produces stacked borders that read messy inside the
subsections.
**Do:** make the Stage 3 subsections individually collapsible, reusing the
existing stage-shell disclosure mechanics (same aria contract) rather than
inventing a second pattern; flatten the nested-border presentation so the
subsection cards read as one organized surface (fewer competing borders,
consistent spacing rhythm) without changing any subsection's content,
actions, or copy. **Initial-state rule (deterministic, added July 24, 2026
per automated review on #175):** subsections render COLLAPSED by default,
each disclosure header carrying that subsection's existing status signal
(chip/summary line) so state stays visible without expanding; on first
render, the FIRST subsection whose status is not complete auto-opens (all
stay collapsed when everything is complete). Manual toggles override for the
session; state is presentation-only (no persistence).
**Accept:** every Stage 3 subsection collapses/expands with keyboard and
screen-reader parity per the existing stage pattern; the e2e asserts the
INITIAL state per the rule above (exactly the first non-complete subsection
open and the rest collapsed; all collapsed when all are complete; header
status visible while collapsed) in addition to manual collapse/expand + axe;
collapsed state is presentation-only; no golden impact (settings surfaces
are not golden-hashed); Guide impact stated per the currency rule.
**Effort:** small-medium. **Cost:** $0.

### SET-39 · Visible build stamp tied to the deployed commit (small, no deps)
**Status:** Complete — PR #263, July 31, 2026. Source-only and undeployed. The value is baked at build time via `build/build-information.mjs` and `vite.config.ts` — **not a checked-in constant**, which was the point: a constant can be edited into a lie the way this file's own deployment line was. **The card stays blank until a deploy supplies BOTH `FCI_BUILD_COMMIT_SHA` and `FCI_BUILD_TIMESTAMP`**; missing either renders `Build identifier unavailable` rather than a plausible fake. Recording that pairing in a runbook is DOC-06.
**Guide impact:** None — the read-only build label does not change any owner setup or acceptance step.
**Filed July 30, 2026 on the owner's decision.**
**Why:** the app displays **no version or build identifier anywhere**, and until the owner
created the canonical deployment log (GitHub issue #258) there was no record of what was
live at all. The cost of that was concrete and recent: this file carried
`Deployment baseline: adc79b8 … version 40` from **July 19** through eleven days of merges,
an agent quoted it to the owner as current fact, and produced two different wrong counts of
"undeployed" work ("61", then "75") before the owner said he could see that day's merges
running on the live site. Issue #258 fixes the *record*; it does not make the answer
readable from the screen. Anyone looking at the app still cannot tell which commit they are
looking at, which is exactly how a stale claim went unchallenged for eleven days.
**Do:** surface the deployed commit SHA (short form) and build time in the UI, in one
low-traffic place — the natural home is the Settings → Data & security or Testing & launch
area beside the existing read-only cards, **not** the top bar or any dashboard surface
(golden hashes, and no new nav). Source it from the build rather than a hand-maintained
constant: a build-time environment value baked at compile time, so it **cannot** be edited
into a lie the way the ledger line was. Render it as plain text with a copy affordance so it
can be pasted into an issue #258 entry. If the value is absent (local dev), say so honestly
— `Build identifier unavailable` — rather than printing a placeholder that reads like a
real SHA.
**Deliberately excluded:** no update-checking, no "new version available" prompt, no
telemetry, no phoning home. This is a label, not a mechanism.
**Accept:** the deployed short SHA and build time render in exactly one Settings location
and match the commit recorded in the newest issue #258 entry; the value comes from the
build, not from a checked-in constant; a missing value renders an honest unavailable state
rather than a fake one; no new nav item, page, or Settings section; **golden hashes
untouched** (this must not touch Overview or Reports markup); `npm test`,
`npm run test:e2e`, `npm run lint` all named with outcomes.
**Effort:** small. **Cost:** $0.

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
(non-financial). Document honestly that status-change time is approximated by `updatedAt`
(and improved by `activity_events` where loaded), and project
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
**Status:** Complete — PR #52, July 20, 2026. Source-only and undeployed; migration 0012 has not been applied to Sites.

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
**Status:** Complete — PR #75, July 21, 2026. Source-only and undeployed; migration 0014 has not been applied to Sites.

**Why:** Install cycle time and callback rate are the two operations/quality KPIs every
installer tracks — and this franchise's post-installation follow-up walkthrough makes the
callback question a natural existing step. But project editing does not exist yet
(tracked step-7 roadmap work; **superseded July 28, 2026 — EDIT-05 / PR #228 shipped
project editing**, so this Why describes the state when KPI-03 was scoped). The repo
already had the right interim pattern: the audited, admin-only "Assign to me" drawer
action.
**Do:** (1) Additive migration 0014, following merged SET-13 migration 0013:
`installation_started_at` (ms),
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
**Files:** `db/schema.ts`, `drizzle/`, `app/api/v1/projects/route.ts` (extend
the existing audited-action PATCH surface), `app/FloorOpsApp.tsx` (drawer),
`docs/flooring-kpis.md`, `tests/`.
**Accept:** both actions are admin-gated server-side and append activity events; invalid
date order fails closed; KPIs compute from the new fields with pinned fallbacks; full
suites pass.
**Deps:** KPI-02. Effort: medium.

### KPI-04 · PostgreSQL parity and rehearsal coverage for KPI fields (small, after KPI-02/03 + BE-06)
**Status:** Complete — PR #164, July 24, 2026. Source-only and unapplied; production PostgreSQL migration v9 has not been applied. Opus review: zero findings — v9 checksum independently recomputed and matched, v1–v8 byte-untouched, CHECK constraints byte-equal to the D1 domain rules, rehearsal format-v2 expansion activated fail-closed, grants column-scoped and readiness-aligned.

**Why:** Guardrail: the D1 dev schema and the production PostgreSQL boundary must not
drift. The postgres `projects` table (migration v1) predates the KPI columns.
**Do:** Append a new checksummed PostgreSQL migration (next free version after the ones
BE-06/BE-07 claim — coordinate version numbers via the registry, never renumber) adding
the same nullable columns with CHECK constraints (category allowlist, square_feet > 0,
contract_value ≥ 0, completed ≥ started); extend `infrastructure/postgres/
least-privilege.sql` grants and readiness expectations; extend the postgres project
repository row mapping; activate the three already-required nullable BE-12 format-v2
project keys so non-null values are validated, imported, read back, and included in hash
reconciliation. Keep the existing `projects: transformed` inventory classification.
**Files:** `app/platform/postgres/production-schema-migrations.ts` (append only),
`infrastructure/postgres/least-privilege.sql`,
`app/platform/google-cloud/database-readiness.ts`,
`app/adapters/postgres/project-repository.ts`, rehearsal modules per BE-12 (activate the
already-required nullable format-v2 placeholders and import their values), `tests/`.
**Accept:** existing checksums unchanged, new version registered; gated PG16 integration
tests apply and round-trip the columns; rehearsal imports KPI fields with hash
verification; `npm test` passes.
**Deps:** KPI-02 (columns exist), BE-06 (version-number coordination), BE-12 (snapshot
format). Effort: small.

---

# Workstream E — Google-native integrations (GI)

Goal: tighten the app's integration with Google products the company already pays for,
selected from the adopted
[Google integration opportunities](google-integration-opportunities.md) research
(owner budget ≤$50/month; the whole workstream is expected to cost ~$0–10/month
actual). Every packet is source-only, simulation-testable, and owner-gated for any new
scope, API key, or billing attachment. GI packets follow the same guardrails, status
rules, and draft-PR workflow as Workstreams A–D.

### GI-01 · Google Forms lead intake (small, after SET-16)
**Status:** Complete — PR #272, August 1, 2026. Source-only and undeployed; owner Form/linked response Sheet setup remains.

**Why:** A public lead form replaces ad-hoc phone/email capture, feeding the same
pipeline the app already mirrors.
**Do:** Owner creates the lead form in Forms UI (name, address, rooms, flooring type,
preferred contact) linked to a response Sheet; a checklist-11 row records the form and
Sheet IDs. **Trigger corrected July 29, 2026 — the original premise was false.** This
packet said the app would poll "on its existing scheduled Sheets reads"; there are no
scheduled Sheets reads and there is no scheduler at all. `worker/index.ts` exports no
`scheduled` handler and may not (repo law, mechanically enforced by
`tests/ai-outbound-guard.test.mjs`), and the mirror sync is a request-triggered
`POST /api/v1/integrations/google/sheets/sync`. Dispatching against the original text
would have had the implementer either invent a scheduler that violates repo law or
discover mid-build that the machinery it was told to reuse does not exist.
Use the AI-10 precedent instead: read on demand inside a request, bounded, with a durable
watermark. An explicit admin **Check for new form responses** action reads the response
Sheet (existing `spreadsheets` scope, no webhook) with a bounded row budget per call;
processed submissions are keyed by Timestamp plus a content hash. The row ordinal is
only a bounded circular scan cursor, so ordinary Sheet insertion or deletion cannot
decide whether a response was processed. This durable identity — not a timer — makes
repeat reads cheap and idempotent. Rows map to lead records
review-first (new-lead queue, not silent creation). Duplicate handling reuses SET-25's
matcher. Background polling stays deferred to WS-12's Gmail-History work, which is where
the scheduler question is actually owned; when it lands, only the trigger changes and the
mapping, watermark and review queue are untouched.
**Accept:** ingestion tests with fixture response rows (mapping, watermark, duplicate
branch, malformed-row tolerance); review-first queue asserted (no auto-created lead
without confirmation); simulation e2e. **Effort:** small. **Cost:** $0.

### GI-01a · Forms intake follow-up: Cloud Run wiring and dismissal coverage (small, after GI-01)
**Status:** Complete — PR #280, August 3, 2026. Source-only and undeployed. Review clean. The Cloud Run composition no longer constructs an unreachable Forms intake repository; its adapter, schema, migration and grants are retained for a future production-provider packet. All three dismissal cases now execute against the route rather than being asserted by source inspection.

**Why:** The merged GI-01 packet constructed and exposed a PostgreSQL intake repository
from the Cloud Run composition even though the employee router had no Forms route and the
Cloud Run runtime deliberately has no Google Workspace connector/provider adapter. That
half-wiring made production intake look available when no request could create a review.
The successful dismissal route also lacked executing coverage for its connection scope and
one-time transition.

**Do:** Keep Google Forms response checking explicitly scoped to the Sites development
surface until the production Workspace provider and credential boundary is designed and
approved. Remove the unreachable PostgreSQL intake repository from the Cloud Run
composition; retain its adapter, schema, migration, grants, and gated PostgreSQL integration
coverage so a future production-provider packet can compose it deliberately. This is not a
license to add a Cloud Run Google token path, scheduler, webhook, hosted configuration, or
live data. Execute the existing Sites dismissal route against D1 and cover a successful
dismissal, a review owned by a different `connectionKey`, and a second dismissal of the
already-retired row returning `409 form_lead_review_not_retired`.

**Accept:** Cloud Run no longer exposes a constructed-but-unreachable Forms intake
repository, and this Sites-only boundary is explicit. The three dismissal cases are covered
by route execution rather than source inspection; `npm test`, `npm run test:e2e`, and
`npm run lint` pass. No production provider, migration apply, hosted configuration, or live
data change. **Effort:** small.

### GI-02 · Chat webhook notifier + notification-routing settings (medium, independent)
**Status:** Complete — PR #79, July 21, 2026. Source-only and undeployed.

**Why:** One-way pushes into Chat spaces the team already has on their phones — new
lead, filing-review needed, schedule change, warranty follow-up — with deep links back
into the app. No OAuth at all; webhook URLs are per-space secrets.
**Do:** Feature-gated notifier module (off by default, same gating pattern as the
other push capabilities): typed event catalog, cardsV2 payloads with deep links,
retry-once-then-log delivery, never blocking the triggering request. Owner provisions
webhook URLs into hosted secrets (names surfaced in SET-04's table; values never in
the app). Settings card: event type → space mapping with per-event toggles, rendered
from a config endpoint; non-admins read-only. Audit each send in
`google_integration_events`.
**Accept:** notifier unit tests (event → payload shape, gate-off default, failure
isolation); settings-card rendered tests; no webhook URL ever in a response or the
repo (grep + test); simulation logs instead of posting. **Effort:** medium.
**Cost:** $0 (Chat included in Workspace; webhooks unpriced).

### GI-03 · Job-site map + navigation link on the client and project screens (small-medium, after WS-15; FloorOpsApp queue) — OWNER PRIORITY (July 21)
**Status:** Complete — PR #80, July 21, 2026. Source-only and undeployed; live satellite embeds remain blocked on WS-15 restricted browser-key configuration.

**Why:** See the site (satellite view for driveway/staging assessment) on every
client and project screen, and one-tap navigation for crews.
**Do:** Maps Embed API iframe (browser key from WS-15; free with unlimited usage) plus
a plain Google Maps directions URL (no key) on BOTH the client screen and the project
screen/drawer. The directions link uses the `https://www.google.com/maps/dir/?api=1`
URL form, which on phones opens the platform's default/Google Maps app for turn-by-turn
— this is the "send directions to the phone's maps app" behavior, no share
infrastructure needed. Renders when the record has a stored
geocode or address; CSP `frame-src` allowance for the Google Maps embed origin;
graceful no-address state. Simulation renders a placeholder map card.
**Accept:** rendered tests for address/no-address/simulation states; CSP pinned; the
navigation URL shape pinned; no server proxying of map tiles. **Effort:** small.
**Cost:** $0 (Embed API free unlimited; URLs free).

### GI-04 · Address validation + autocomplete on lead, client, and project address entry (medium, after WS-15; FloorOpsApp queue) — OWNER PRIORITY (July 21)
**Why:** Typo-proof, USPS-standardized addresses with lat/lng captured wherever an
address enters the system — one prevented wrong-address truck roll pays for years of
usage.
**Do:** One shared server route calling the Address Validation API (server key;
`enableUspsCass` optional) used by lead create/edit, client create/edit, and project
site entry; store the standardized address + geocode + a validation verdict on the
client and project records (consumed by GI-03's maps). Front-end Places Autocomplete (New) with
session tokens terminated by the validation call (that termination makes the
autocomplete session free — pin the session-token flow in tests). Review-first: the
user confirms the standardized suggestion; never silently overwrite what was typed.
Bounded input; validation failures fall back to accepting the typed address with a
flag. Simulation returns fixture validations.
**Accept:** route tests (verdict branches, fallback, bounded input, no key in
responses); session-token flow pinned; the confirm-don't-overwrite behavior asserted;
simulation e2e on the lead, client, and project forms. **Effort:** medium. **Cost:** ~$0 at current volume
(5,000 free validations/month; WS-15 budget alert enforces the ceiling).

### GI-05 · Per-project Drive activity feed (medium, after SET-15)
**Why:** Crew photo/measurement drops into project folders become visible in the app
without folder re-listing — "what changed on this project" at a glance.
**Do:** Serialized `changes.getStartPageToken`/`changes.list` cursor polling per
Shared Drive (existing `auth/drive` scope; the page token never expires, so scheduled
polling works with zero standing infrastructure — the same serialized pattern as the
repo's chosen Gmail history polling; explicitly no `changes.watch`, no Pub/Sub).
Changes are attributed to projects via the provisioned folder mappings and stored as
bounded recent-activity rows; an activity panel on the project page renders them.
Cursor state persisted alongside the existing sync-state pattern.
**Accept:** polling unit tests (cursor advance, attribution via folder mapping,
bounded retention, unrelated-file filtering); no watch/Pub/Sub calls (grep + the
never-delete-style call-recording suite extended to assert no watch subscriptions);
simulation fixtures drive the panel e2e. **Effort:** medium. **Cost:** $0.

### GI-06 · Drive Labels status taxonomy (medium, after WS-16 edition confirmation + SET-15)
**Why:** Draft/sent/approved/closed status and project/client tags on every file the
app touches — one Drive query answers "all unsigned proposals," and status is visible
in Drive's own UI too.
**Do:** Owner creates the small label taxonomy once in the Admin console Label Manager
(no API; guided by a checklist-11 row). The app applies labels via
`files.modifyLabels` (verified to work under the existing full `drive` scope) at the
natural moments: filing an email, creating a document from a template, proposal
send/closeout transitions. A label-driven filter on the project files panel uses
label-scoped `files.list` queries. Label field IDs are configuration (blueprint-style
registry rows), not hardcoded. Requires Workspace Business Standard+ — hard-gate on
the WS-16 edition confirmation and render an honest unavailable state otherwise.
**Accept:** label-apply request shapes pinned; edition gate asserted (unavailable
state when unconfirmed); filter queries scoped; simulation parity.
**Effort:** medium. **Cost:** $0 (no API charge; edition already licensed).

### GI-07 · FCI Workspace Add-on: Gmail context panel + smart chips (large, after live employee login; owner-gated consent + private Marketplace)
**Why:** The marquee "meet them inside Google" integration: opening a client email in
Gmail shows FCI context (client, project stage, install dates, folder link) with
one-click file-to-project — including employees' own mailboxes the connector cannot
see — and FCI links pasted in Docs/Sheets unfurl as live smart chips.
**Do:** One Workspace Add-on with HTTP-endpoint (alternate-runtime) card endpoints on
the existing Cloud Run service: Gmail contextual trigger using the deliberately narrow
per-open-message scopes (`gmail.addons.execute`,
`gmail.addons.current.message.readonly`, `userinfo.email`) mapped to the existing OIDC
employee identity; file-to-project posts the message ID to the backend which runs the
EXISTING review-first filing pipeline via the connector; `linkPreviewTriggers` for
Docs/Sheets smart chips (`workspace.linkpreview` scope) rendering a live project card.
Verify Google-signed ID tokens on every call. Published PRIVATE to the org via the
Marketplace SDK (unreviewed, internal, free) — listing creation is an owner step.
Blocked on: live employee login (identity mapping) and owner approval of the add-on
consent surface (a third OAuth client class; never merged with the connector or login
clients).
**Accept:** card-endpoint tests with signed-token verification (reject unsigned/wrong
audience); the filing path proven to reuse the existing review-first pipeline (no new
Gmail write scopes — grep); smart-chip card contract tests; a documented owner
publishing runbook; simulation/dev harness for card rendering. **Effort:** large.
**Cost:** $0 (unpriced add-on runtime on existing infrastructure).

---

# Task tracking and doc reconciliation (the no-confusion rule)

**GitHub baseline:** source is reconciled against `main` at `599e39f` after PR #57
merged the reviewed application-logo asset refresh. PR #56 completed the SET-10
Workspace connection-health packet, and PR #52 previously completed
the KPI-02 flooring booking inputs and reporting packet, PR #53 completed the BE-12
rehearsal inventory packet, and PR #51 completed the BE-09 production core-record route
packet. PRs #63/#64 added the dashboard-driven
Workspace setup workstream, and PR #65 codified the multi-agent coordination protocol.
PRs #54/#55 completed OIDC-02/OIDC-03 in source,
PRs #60/#62 reconciled their merged status, and PR #61 expanded the Fable follow-up
instructions.
PR #66 completed TRK-02 tracking-guard hardening.
PRs #52, #56, and #57 are merged source-only and undeployed; migration 0012 is
unapplied to Sites. The reviewed PR #51–#57 merge train is complete. None of these
later source changes is deployed.
The exact deployed baseline
remains PR #32 at `adc79b855041db04cc3ca2a3eb232bc72408d33b`, private Sites development
version 40, which includes PR #30's semantic Settings rules table. The listed source
packets that are merged, including PRs #51, #53, and #66, are undeployed. Delivery PRs mirror items in these ledgers and do
not become a separate task source of truth.

**This document is the status ledger for these three workstreams** (the same pattern as
`docs/design-critique-fix-plan.md` for the UI critique). Rules for every agent packet:

1. Items without a status line remain **Open**. When an agent starts an item it adds a status
   line in its own PR and updates that line on merge.
   **The shape below is mechanically enforced by `tests/task-tracking-docs.test.mjs` — an
   invalid line fails the build, so copy it exactly.** Two structural rules first:
   - The marker is **`**Status:**`** in bold. A bare `Status:` is explicitly rejected.
   - The status line must sit on the line **directly below the packet heading**, with no
     blank line between them.

   The six legal forms are exactly:

   | Form | Example |
   |---|---|
   | Complete | `**Status:** Complete — PR #216, July 26, 2026.` |
   | Complete, multi-PR | `**Status:** Complete — PR #185 + PR #195, July 25, 2026.` |
   | In review | `**Status:** In review — PR #217` |
   | In progress | ``**Status:** In progress — `codex/set22-create-drive-files` `` |
   | Blocked | `**Status:** Blocked — awaiting owner prioritization` |
   | Resolved / superseded | `**Status:** Resolved in PR #197` · `**Status:** Superseded — absorbed into SET-06` |

   Notes the guard enforces that are easy to miss: an **In progress** branch must be
   backticked and must start `codex/` or `claude/`; **Blocked** takes free text (it is *not*
   restricted to checklist-00 inputs); and for packets the guard knows are merged, **Complete**
   additionally requires the full `, Month D, YYYY.` date with the trailing period.
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

### TRK-02 · Harden merged-packet tracking against wrapped and bare-reference drift (small)
**Status:** Complete — PR #66, July 20, 2026. Source-only and not deployed.

**Why:** The merged-packet guard can miss `in progress`, wrapped status text, and common
bare references such as `OIDC-02/#54`. Its whitespace-collapsed proximity window can also
cross Markdown table and heading boundaries, producing both blind spots and false matches.
**Do:** (1) Treat `in progress` as stale wording for merged work. (2) Capture each complete
packet-status paragraph so wrapped continuation text cannot hide required or forbidden
phrases. (3) Scan each physical line independently and recognize both `PR #NN` and bare
`#NN` references. (4) Add mutation-sensitive fixtures for every blind spot and for the
line-boundary non-match. Keep the two dated Fable review snapshots outside the live guard.
**Files:** `tests/task-tracking-docs.test.mjs`, this plan, the current handoff, and the owner
checklist dashboard if line-local formatting or baseline truth needs reconciliation.
**Accept:** focused tracking tests prove `in progress`, forbidden wrapped status text, an
adjacent-sentence bare reference, and a `PR #NN` reference fail; unrelated work on another physical line does
not fail; lint and `npm test` pass; no historical review snapshot changes.

---

# Workstream F — Dashboard design enhancement (DES)

Owner-approved July 22, 2026. Design authority: `docs/dashboard-design-spec.md`
(+ the sign-off mockup `docs/dashboard-design-mockup.html`). Binding simplicity
guardrails and the interactive-vs-static affordance grammar live in the spec —
every packet's PR includes 1280 px and 390 px screenshots. House rules: at most
ONE in-flight packet touching `app/globals.css`; `app/FloorOpsApp.tsx` strictly
serial; golden-hash regeneration only in DES-05 (both hashes) and DES-07
(Reports only), isolated and diff-reviewed; e2e aria-labels and `data-layout-*`
attributes byte-identical; pinned-source tests updated mutation-sensitively in
the same PR, never deleted.

### DES-01 · Design tokens: one :root, dead-rule excision, media consolidation (medium; holds the globals.css lock)
**Status:** Complete — PR #119, July 22, 2026. Source-only and undeployed. The
globals.css lock passes to DES-02.

**Why:** two competing `:root` blocks with alias indirection, dead legacy
`.main-nav button`/`.brand-mark` rules, and ~10 fragmented `820px` + 8 `560px`
media blocks with later-block-wins contradictions; every later packet edits this
file.
**Do:** merge the `:root` blocks; rewrite the few `var(--muted)`/`var(--green)`
usages to canonical tokens then delete the aliases; add the spec §3 scale tokens
valued at current dominants; delete the provably dead rules; consolidate to ≤3
`820px` and ≤2 `560px` blocks resolving every contradiction toward today's
winner. Zero intended visual change.
**Accept:** both golden hashes UNCHANGED; exactly one `:root`; zero
`var(--muted)`/`var(--green)` remaining; lint + full tests green; pinned CSS
strings updated only if their block moved.
**Effort:** medium. **Cost:** $0.

### DES-02 · Control/radius/border/shadow normalization + undersized-control guard (medium, after DES-01)
**Status:** Complete — PR #126, July 23, 2026. Source-only and undeployed. The
review-fix revision made the guard's mutation pin real and restored the two
directional shadows byte-exact. The globals.css lock passes to DES-03, which
also absorbs SET-31's dead Stage-2 CSS residual.

**Why:** radius drift 1–16 px, 11+ interactive heights, three shadow alphas, and
green-tinted legacy borders against the warm palette; the Phase-4
undersized-control guard is still open.
**Do:** remap radii/heights/shadows onto the DES-01 tokens (prefer
`min-height`; QA dense inbox rows at 390 px); normalize green-tinted borders to
`var(--line)`/`--line-soft` (the one deliberate subtle visible change —
before/after screenshots in the PR); add the static guard failing any NEW fixed
interactive control under 34 px, allowlisting audited exceptions.
**Accept:** guard fails on a synthetic 30 px control; golden hashes unchanged;
axe serious/critical 0 at 1280/390.
**Effort:** medium. **Cost:** $0.

### DES-03 · Logo transparency + bare-brand treatment (small-medium; SVG work parallel-safe, `.brand` edit takes the globals lock)
**Status:** Complete — PR #132, July 23, 2026. Source-only and undeployed. Opus review: zero substantive findings — SVG SHA256 pins independently recomputed and matched, the app-icon +4/-1 is benign pretty-printing plus the background removal (one path remains), every deleted Stage-2 selector grep-proven consumer-free with the live `-health`/`-service-table` classes intact. The globals.css lock passes to DES-04. Fringing QA rests on the six committed DPR screenshots; the remaining near-white fills are per-glyph interior detail and cannot produce a full-canvas halo.

**Why:** the white background is baked into BOTH rendering SVGs and `.brand`
paints its own white card; owner chose the transparent logo directly on the
cream sidebar.
**Do:** delete the app-icon SVG's full-canvas background path; remove the
enhanced-logo SVG's background path with fringing QA (fallback: request a true
transparent master and say so in the PR); `.brand` → transparent, borderless,
`object-fit:contain` (expanded and 78 px collapsed tile); PNGs and manifest
icons stay byte-identical; update the SVG SHA256 pins and `.brand` CSS-string
pins in the same PR.
**Accept:** no white halo expanded/collapsed/mobile at dpr 1 and 2; SVG
sanitizer assertions pass; golden hashes unchanged.
**Effort:** small-medium. **Cost:** $0.

### DES-04 · Nav & shell polish: 44px toggle, honest compact badges, breakpoint sweep (small-medium, after DES-02; FloorOpsApp queue)
**Status:** Complete — PR #159, July 24, 2026. Source-only and undeployed. Opus review: ZERO findings — the reveal-on-scroll-up topbar implements all four always-visible conditions with passive rAF mechanics and full e2e pins; compact badges render real text with the allowlist emptied and guard tightened; topbar gap landed; the folded FIX-19 blueprint-chip fix is present (wraps only at "-"); both golden hashes byte-identical. The FloorOpsApp queue and the globals lock pass to DES-07.

**Why:** the collapse toggle is 36 px hung at `right:-13px`; the compact badge
is a `font-size:0` + `::after` hack carrying a permanent test allowlist.
**Do:** toggle to ≥44 px repositioned inside the rail; `FeatureStateBadge
variant="compact"` renders real text (aria/title carry the full state) and both
`font-size:0` hacks are deleted with the test allowlist EMPTIED; collapsed-rail
nav items ≥44 px tall; shell sweep at 1180/960/820/620/560 re-verifying the
drawer focus trap. PLUS (owner addition, July 23, 2026) the mobile
reveal-on-scroll-up topbar: at ≤820 px the topbar (search + menu button) hides
on scroll-down and reveals on the FIRST scroll-up, iOS-Safari style — direction
detection with a small threshold (no flicker on micro-scrolls), a passive
rAF-throttled scroll listener, always visible at the top of the page, always
revealed while focus is within it, and `prefers-reduced-motion` gets instant
show/hide instead of the slide; desktop behavior unchanged. PLUS (owner
screenshot, July 23, 2026) topbar control spacing: give `.topbar`
(globals.css:58, currently `space-between` with NO gap) an explicit `gap`
(~14 px) so the search field, notification button, and Add-lead button never
render flush against each other at any width; the search's `min(480px,48vw)`
width may also need a lower cap at intermediate widths (~1050 px is where the
owner observed the collision).
**Accept:** zero `font-size:0` in globals.css and an empty allowlist asserted;
nav aria-labels unchanged; golden hashes unchanged; axe green desktop+mobile;
a mobile-viewport e2e asserts the topbar hides on scroll-down, reveals on one
upward scroll, stays visible with focus inside it, and renders statically under
reduced motion; no topbar control renders flush against a neighbor anywhere in
the 1180/960/820/620/560 sweep.
**Effort:** small-medium. **Cost:** $0.

### DES-05 · Interactive vs static card grammar + FIX-08 absorption (medium; FloorOpsApp queue, after DES-06; GOLDEN REGEN 1 of 2)
**Status:** Complete — PR #149, July 23, 2026. Source-only and undeployed. Opus review with regen forensics: zero findings — every hashed markup delta traced to this packet, FIX-08 absorbed in full (Superseded recorded), holistic finding H-5 (Gmail panel pill wrap) fixed via the single-line source-subtitle treatment. Both golden hashes regenerated once as sanctioned. The FloorOpsApp queue slot passes to DES-04, which also takes the globals lock next.
**Why:** interactive and static cards are pixel-identical at rest; Overview
metrics carry false `trend="Current"` pills; FIX-08's honesty items live in the
same cards — absorbed here so nothing is built twice.
**Do:** extend `Metric` with optional `href` per the spec §2 grammar (chevron +
hover-lift + cursor when linked; visibly FLAT when static). Destinations:
Active pipeline→Leads, Active projects→Projects(Active), Filed emails→Inbox,
Project meetings→static-flat, Reports summary analogous; non-links while not
`ready`. Absorb FIX-08 in full: remove the trend pills; Scheduling subtitle →
`FeatureStateBadge` via a `PanelHeader` badge slot; notifications popover
relabeled honest navigation; error copy "Unavailable until live records load"
(never "Loading" on error). Regenerate BOTH golden hashes once, diff reviewed to
contain only this packet's deltas; add FIX-08's render-invariance tests. Record
FIX-08 as superseded-by-DES-05 in the findings ledger.
**Accept:** grammar table of spec §2 holds on every card; goldens' diff
reviewed line-by-line; render-invariance for removed literals; axe green.
**Effort:** medium. **Cost:** $0.

### DES-06 · Layout-editor polish: icon-only Edit, honest Hidden-sections row, unified title-actions (small; FIRST DES packet in the FloorOpsApp queue; no golden regen)
**Status:** Complete — PR #143, July 23, 2026. Source-only and undeployed. Opus review: zero findings — aria-labels byte-identical, both golden hashes verified unchanged on both refs, the inert Add-section pseudo-button is gone (absence now guard-asserted). The FloorOpsApp queue slot passes to DES-05.
**Why:** owner bug — the "Add section" label is an inert pseudo-button; in the
default state the row has zero working controls; the Edit control renders in
different heading structures on the two pages.
**Do:** per spec §6 — icon-only Edit button (aria-labels byte-identical, `title`
tooltip, ≥44 px target; Retry variant keeps icon+text); the add row renders only
when sections are hidden, retitled "Hidden sections" as a plain group label;
delete the unreachable filler branch (and its copy pin if any); `PageTitle`
wraps `action` in `.title-actions`; Overview adopts `PageTitle`.
**Accept:** no inert pseudo-button in default edit mode; page-layouts e2e green
with the focus flow intact; identical Edit placement on both pages at 1280/390;
golden hashes unchanged (headings sit outside them).
**Effort:** small. **Cost:** $0.

### DES-07 · Primitive unification: KpiMetric→Metric, empty-state primitive, pill base (medium; FloorOpsApp queue after DES-04; GOLDEN REGEN 2 of 2, Reports hash only)
**Status:** Complete — PR #165, July 24, 2026. Source-only and undeployed. Opus review with regen forensics: Overview hash BYTE-IDENTICAL, Reports hash changed exactly once with every delta traced to the KpiMetric→Metric fold; empty-state copy pins byte-identical; pill class names rendered unchanged. Workstream F core (DES-01…07) is now COMPLETE. P3 for FIX-17 (July 24): the fold gives all KPI cards uniform 16px padding (+1px vs the old 15px override) — cosmetic. The FloorOpsApp queue advances to the DES-08 sub-scopes; the globals lock is FREE (HINT-01 may claim it).

**Why:** Reports keeps a private duplicate `KpiMetric`; ~7 bespoke empty-state
classes; five-plus pill systems — the design ledger's open Phase-3 primitive
track.
**Do:** extend shared `Metric` with `footer`/`caption` slots and fold
`KpiMetric` into it (`business-kpi-card` becomes a size modifier; the two
linked KPI cards keep their footer links, cards stay flat); one
`OperationsEmptyState` primitive migrating the bespoke empties (pinned copy
byte-identical); one `.pill` base with variant aliases preserving rendered
`status-*`/`feature-state-*` class names.
**Accept:** zero duplicate metric component; Overview hash UNCHANGED (review
assertion); Reports regen diff = KpiMetric structure only; screenshot pass.
**Effort:** medium. **Cost:** $0.

### DES-08 · Owner-selected additions: industry surfacing, segment, quick-add removal, attention strip, Today's meetings (small each; sub-scopes ship as separate PRs in the FloorOpsApp queue)
**Status:** Blocked — sub-scope c only, deferred by owner decision (July 24, 2026) until the AI wave lands a truthful attention signal (revisit after AI-02/AI-04). Every other sub-scope is merged: b (PR #167), d (PR #170), a-T1 (PR #174, incl. the Unspecified-industry honesty review fix), and a-T2 (PR #179 — migration 0019 nullable projects.segment, closed two-value catalog, industry-derived default with widen-on-read, KPI segment splits computed but deliberately rendered nowhere pending a non-golden display slot). Source-only and undeployed; migration 0019 unapplied to Sites. Guide impact: none.

**Why:** owner selections of July 22 — all four extras plus the meetings
resolution of spec §5.
**Do:** (a-T1) add "Residential" to the industry select; keep the client-row
industry chip; add a "Clients by industry" report list reusing `ReportBarRow`
(UI-only). (a-T2, joins the MIGRATION queue after the visual series) additive
D1 migration (number at merge time) adding a two-value `segment`
(commercial|residential) to projects, DEFAULTED from the client's industry with
one optional tap at creation — never required, no third value; KPI splits in
`flooring-kpis.ts`; widen-on-read law. (b) remove the lone topbar "Add lead"
button with a render-invariance test. (c) make the Overview attention strip
actionable using the spec §2 grammar. (d) "Today's meetings" Overview section
per spec §5 — new SET-35 catalog entry, max ~5 one-line rows opening their
project drawer, honest empty state; NOT scheduling. Build-once with AI-04:
whichever of DES-08(d) and the AI Today view lands second consumes the first's
today's-meetings server query (cross-reference recorded in both packets).
DES-08(d) owns the build-once read in
`app/application/today-project-meetings.ts`; the existing bounded AI `today`
tool consumes it immediately, and AI-04 must extend that shared read rather
than reintroducing a second project-meetings query.
**Accept:** per sub-scope per the spec; each PR carries 1280/390 screenshots;
(d) extends the SET-35 layout tests (catalog widen-on-read proves older saved
layouts unaffected).
**Effort:** small each; a-T2 small-medium. **Cost:** $0.

### DES-09 · Guardrail wrap-up + ledger closure (small; tests/docs only, last)
**Why:** close the design-critique ledger's Phase-3/4 open items this series
executes, and leave one truth.
**Do:** commit the approved 1280/390 reference screenshots of the durable
routes on the post-series frame; extend the axe matrix to the editor editing
state and the notifications popover; update `docs/design-critique-fix-plan.md`
(Phase 3/4 closed with PR references) and the findings ledger (FIX-08
disposition); reconcile all DES statuses.
**Accept:** ledgers agree with reality; screenshots committed; guard suite
green (empty font-size-zero allowlist + undersized-control guard).
**Effort:** small. **Cost:** $0.

### DES-10 · Brand-mark presentation refinement (small; NOT priority — after the current DES queue; SVG work parallel-safe, the `.brand` edit takes the globals lock briefly)
**Why:** owner feedback (July 23, 2026, post-DES-03 screenshot): the
transparent logo "doesn't fit the UI" — the enhanced master is a 1254×1254
SQUARE traced badge (133 paths, including a decorative frame) rendered into a
wide sidebar slot via `object-fit:contain`, so it reads as a small floating
framed label with dead space on the bare cream sidebar.
**Do (mockup-first):** Fable produces 2–3 presentation variants as images for
owner sign-off BEFORE any build — (a) crop the SVG viewBox to the mark's true
bounds and remove the decorative frame paths; (b) horizontal lockup: the
app-icon diamond mark plus "Floor Coverings International" set in the UI
display font; (c) scale/position-only tuning. Codex then builds ONLY the
chosen variant: SVG edits with SHA-pin updates in the same PR (DES-03
discipline), `.brand`/`.sidebar-brand-row` sizing, collapsed-tile (34 px)
coherence, mobile-drawer check.
**Accept:** the owner-approved variant matches at 1280/collapsed/390 (dpr 1
and 2 screenshots in the PR); SVG sanitizer and pin tests green; golden hashes
unchanged; PNGs/manifest byte-identical unless the variant explicitly
regenerates them (then stated in the PR).
**Effort:** small. **Cost:** $0.

### DES-11 · Curated movable & resizable dashboard cards (owner enhancement, July 24, 2026)
**Status:** Complete — PR #252 + PR #261, July 31, 2026. Source-only and undeployed. **Both sub-scopes shipped**: A the persisted span model, B the curated width toggles. The owner's July 24 movable-and-resizable dashboard design is delivered end to end. Golden hashes byte-identical throughout — verified on the merged tree, not assumed. The `app/FloorOpsApp.tsx` queue slot and the `app/globals.css` lock are both free.

**Historical note, retained deliberately — sub-scope A shipped first in PR #252 and B in PR #261.** The packet carries no status line because B is still
open and the dispatch law reads "available if and only if it has no status line" — but a
claimant must take **B only**. Do not rebuild A.

**A, merged in PR #252 — do not redo:** the `fullWidth` span model in
`app/lib/page-layouts.ts` (type, `PAGE_LAYOUT_RESIZABLE_SECTIONS`, validators, merge,
`isDefaultPageLayout` requiring empty `fullWidth`, and the pure `resolveArrangedSpans`
pairing-promotion pass), the FloorOpsApp arranged-branch mappings with the
`data-page-layout-size` hook, symmetric `repeat(2, minmax(0,1fr))` arranged tracks in
`globals.css`, and the unit-test updates. A seven-lens review proved the no-holes
invariant holds for every input, including hidden sections interleaved with halves and a
lone trailing half. Golden hashes verified byte-identical on the merged tree. **The
`app/FloorOpsApp.tsx` queue slot and the `app/globals.css` lock are both FREE again.**

**B, still to build:** the width-toggle UI and its e2e — `PageLayoutEditor` toggle, copy,
pressed styling, the e2e `StoredPreferences` type (which A deliberately left carrying no
`fullWidth`, assigning the type update here), and one new test covering the curated-only
toggle census, keyboard operation, pairing outcome via `data-page-layout-size`, axe at
1280/390 in the editing state, a ≥44px target, persistence round-trip, and Reset →
default digest byte-identical. B touches `PageLayoutEditor.tsx` and the e2e spec; it does
**not** need the FloorOpsApp or globals.css locks.

**Why:** owner feedback (July 24, 2026): layout-editor cards only move
vertically, and layouts can look incohesive after moves. Owner decisions,
same day: snap-to-grid with automatic packing (no pixel-free dragging), and
a CURATED resizable set — table/chart panels resizable, small KPI tiles
fixed — chosen for simpler build, maintenance, and updates.
**Design (approved July 24, 2026):** a curated span model on the existing
arranged grid. Each page layout's persisted `{order, hidden}` gains
`fullWidth: sectionKey[]` under the same strict-write / widen-on-read /
actor-invisible-merge laws as `hidden`. New
`PAGE_LAYOUT_RESIZABLE_SECTIONS`: overview → lead-pipeline, scheduling,
active-projects, gmail-project-inbox; reports → pipeline-by-stage,
projects-by-status; everything else fixed. Cohesion is guaranteed by a pure
pairing-promotion pass (`resolveArrangedSpans`): every rendered row is
exactly one full card or two half cards — a lone half is promoted to full,
so no layout can ever show a hole (also fixes the existing lone-half hole).
DOM order stays visual order (no `grid-auto-flow:dense`). Arranged grid
tracks become symmetric `repeat(2, minmax(0,1fr))` so "half means half".
`isDefaultPageLayout` additionally requires empty `fullWidth` so span-only
customization renders the arranged branch. Editor gains one `aria-pressed`
"Full width" toggle per curated section (keyboard-operable, constant
accessible name, no focus-choreography changes); Reset clears spans for
free; control remains available at mobile widths with "Width applies on
wide screens." copy. Reconciliation with the nightly program's future
Night-4 collapse outcome: a later `collapsed: sectionKey[]` value key
composes under the same laws without conflict.
**Do:** (A) span model + arranged render — `app/lib/page-layouts.ts`
(type, curated constant, validators, merge, isDefault, resolveArrangedSpans),
FloorOpsApp arranged-branch mappings replacing the hardcoded full-width sets
(+ `data-page-layout-size` hook), symmetric arranged-grid tracks in
globals.css, unit-test updates (page-layouts, user-settings, rendered-html
source pins); 1280 before/after screenshots of an arranged layout. (B) width
toggle UI + e2e — PageLayoutEditor toggle + copy + pressed styling, e2e
StoredPreferences type and one new test (curated-only toggle census,
keyboard operation, pairing outcome via data-page-layout-size, axe at
1280/390 in the editing state, ≥44px target, persistence round-trip, Reset →
default digest byte-identical).
**Accept:** NO golden regeneration — corrected July 24, 2026: the golden
hashes capture only the default-layout markup and spans live entirely in the
arranged branch, so `defaultSections` and every sectionNodes inner markup
stay untouched and both golden constants remain byte-identical throughout;
legacy stored layouts without `fullWidth` normalize to `[]` and still render
the byte-pinned default; no new dependency; no x/y coordinates, row-height
resize, or third width size.
**Effort:** A small-medium + B small (2 packets; down from the pre-design
3–5 estimate). **Cost:** $0.

# Workstream G — AI assistant & automation (AI)

Owner-approved July 23, 2026. Design authority: `docs/ai-assistant-spec.md`
(architecture decision, tool-registry bounds, safety model, canonical copy,
triage calibration protocol, cost model, Tier-2 gates). Goal: make the
existing office-gated assistant genuinely useful — organize email, keep
records findable, review to-dos, produce an on-demand "today" list, and
answer questions across projects, meetings, phone-call notes, filed-email
records, and Drive documents — while every outbound artifact stays
draft-first and every Gmail mutation stays review-first. Provider: OpenAI
(existing `OPENAI_API_KEY`/`OPENAI_MODEL`, Responses API, `store:false`)
behind a provider port. Architecture: live agentic tool-calling with bounded
budgets (spec §2); NO vector index, NO cron/scheduled handler, NO auto-send
anywhere in Tier 1 (repo law). House rules: `app/FloorOpsApp.tsx` is touched
by AI-02 only except for the owner-approved AI-11(b) Settings dispatcher
branch; every AI feature is an optional accelerator with a mandatory
records-only fallback; one new table (`tasks`) in the whole tier; no new nav
items, pages, or modals, and no new Settings sections except AI-11(b)'s
owner-approved dedicated **AI assistant** section; golden hashes never
regenerate in this workstream; spec §5 (untrusted-data contract,
injection fixtures, citation re-validation, no-write tool registry) binds
every packet. Tier 2 (AI-T2-1…AI-T2-6: scheduled digest delivery, time-based
reminders, opt-in auto-labeling, SMS with A2P/TCPA consent ledger, pgvector
document index, phone-provider transcript ingest) is designed in spec §8 and
may not start before production-platform acceptance plus each item's listed
gate.

### AI-01 · Tasks foundation + phone-call meeting type (medium; no deps — parallel-safe now)
**Status:** Complete — PR #135 + PR #140, July 23, 2026. Source-only and undeployed; migration 0018 not applied to Sites.

**Why:** "review to-dos and tell me what to get done today" has no substrate —
no tasks table exists anywhere (only `project_meetings.action_items_json`
strings); phone calls also need a home, and `project_meetings` already fits
(notes/transcript/summary/action items) given a new meeting type.
**Do:** D1 migration (number at merge time; coordinate with DES-08 a-T2)
creating `tasks`: `id, title (≤200), details (≤4000, optional), status
('open'|'done'), due_date (optional), project_id?, lead_id?, assignee_email?,
source ('manual'|'meeting'|'email'|'ai'), source_ref?, created_by,
created_at, updated_at, completed_at?` with indexes on `(status, due_date)`
and `(project_id, status)`. Follow the BE-06 pattern end to end:
`app/domain/task.ts` (bounded text, closed enums), ports, d1 + postgres +
memory adapters (PG parity schema appended as the next free production
version at merge time — open BE-07 reserves v7; v1–v6 checksums untouched),
`app/application/task-operations.ts`, routes `GET/POST /api/v1/tasks` and
`PATCH /api/v1/tasks/[taskId]` (office-gated, same-origin, bounded 8k bodies,
dev rate limiter, `no-store`), activity events on create/complete. Also add
`"phone-call"` to `PROJECT_MEETING_TYPES` in `app/domain/project-meeting.ts`.
The D1 column is unconstrained text and unknown values already degrade to
`"other"`, so this needs no D1 migration; the registered PostgreSQL v6 CHECK
still requires the widened rule prepared in AI-01's deferred task migration,
and rehearsal input rejects `phone-call` until that migration is registered
after BE-07. The UI select option ships in AI-02c. No UI in this packet.
**Files:** `db/schema.ts`, `drizzle/<next>_*.sql`, `app/domain/task.ts`,
`app/ports/task-repository.ts`, `app/adapters/{d1,postgres,memory}/task-repository.ts`,
PG parity schema + registry, `app/application/task-operations.ts`,
`app/api/v1/tasks/**`, `app/domain/project-meeting.ts`, tests.
**Accept:** CRUD round-trips on d1 + memory adapters; PG repository unit
tests pass; oversized bodies 413; non-office rejection asserted in the
access-boundaries suite; `meetingType: "phone-call"` accepted by POST
meetings and echoed in responses; existing meeting tests green; migration is
source-only/unapplied and the PR says so; `npm test` green.
**Effort:** medium. **Cost:** $0.

### AI-02 · Assistant & Inbox surface extraction + phone-call option (medium; the ONLY FloorOpsApp packet — one queue slot, three serial PRs a→b→c)
**Status:** Complete — PR #182 + PR #187 + PR #193, July 24, 2026. Source-only and undeployed. All three serial sub-PRs fleet-clean: a and b were byte-identical extractions of the Assistant and Inbox surfaces (39/39 and 38/38 executed green, every pin a required re-point), and c added the phone-call meeting option — the packet's only behavior change — with the full option-list mutation-pinned, evidence at 1280/390, and the meeting guide updated in-PR per the currency rule. The FloorOpsApp queue slot is RELEASED; the fix-tail (NFIX-03, FIX-15, FIX-17, SET-22) and AI-04 are unblocked — SET-26 stays gated on SET-23 (its acceptance needs the SET-23 viewer). Guide impact: `docs/meeting-notes-and-otter.md` updated (phone-call now offered).

**Why:** AssistantView, InboxView, and GmailReplyModal live inside
`FloorOpsApp.tsx`; without extraction every AI UI packet would serialize
behind the single-file queue forever. SET-01 proved the pattern.
**Do:** (a) move `AssistantView` + `SourceDetailModal` + the citation type to
`app/assistant/components/AssistantView.tsx` (narrow local prop types per the
SET-01 convention); (b) move `InboxView`, `GmailReplyModal`,
`inboxProjectSuggestion`, `inboxDate` to `app/inbox/components/`; keep
`GmailFilingModal` imported from `GoogleWorkspacePanel.tsx` as today. Both
zero-behavior-change: identical markup, aria-labels, copy. (c) add
`<option value="phone-call">Phone call</option>` to the MeetingModal
meeting-type select (defaultValue unchanged) — the only intended behavior
change in the slot. Update pins mutation-sensitively in each PR:
`appSurfacePaths` additions in `tests/rendered-html.test.mjs`; re-point the
InboxView/AssistantView source-slice assertions (exactly one
`inbox-state-strip`, `assistant-project-scope`) to the extracted files;
change the SettingsView slice end anchor in
`tests/settings-component-boundaries.test.mjs` from `"function
GmailReplyModal"` to `"function LeadModal"`; add
`tests/assistant-inbox-component-boundaries.test.mjs` mirroring the settings
boundaries suite. Do NOT extract ProjectDrawer (no AI consumer — pure risk).
**Files:** `app/FloorOpsApp.tsx`, `app/assistant/components/`,
`app/inbox/components/`, the three test files above.
**Accept:** `/assistant` and `/inbox` e2e green unchanged; both golden hashes
UNCHANGED; boundaries test proves the components no longer exist in
FloorOpsApp; PR (c) shows the new option at 1280/390; `npm test` green after
each PR.
**Effort:** medium. **Cost:** $0.

### AI-03 · Provider port + org-wide agentic Q&A (large, after AI-01; API/lib only — no FloorOpsApp)
**Status:** Complete — PR #145, July 23, 2026 (including the reviewed revision commit). Source-only and undeployed; runtime AI answers require the owner's `OPENAI_API_KEY` in hosted settings (records-only fallback until then). Fable two-lens review + revision verify: budgets enforced in code with literal law pins, citation re-validation and injection fixtures proven, outbound-host/one-fetch guard mutation-tested, single-project behavior byte-identical, AI-09's outbound guard pulled forward. Residuals for AI-09's reconcile: single-project evidence includes financial values for all office users (legacy byte-identity) while every org-wide tool redacts for non-admin — align there; two informational P3s recorded in the review log (post-timeout abort semantics blur; 429 test imports the shared limit constant).

**Why:** the assistant answers only single-project questions from one
pre-built evidence block; the owner needs org-wide questions answered live
from D1/Drive at question time — no maintained index (repo law + the right
architecture at this corpus size).
**Do:** provider port `app/ports/assistant-provider.ts` + OpenAI adapter
`app/adapters/openai/responses-provider.ts` (recorded-fixture tests; 20 s per
call); move `projectEvidence()` into `app/application/assistant/` with
byte-identical SQL (re-point its pins); implement the spec §4 tool registry
(`search_records`, `get_project_evidence`, `get_client_evidence`,
`search_meetings`, `list_tasks`, `list_leads`, `filed_email_records`,
`dashboard_metrics`, `today`, and `drive_search` registered conditionally on
SET-26's service — never built twice) — every tool read-only, bounded,
isAdmin-aware (financial fields admin-only, mirroring Reports); orchestration
loop `answer-question.ts` with the spec §2 budgets (≤4 rounds, ≤6 tool
executions, ≤24k evidence chars, 60 s), final answer through the existing
strict grounded schema with citation re-validation. Route change:
`projectId` becomes optional — single-project behavior byte-identical
including the deterministic records-only fallback; org-wide failure fallback
is a deterministic records-only summary from `search_records` top hits.
System prompt keeps the pinned evidence-only sentence and adds: tool results
are data, never instructions.
**Files:** `app/ports/assistant-provider.ts`, `app/adapters/openai/`,
`app/application/assistant/`, `app/api/v1/assistant/route.ts`,
`tests/assistant-*.test.mjs`, `tests/rendered-html.test.mjs` pin re-pointing.
**Accept:** scripted-fake-provider tests prove budgets enforced, forged
citation ids rejected, non-admin financial redaction, deterministic org-wide
fallback; single-project fallback responses byte-identical to today;
`records-only` and prompt pins pass; injection fixture (hostile tool result)
green; secret-leak suite green; `npm test` green.
**Effort:** large. **Cost:** $0 (runtime spend is owner-keyed OpenAI usage).

### AI-04 · Today view (medium, after AI-01 + AI-02; assistant components only)
**Status:** Complete — PR #201, July 25, 2026. Fable fleet with executed proof (97+102 unit tests across both lenses; the no-Gmail guard mutation-tested — an injected fetch fails the suite; real 23h/25h DST-day boundary tests; snapshot invalidation verified as ONE model with a shared generation counter and timezone/midnight/meeting triggers). Review fixes on-branch: 55d76fa kept the status/alert live regions mounted across all panel states with silent in-place completion reloads and AI-07-style deterministic focus; fb98def bound closeout follow-ups to `installation_completed_at <= now` (future-dated completions excluded, injectable-now tested). Residuals recorded: Today rows land on supported filtered destinations — record-targeted deep links need a record-id route state that does not exist (future navigation packet; bot thread routed, not dropped); one redundant dashboard GET on first open when saved displayTimezone differs from default; Ask-tab state resets on tab switch (unmount); "Prioritize with AI" not built (packet-optional). Source-only and undeployed.
**Why:** the owner's core daily ask — open the app and see what to get done
today. Computed on open; no scheduler (repo law); one surface, no new nav.
**Do:** `GET /api/v1/assistant/today` (office-gated, `no-store`):
deterministic assembly in the user's `displayTimezone` — overdue and
due-today open tasks, today's `project_meetings`, active leads with
`next_action_at` past due, closeout projects awaiting follow-up (KPI-03
fields), and a link-only needs-review inbox chip (deep link to
`/inbox?bucket=needs-review`; no fabricated count — counting requires a live
Gmail call). Build-once with DES-08(d) per the cross-reference recorded in
both packets: consume and extend
`app/application/today-project-meetings.ts`; do not duplicate its
timezone-aware bounded meeting query. AI-04 also owns revisiting
dashboard-snapshot invalidation app-wide — local-midnight rollover,
displayTimezone changes, and assistant-recorded meetings currently leave the
fetched Overview snapshot stale until the next mutation refresh (FIX-17
residual routed here, July 24, 2026) — as one refresh model, not per-section
patches. UI: Today becomes the default tab of the extracted Assistant
page (Ask second); rows deep-link; inline complete-task checkbox via `PATCH
/api/v1/tasks/[id]`; optional "Prioritize with AI" button sends the
deterministic list through the AI-03 loop for one paragraph — on demand only,
records-only tolerant.
**Files:** `app/api/v1/assistant/today/route.ts`,
`app/application/assistant/today.ts`, `app/assistant/components/` (+
`TodayPanel.tsx`), tests + e2e extension.
**Accept:** deterministic route tests across timezone boundaries (11:59 pm /
12:01 am); honest empty states; no Gmail network call in the route
(asserted); golden hashes untouched; `/assistant` e2e green with the new
default tab.
**Effort:** medium. **Cost:** $0.

### AI-05 · AI triage suggestions in the Inbox (medium, after AI-02 + AI-03; inbox components only; admin-gated)
**Status:** Complete — PR #205, July 25, 2026. Fable fleet clean (51+91 executed tests): per-message provider isolation (no batching — a hostile subject cannot touch a neighbor's suggestion), candidates SQL-bounded to id/number/name/client, mutation ban enforced by a single-client-call count assertion, review-first proven (Accept only preselects the existing GmailFilingModal; preview/filing calls asserted zero at accept). Bot P2s fixed on-branch (4dc4962): summary stage isolates stale messages via allSettled with client-abort semantics preserved; one shared 55s batch deadline via AbortSignal.any (per-call timeout = min(20s, remaining)); null-project confidence clamped to low server-side. Residual P3s recorded: AI-suggestion chip is a role-less div with title-only rationale for null matches (future combined a11y pass); mutator deny-list is name-based (consider allowlist); google-gmail getMessageSummary rename landed here — AI-06 builds on it. Source-only and undeployed. Guide impact: none.

**Why:** filing email to the right project is the daily drag; rules catch the
easy cases — an AI suggestion with confidence + rationale catches the rest,
suggest-only and review-first per spec §6's calibration protocol.
**Do:** `POST /api/v1/assistant/triage` (admin + same-origin + bounded;
matches every Gmail surface): input `{messageIds ≤20}` from the loaded list;
server fetches each summary (from/subject/snippet — untrusted data) via the
existing Gmail client and asks the provider with a bounded candidate list
(project number/name/client only) for strict `{messageId, projectId|null,
confidence high|medium|low, rationale ≤200}`; server drops unknown
projectIds. UI in the extracted InboxView: one "Suggest with AI" button; an
"AI suggestion" chip beside (never replacing) the rules chip; Accept opens
the existing `GmailFilingModal` with the project preselected — the human
still previews and confirms; the filing pipeline is untouched. Feature-gated
by the AI-08 `triage` toggle; chip absent when the key is Missing.
**Files:** `app/api/v1/assistant/triage/route.ts`,
`app/application/assistant/triage.ts`, `app/inbox/components/InboxView.tsx`,
tests + simulation e2e.
**Accept:** the route provably never mutates Gmail (no modify/send call —
grep-asserted); accept path lands in the existing review modal; non-admin
403; injection fixture (hostile subject) cannot alter other messages'
suggestions; simulation e2e suggests and files one message through review;
`npm test` green.
**Effort:** medium. **Cost:** $0.

### AI-06 · Reply with AI (small-medium, after AI-02 + AI-03; inbox components only; admin-gated)
**Status:** Complete — PR #212, July 26, 2026. Implemented by a delegated Claude agent during a Codex quota outage, then reviewed with extra independence (2 Fable lenses + adversarial verify). The no-send guarantee is mutation-hard: injecting a `createReplyDraft` call into the route fails 4 tests, stripping the UNTRUSTED fence label fails 1, stripping the no-send prompt line fails 2; within the AI reply flow the only Gmail write remains the pre-existing save-draft route (AI-06 adds no Gmail mutation). Repo-wide, Gmail writes also exist outside this flow and are unchanged by AI-06: `applyFiledLabel` (`messages/{id}/modify`, the human-confirmed filing path) and `sendTestMessage` (`messages/send`, the administrator-only connection test) — AI-09's outbound inventory must count those. Review fixes on-branch: 64fc476 added a request-id + AbortController staleness guard (closing modal mid-flight and opening a reply for a DIFFERENT message could land message A's draft in message B's composer), made the signature pre-fill count as untouched text so the first click stops falsely asking to replace, defined the three new class names in globals.css using `.project-operation-error`'s existing palette, and added `aria-busy`/`aria-describedby`/`aria-disabled`-with-no-op so keyboard users can reach the gated button and hear why. d441f44 fixed a bot-caught P1 the review fleet MISSED: the records join used a digits-only project-number pattern that could not match the real `CF-<year>-<8 alphanumerics>` format (generated at create-project.ts:75, enforced at postgres/project-repository.ts:160), so records were always null and every draft fell back to `[...]` placeholders — the join now goes through `evaluateInboxFilingRules` as the packet always specified (which also maps known contacts with no number at all), with bounded reads mirroring existing call sites and a source assertion pinning that the untrusted body never enters rule matching; the regression test uses a genuine generated number and asserts the retired pattern fails it. d441f44 also bounds the MIME payload on a 4-char quantum boundary before `atob` (3-bytes-per-char budget so multibyte bodies keep identical visible output). a9a762f force-clicks the now-`aria-disabled` button in e2e, since Playwright treats aria-disabled as non-actionable. Source-only and undeployed.
**Why:** explicit owner ask — a button on an email that generates the reply
draft; the human triggers, edits, and sends; the AI never sends.
**Do:** `POST /api/v1/assistant/reply-draft` (admin + same-origin + bounded):
input `{messageId}`; server reuses the reply context plus a new bounded
`text/plain` extraction on the Gmail client (~10k chars, untrusted), joins
project context via the rules evaluator when the message maps to one, and
includes the user's saved `replySignature`; provider returns a plain-text
body (strict `{body ≤4000}`) — brief, factual, no invented commitments,
`[...]` placeholders where records don't answer. The route returns draft text
ONLY and never touches Gmail drafts. UI: "Draft with AI" inside the extracted
GmailReplyModal fills the textarea (confirm before replacing non-empty
content); the human edits and uses the existing "Save draft" (unsent Gmail
draft, `sent:false` contract). Feature-gated by `replyDrafts`.
**Files:** `app/lib/google-gmail.ts` (bounded extraction),
`app/api/v1/assistant/reply-draft/route.ts`,
`app/inbox/components/GmailReplyModal.tsx`, tests + simulation e2e.
**Accept:** the only Gmail write remains the existing save-draft route;
call-recording test proves the generation route never calls Gmail
drafts/send; injection fixture (body demanding immediate send) yields a draft
only; pinned "Sending remains a separate, deliberate action." copy unchanged;
gate-off/key-Missing renders honest disabled state; `npm test` green.
**Effort:** small-medium. **Cost:** $0.

### AI-07 · AI task extraction, review-first (medium, after AI-01 + AI-03; two PRs a/b)
**Status:** Complete — PR #185 + PR #195, July 25, 2026. Sub-PR a (PR #185): review-first task proposals with a never-persisted route, injection-contained strict schema, and server-side assignee validation; review fixes 75d98c6 kept calendar-impossible-date proposals with null dueDate and added deterministic focus + a polite live status on accept/dismiss. Sub-PR b (PR #195, Fable fleet clean — both lenses executed the touched suites, 84 tests green): widened legacy four-event Chat routing and four-key user preferences to widen-on-read without resetting saved choices (writes stay exact-key via a dedicated update parser), added the default-off `task.assigned` Chat event queued strictly after assigned-task persistence with defer-failure isolation, and kept simulation audit detail sanitized; merged on green CI after an empty bot window (one summon, no response). Residual for AI-09: FCI_OFFICE_DOMAINS-admitted users get inert assignee suggestions (allowlist is emails+actor only); the records-only fallback bypasses the taskExtraction toggle when the key is Missing (deliberate, test-asserted — owner may revisit). Source-only and undeployed.

**Why:** action items captured in meetings and phone-call notes die as
strings; the owner wants them to become tracked to-dos — a human approving
each, per the review-first law.
**Do:** (a) `POST /api/v1/assistant/extract-tasks` (office-gated, bounded):
input `{projectId, meetingId}`; the meeting's action items, summary, and
decisions (untrusted) go through the provider port; strict-schema proposals
(title, details, suggested due date, suggested assignee only from known
office emails) are returned to the caller — never persisted. UI on the
Assistant surface: a "Review proposed tasks" list — Accept creates a task via
AI-01 (`source:'meeting'`, `source_ref: meetingId`), Dismiss discards;
nothing auto-creates. Records-only fallback: without a key, offer the
meeting's literal action items as one-click candidates. (b) `task.assigned`
Chat event: widen `GOOGLE_CHAT_EVENT_CATALOG` +
`USER_NOTIFICATION_PREFERENCE_CATALOG`, FIRST converting
`parseStoredGoogleChatRouting` and `normalizeUserNotificationPreferences` to
widen-on-read merges (today both are all-or-nothing and silently reset saved
settings when the catalog grows — the SET-28 ledger note requires the merge);
fire via the existing `deferGoogleChatTask` on task-create-with-assignee
(event-driven — allowed now; gated off by default like every event;
simulation logs). Update the ChatNotificationSettingsCard event pins.
**Files:** (a) `app/api/v1/assistant/extract-tasks/route.ts`,
`app/application/assistant/extract-tasks.ts`, `app/assistant/components/`;
(b) `app/lib/google-chat-notifier.ts`, `app/lib/user-settings.ts`,
`app/adapters/d1/google-chat-routing.ts`,
`app/settings/components/ChatNotificationSettingsCard.tsx`, the tasks route
trigger, tests.
**Accept:** (a) no task row exists until an explicit accept (route-level
assert); non-office assignees dropped server-side; injection fixture
(transcript demanding bulk actions) yields bounded proposals only. (b) stored
4-event routing and 4-key user preferences survive the widened catalogs
byte-for-byte with the new event defaulted off (regression test);
secret-leak suite green; `npm test` green.
**Effort:** medium. **Cost:** $0.

### AI-08 · AI settings card + "what you can ask" help (small-medium, after AI-03 — lands before AI-05/06/07 so gates precede the gated features)
**Status:** Complete — PR #152, July 23, 2026. Source-only and undeployed; the card reads Missing until the owner adds OPENAI_API_KEY to hosted settings. Opus review: zero findings — secret path traced end-to-end (key never crosses the response boundary), widen-on-read proven in both directions (stored Chat routing survives an aiFeatures save byte-for-byte), orgQa-off returns the records-only fallback with honest cause and zero provider calls, spec §9 copy character-exact and pinned. Guide currency rule honored in-PR.

**Why:** one honest place to see whether AI is on, which model runs, and to
switch features off; users need to know what they can ask. No new Settings
section (simplicity guardrail).
**Do:** `GET/PATCH /api/v1/assistant/config` (office read; admin + same-origin
+ bounded write): `{provider:"openai", keyState:"Configured"|"Missing"
(never values), model: name only, features: {orgQa, triage, replyDrafts,
taskExtraction}}`; toggles persist in `workspace_settings.settings_json`
under `aiFeatures` (widen-on-read; default on when the key is Configured).
UI: `AiAssistantSettingsCard` rendered inside `WorkspaceDefaultsPanel`
(workflow mode) beside the Chat card — the pinned zero-queue composition;
non-admin read-only; canonical copy from spec §9. Help: the collapsible
"What you can ask" panel on the Assistant page with the spec §9 copy
verbatim.
**Files:** `app/api/v1/assistant/config/route.ts`,
`app/settings/components/AiAssistantSettingsCard.tsx`,
`app/settings/components/WorkspaceDefaultsPanel.tsx`,
`app/assistant/components/` help panel, tests (settings-admin-gating,
secret-leak extension for `OPENAI_API_KEY`, rendered pins).
**Accept:** responses contain Configured/Missing only (secret-leak suite
extended); non-admin sees state but no controls; toggles round-trip; feature
buttons honor toggles in rendered tests; the eight-section pins in
`settings-component-boundaries.test.mjs` untouched; `npm test` green.
**Effort:** small-medium. **Cost:** $0.

### AI-09 · Guardrail tests, Tier-2 reconciliation, ledger closure (small; docs/tests only, last)
**Status:** Complete — PR #216, July 26, 2026. Source-only and undeployed. AI guides and guardrails reconciled against merged source; no data, configuration, or migration change.
**Why:** leave one truth — what the AI does now, what is production-gated,
and machine-enforced outbound law.
**Do:** new `tests/ai-outbound-guard.test.mjs`: no `app/api/v1/assistant/**`
source contains Gmail send/draft-write or Chat webhook calls; every assistant
route sets `no-store`; the worker still exports `fetch` only (no `scheduled`
handler) — mutation-tested with a synthetic send call. Reconcile
`docs/ai-assistant-spec.md` §8 Tier-2 stubs (AI-T2-1…6) against reality,
update `docs/meeting-notes-and-otter.md` for the phone-call type, flip all AI
statuses, and update Sequencing at a glance + the FloorOpsApp queue appendix.
**Files:** `tests/ai-outbound-guard.test.mjs`, `docs/ai-assistant-spec.md`,
`docs/agent-plan-architecture-workspace-and-setup.md`,
`docs/meeting-notes-and-otter.md`.
**Accept:** guard fails on a synthetic send-call injection; ledgers agree
with reality; every Tier-2 entry names its gate; `npm test` green.
**Effort:** small. **Cost:** $0.

### AI-10 · Email intake: durable review queue and review-first lead capture (large; after AI-09)
**Status:** Complete — PR #235 + PR #238 + PR #245, July 30, 2026. Source-only and undeployed. All six sub-PRs shipped: the write-free classifier and only-writer persistence route (a+b+c), the app-side review queue with its Mark-reviewed exit and one coalesced Chat card per sweep (d+e), and review-first lead capture (f) — a lead-intent row pre-fills the existing Add-lead modal, submits through the existing `POST /api/v1/leads`, and retires through the existing Mark-reviewed PATCH, adding no second writer. Review across the three PRs: twenty-six defects fixed on-branch. The load-bearing ones were structural rather than local — a stranded-row class closed by a reconciling invariant at sweep start after four per-item compensations each proved defeatable, and a duplicate-lead path where the Create-lead guard was a banner flag that every retry cleared, so a second failed retry re-offered the button on a row whose lead already existed. Recorded and NOT fixed, for AI-11 to own: the lead guard is per-session, so a reload or a second administrator restores the button — closing that needs a durable marker on `mail_items`, which is a second writer this packet forbids; the prefill fabricates a next-action date and sentence the analysis never supplied, neither flagged as invented; and a row carrying intents beyond `lead` is retired with no disclosure the others existed. Guide impact: the settings guide records the app-side queue meaning and the at-rest disclosure.
**Why:** the owner asked for OpenAI to read inbound email, identify leads, and
pre-populate a draft lead a person approves, edits, or removes. Two research
passes (July 26, 2026) established that the app does **not** need a new surface
to do it — it needs to populate a review queue that already exists and is inert.
`mail_items` (`db/schema.ts:192-206`) is a finished suggestion→approval table
with `suggested_project_id`, `approved_project_id`, `status`, and `match_reason`,
carrying both adapters, production composition wiring
(`production-composition.ts:86,145,158`), a `SELECT, INSERT, UPDATE`
least-privilege grant (`infrastructure/postgres/least-privilege.sql:130`), and
blocking rehearsal coverage — and **no route or component touches it**.
`gmail.filing_review_needed` is a fully shipped Chat event with a card builder,
routing, a settings toggle, and a deep link, which cannot fire because, in the
docs' own words, *"no durable review-queue event exists yet"*. `today.ts:88-92`
already links to `/inbox?bucket=needs-review` calling it *"the inbox review
queue"*, and DES-08c is Blocked by owner decision *"until the AI wave lands a
truthful attention signal"*. One durable row makes all four true at once.
Owner decisions governing this packet are recorded verbatim in
`docs/ai-assistant-spec.md` §12; two of them are deliberate deviations from that
spec's own principles and are written down as such.
**Do:** (a) **Classify.** New `app/application/assistant/inbox-analysis.ts`: one
provider pass per email returning party, multi-intent labels, extracted lead
fields, referenced project ids, confidence, and rationale — one call, so it
cannot contradict itself. `SELECT` only; **no write** (guard-clean, precedented
at `triage.ts:148-152`). Reuse the dynamic-enum pattern from
`triageSuggestionSchema` (`triage.ts:69-102`) with `strict: true`, and the
two-tier parser from `parseAssistantTriageSuggestion` (`:104-143`): structural
violations reject the row, out-of-set values degrade to a safe default.
(b) **Persist, outside the guarded tree.** New route under `app/api/v1/`
mirroring `app/api/v1/filing-rules/` (**not** under `app/api/v1/assistant/**` —
the outbound guard rejects the bare token `DELETE` and every SQL write keyword
there). It imports the classifier and writes the result. Extend `mail_items`
additively: analysis payload, party, confidence, content hash, label-definition
version, and a minimal display snapshot (subject, sender, received date); add a
unique index on `gmail_message_id` and a `findByGmailMessageId` port method.
**Zero new tables.** Confirm `client_id` is nullable first — an email from an
unknown sender has no client, and a `NOT NULL` column invalidates the approach.
(c) **Trigger on inbox load/refresh**, over messages with no stored analysis.
Add `pageToken`/`nextPageToken` to `listMessages` (`google-gmail.ts:667-678`)
with a hard page cap (≤5 pages / 100 messages per sweep) and stop-on-known
termination — the analysis table is the watermark. Additive: every existing
caller that omits `pageToken` behaves exactly as today.
(d) **Surface as a queue.** The Inbox `needs-review` bucket stops resolving
through `labelIdForBucket` and lists stored rows instead; `inbox`/`intake`/`filed`
keep reading Gmail labels unchanged. **No new component file** —
`tests/assistant-inbox-component-boundaries.test.mjs:8-21,52` `deepEqual`s those
directory listings.
(e) **Notify.** One non-awaited `queueGoogleChatNotification` for
`gmail.filing_review_needed` after the write succeeds, matching the two existing
producers. No notifier change, no catalog change, no gate change.
(f) **Lead capture is the only accept action in this packet.** Client-side
proposal → the user approves, edits, or dismisses → Accept posts the completed
form to the existing `POST /api/v1/leads`, exactly as AI-07's review posts to
`POST /api/v1/tasks`. `LeadModal` (`app/FloorOpsApp.tsx:1572-1574`) is an
uncontrolled `FormData` form with no `defaultValue`s and needs an
`initialValues` prop — **this is the packet's only `FloorOpsApp.tsx` change and
it takes the single-file queue slot.** Do **not** add a `proposed` lead status:
`LEAD_STATUSES` is closed (`app/domain/lead.ts:3`), the board routes unknown stages
out of the main pipeline columns into the separate "Custom pipeline stages" panel
(visible, but not where a proposed lead belongs — `FloorOpsApp.tsx:1391,1405`) and sidelines
unknown stages, and creating a real lead would fire a false `lead.created` Chat
notification (`leads/route.ts:58-68`). The classifier still emits all four
intents and stores them, so calibration evidence accrues for every intent from
day one; the project-filing, schedule, and warranty accept actions are AI-11.
**Do NOT:** auto-apply any Gmail label (that is AI-T2-3, gated on production
acceptance + §6 calibration evidence + recorded owner acceptance, and
mutation-tested at `tests/ai05-inbox-triage.test.mjs:807-812`); add a page, nav
item, modal, or new component file; add a Today section
(`tests/ai04-today-view.test.mjs:467-526` pins the panel line by line);
regenerate any golden hash (the spec's §10 "Golden hashes" bullet — cite the
section, not a line number, which has already drifted once); or weaken the
no-write guards — they stay unmodified because the write lives outside the
assistant boundary.
**Files:** `app/application/assistant/inbox-analysis.ts` (new), a new route
directory under `app/api/v1/`, `app/lib/google-gmail.ts`,
`app/inbox/components/InboxView.tsx`, `app/adapters/d1/mail-item-repository.ts`,
`app/adapters/postgres/mail-item-repository.ts`, `app/ports/mail-item-repository.ts`,
`app/domain/mail-item.ts`, `db/schema.ts` + a D1 migration,
`app/platform/postgres/settings-persistence-schema.ts`,
`app/FloorOpsApp.tsx` (`initialValues` on `LeadModal` only — queue slot),
`docs/ai-assistant-spec.md`, `docs/settings-guide.md`, tests.
**Accept:** analyzing a seeded inbox writes `mail_items` rows with
`status='needs-review'`, and reloading the Inbox makes **zero** additional
provider calls for already-analyzed messages (analyze-once economics measured,
not asserted); the `needs-review` bucket renders those rows and its count is
readable for DES-08c; `gmail.filing_review_needed` fires exactly once per new
row, is never awaited, and is suppressed while the gate is off; a lead Accept
creates through `POST /api/v1/leads` and neither the classifier nor the analysis
route creates a lead; `tests/ai-outbound-guard.test.mjs` and
`tests/ai05-inbox-triage.test.mjs:726` pass **unmodified**, plus a new positive
assertion that the classifier module contains no SQL write keyword and the
analysis route is the only writer; a hostile email body cannot change the
assigned project, the server-derived confidence, or the no-send/no-file
guarantees; sweep-coverage copy states what was actually covered ("Analyzed the
40 newest messages in Inbox") rather than implying total coverage; the settings
guide records that subjects and senders now persist at rest;
`tests/assistant-inbox-component-boundaries.test.mjs` unchanged; golden hashes
untouched; `npm test` green.
**Effort:** large — file as sub-PRs (a+b+c engine and persistence; d+e queue and
notification; f lead capture and the queue slot) so the `FloorOpsApp.tsx` slot is
held only for the last one. **Cost:** provider spend only; the spec's ≤200
emails/day budget (`docs/ai-assistant-spec.md:186-194`) is the ceiling, and
analyze-once is what keeps it there.
**Progress:** sub-PRs (a+b+c) — the write-free classifier, the only-writer
persistence route, and the bounded sweep — merged in PR #235, July 28, 2026,
after a six-lens review (ten confirmed findings), a five-lens follow-up round
(four more, including a P1 continuation-token starvation), and the review bot's
v12 totality finding (legacy statuses now backfilled before the closed
vocabulary constrains). The engine is live behind the default-off
`inboxAnalysis` toggle. Sub-PRs (d+e) — the app-side review queue, the
Mark-reviewed exit, and the coalesced Chat trigger — merged in PR #238,
July 29, 2026. Sub-PR (f), lead capture and its `FloorOpsApp.tsx` queue slot,
merged in PR #245 on July 30, 2026, releasing that slot. The packet is Complete;
its status line above carries the full account.

**Binding note for whoever writes sub-PR (f) and AI-11 — learned the hard way in
PR #238.** Eighteen defects were fixed across #235 and #238, and the last five
review rounds were all the same defect at increasing depth: a filed message left
sitting in the review queue because some retirement write did not happen. The
cause is structural. **Filing and analysis are two independent writers racing
over one `mail_items` row with no shared transaction**, and a `needs-review` row
is never re-queued, so any missed retirement strands its message permanently.
Four successive per-item compensations each turned out to be defeatable by the
next interleaving. What finally closed the class is a single idempotent
set-based reconciliation at sweep start that retires every review row whose
message already has a filed archive — so whatever failed last sweep, a filed
message is out of the queue by the start of the next one. Two consequences bind
future work: (1) **prefer a reconciling invariant to a compensating action**
whenever these two writers can interleave; (2) AI-11's typed accepts add *more*
writers to the same row (task creation, filing, lead capture), so it should make
a row's terminal state one atomic decision rather than adding a fifth
compensation. The per-item retirements that remain are fast paths, not
guarantees, and must not be read as such.

**ADDENDUM (July 27, 2026 — devils-advocate review; binding, part of this packet).**
Ten judged attacks landed on this packet before dispatch. The corrections:

1. **Multi-mailbox-proof storage.** The `mail_items` migration adds
   `connection_key TEXT NOT NULL DEFAULT 'google-workspace'` and the unique index is
   **composite `(connection_key, gmail_message_id)`**, mirroring `gmail_file_archives`
   (Gmail message ids are per-mailbox). `findByGmailMessageId` takes
   `(connectionKey, gmailMessageId)`; the sole caller passes the existing literal. Zero
   behavior change at one mailbox; removes the retrofit the per-user-Gmail work would
   otherwise force.
2. **Kill switch.** Add an `inboxAnalysis` key to `ASSISTANT_FEATURE_KEYS` and one entry in
   `AiAssistantSettingsCard`'s feature list; the sweep trigger and the analysis route are both
   gated on it. New Accept line: **with `inboxAnalysis` off, an inbox load makes zero provider
   calls and zero `mail_items` writes.** This is the day-one off switch if classification
   quality disappoints; it does not pre-empt spec §12 decision 5.
3. **Status vocabulary, defined here:** `needs-review · accepted · dismissed · skipped-noise ·
   failed`. Invariant that makes the watermark claim true: **every swept message gets exactly
   one row, whatever the outcome.** `failed` rows persist with bounded retries and are excluded
   from queue counts; `skipped-noise` records the deterministic pre-filter's verdict (the
   pre-filter is reinstated, not dropped). Accept adds: a seeded `List-Unsubscribe` message
   produces a `skipped-noise` row and no provider call.
4. **Terminal states for every intent.** Lead Accept/Dismiss transitions the row out of
   `needs-review`; the existing filing route sets `approved_project_id` + a filed status; a
   manual **"mark reviewed"** action clears schedule/warranty/project-update rows until AI-11
   ships typed accepts. Without this the count only grows. The DES-08c count re-point is gated
   on these transitions existing.
5. **Reviewer named.** The queue's audience is the `FCI_ADMIN_EMAILS` list (1–2 people today);
   the packet states this and the expected decisions/day. Sub-PR (f) specifies the accept
   pre-fill contract: extracted fields plus defaults for `source`, `stage`, `ownerEmail`,
   `nextAction`/`nextActionAt`, and names which fields (`site`, `estimatedValue`) still need
   typing when absent — accept must be one review pass.
6. **Coalesced notification (owner-confirmed July 28, 2026, after PR #238 shipped
   per-row by mistake).** At most **one** non-awaited `gmail.filing_review_needed`
   card per sweep — newest arrival's subject plus "N more need review", same
   payload shape, no catalog change — not one per row. A bootstrap sweep can move
   up to `MAX_INBOX_ANALYSIS_MESSAGES` rows into review at once, so a card apiece
   would burst the office space the moment an administrator opens the Inbox.
   An **arrival** is any write that moves a row into `needs-review` from
   elsewhere, which includes a `failed` row recovering — gating on first insert
   alone silently drops every recovery, and the bootstrap sweep manufactures
   failed rows in bulk. Refreshes of rows already in `needs-review`,
   `skipped-noise`, and `failed` rows schedule nothing; the existing global and
   per-event gates remain off by default.
7. **Re-analysis path.** The stored label-definition version gets a consumer: on catalog
   change, rows still in `needs-review` become eligible for bounded re-analysis on the next
   sweep. The analyze-once Accept criterion is reworded to "zero provider calls for
   already-analyzed messages **under an unchanged label catalog**".
8. **Simulation.** When `config.simulation`, analysis short-circuits to fixture results (no
   provider call); `mail_items` cleanup joins the simulation reset route; sim rows never
   appear in the live queue or the DES-08c count.
9. **Honest coverage copy, corrected shape.** Replace the scan-count string with the sweep's
   termination reason: stop-on-known renders "You're caught up"; page-cap-with-remaining
   renders "Older messages not yet analyzed" plus a bounded **Check older** continuation. The
   e2e pins the two states, not a count string.
10. **Sub-PR (f) Files, corrected.** Its `FloorOpsApp.tsx` change is `initialValues` **plus
    prefill state and an opener prop threaded into `InboxView`** (LeadModal is file-local and
    unexported; InboxView has no lead-modal opener today). EDIT-04 ships the LeadModal rework
    first per the reordered queue; (f) consumes it.
Also: archived/terminal-status records are excluded from AI candidate queries and pickers
(mirroring `isEligibleProject`), with an Accept criterion that an archived record never
surfaces as a suggestion — shared with EDIT-05/06.

### AI-11 · Typed accepts, AI settings section, and the label catalog editor (large; after AI-10)
**SUB-SCOPES (a) AND (b) ARE COMPLETE — (a) PR #255, July 31, 2026; (b) PR #277, August 3,
2026. Both source-only and undeployed. ONLY (c) AND (d) REMAIN CLAIMABLE.** This packet
deliberately carries **no status line**: it is not complete while (c) and (d) are open, the
grammar has no partial-completion form, and any status line here would make the dispatch law
read (c) and (d) as unavailable when they are in fact open. Sub-scope completion is therefore
recorded in this body, and a claimant must read this paragraph rather than the absent status
line. Take **(c) or (d) only, in that order**. Do not rebuild (a) or (b).
**If you claim (c) or (d), add `**Status:** In progress — \`your/branch\`` in your own PR as
usual — and delete it again on merge, recording your sub-scope here.** That is the convention
this packet runs on, and the reason is worth restating: a status line left behind on a
sub-scoped packet silently blocks every sibling sub-scope. It happened to (b) in PR #277 and
was caught in review.

**(b), merged in PR #277 — do not redo:** the administrator AI controls moved (not
duplicated) out of *Workflow & notifications* into a dedicated **AI assistant** Settings
section, with the *My settings* office read-only mirror preserved, the navigation contracts
re-pointed, and decision 6's expanded data-at-rest disclosure added to the card.

**(a), merged in PR #255 — do not redo:** the three typed accepts (project-update → the
existing filing path; schedule and warranty → `POST /api/v1/tasks` with `source:"email"`,
retiring the review row atomically in the same transaction), plus a review fix for a defect
the packet's own amendment had missed.

**That fix is worth reading before building (d).** Codex's independent audit (PR #256) found
that a lead accepted through **Create lead** was stored as `dismissed`, identical to a manual
**Mark reviewed** — so the activity view (d) plans would have misreported every lead accept
and corrupted its per-label counts. The amendment above claimed outcomes were already
answerable and only attribution was missing; **that was wrong — the outcome itself was wrong
first.** The route now takes a server-validated `outcome` narrowed to
`MailItemReviewOutcome = "accepted" | "dismissed"` (deliberately narrower than
`MailItemStatus`, so the sweep-only terminal states cannot be reached by a human retirement),
both adapters **bind** the status rather than interpolating it and re-guard the value, and a
lead accept now records `accepted`. **(d) can therefore trust `mail_items.status` for
outcomes — but still needs `reviewed_by`/`reviewed_at` for attribution**, which remains
unbuilt exactly as the amendment specifies.

**Why:** AI-10 deliberately ships one accept action; three intents accumulate in the queue with
only a manual "mark reviewed" exit, and spec §12 decisions 5–6 name this packet as their
implementing packet. Nothing else owns the label catalog editor at all.
**Do:** (a) the three typed accepts — project-update → the existing filing path; schedule → a
proposed task via `POST /api/v1/tasks` (`source:"email"`); warranty → the same task path with
the callback framing. (b) The dedicated **AI assistant Settings section**, executing spec §12
decision 5's three recorded re-points (`tests/ai08-ui-contract.test.mjs:113-126`, spec §9's
canonical placement line, the Workstream G house rule) and decision 6's settings-card
data-at-rest statement. (c) The **label catalog editor**: storage per the plan's Pattern A
(row per label), opaque-slug enums, the never-delete-once-used lifecycle, description
versioning consumed by AI-10's re-analysis path, and the full injection-mitigation set the
plan records (fence-forgery rejection, NFKC + bidi stripping, admin-only write path, count and
length caps, a hostile-description test proving the no-send/no-file guarantees hold).
(d) **The AI activity view** (owner requirement, July 26 — previously unowned): inside the new
AI section, a bounded read-only view over the stored analyses answering "what did the AI
suggest, what was accepted or dismissed, and by whom" — proposals with their rationale,
outcome status, label-definition version, and per-label accept/dismiss counts. This is the
transparency layer the persistence decision exists to enable, and it doubles as the §6
calibration evidence the spec requires before any auto-apply may ever be proposed. Reads only;
**no new table** — but see the amendment below, because "by whom" is not free.

**AMENDED July 30, 2026, before dispatch — sub-scope (d) asserted a premise that does not
hold.** The packet claimed the stored rows "already carry everything". Verified against
merged AI-10 source on main, that is true for every clause **except attribution**:

- `mail_items` carries `analysisPayload`, `party`, `confidence`, `contentHash`,
  `labelDefinitionVersion`, `attemptedLabelDefinitionVersion`, `subject`, `sender`,
  `receivedAt`, `status`, `matchReason`, `suggestedProjectId`, `approvedProjectId` — so
  proposals, rationale, outcomes, label version, and per-label counts are all answerable.
- `MAIL_ITEM_STATUSES` already contains `accepted` and `dismissed`, so outcome state exists.
- **There is no actor anywhere on the review path.** `mail_items` has no actor column;
  `dismissNeedsReview(id, connectionKey, updatedAt)` (`app/ports/mail-item-repository.ts:38`)
  takes none; and the only `activity_events` write in
  `app/api/v1/inbox-analysis/route.ts:207` is the
  `assistant.inbox_analysis_provider_call` rate-limit counter, **not** a review-outcome
  audit. `approvalActor` belongs to `gmail_file_archives`, a different table on a different
  path.

**Resolution (owner requirement preserved rather than silently dropped):** (d) additionally
adds **additive `reviewed_by` and `reviewed_at` columns on `mail_items`** and threads the
actor through both the accept and the dismiss paths. Both call sites already hold the email
from `requireOfficeUser`, so this is a parameter thread plus one additive migration — the
same shape as AI-10's own additive migration, and it keeps the "no new table" constraint
literally true. Without it the review audit is anonymous, which is the one thing an
attribution view cannot be.
**Files:** verified against main July 30, 2026 (post-#248/#249/#250). (b) must re-point
**two** assertions in `tests/ai08-ui-contract.test.mjs`, not one — the eight-name
`SETTINGS_SECTIONS` deep-equal **and** the adjacent
`assert.doesNotMatch(navigation, /AI assistant/iu, "AI-08 must not add a Settings section")`.
Confirmed still present: `TASK_SOURCES` includes `"email"` (`app/domain/task.ts:7`), so (a)'s
schedule and warranty accepts need no domain change.
**Dispatch as sub-PRs, not one large PR** — the AI-10 precedent (a+b+c → d+e → f) exists
because a large AI packet is unreviewable in one pass. Recommended order: **(a)** typed
accepts, self-contained and the highest value since the queue currently accumulates three
intents with only a manual dismiss → **(b)** the Settings section and its two re-points →
**(c)** the label catalog editor, which is the security-sensitive half and deserves its own
review → **(d)** the activity view last, since it reads what (c) writes.
**Accept:** every queue intent has a typed accept; the AI section exists with the three
re-points made deliberately; label CRUD round-trips with a used label refusing deletion and a
retired slug never reissued; a hostile label description cannot alter guard guarantees;
the activity view renders proposals with outcomes and rationale from stored rows only, with
honest empty states and zero provider calls; **every accept and dismiss records the acting
user, and the activity view shows it** — a review row whose outcome changed with no
`reviewed_by` fails this packet, since an anonymous audit is the one thing an attribution
view cannot ship with;
`npm test`, `npm run test:e2e`, `npm run lint` all named with outcomes.
**Effort:** large. **Cost:** provider spend within the existing budget.

# Workstream H — In-app guidance (HINT)

Owner-approved July 23, 2026 (forms-only decision). Design authority:
`docs/infohint-audit-2026-07-24.md` — the curated table is normative. HINT-01
and HINT-02 are complete; HINT-03 is the final closure packet. Source contains
only the 12 recommended rows (9 original + 3 sequenced after AI-08), all with
verbatim mutation-pinned copy. Optional rows still need a fresh owner opt-in,
rejected rows stay rejected, and label fixes stay out of hint work. The
forms-audit initiative uses **12/20** hints. The 21 pre-existing Google
Workspace setup-flow hints are grandfathered outside that budget; WS-10's later
Operations health hint is also outside this forms-only initiative.

### HINT-01 · InfoHint generalization (small-medium; takes the globals.css lock briefly, in a free window after DES-04/05/07)
**Status:** Complete — PR #168 + PR #171, July 24, 2026. Source-only and undeployed. #168 relocated the primitive to `app/components/` with byte-identical rendering (pure selector rename, property-identical declarations) and added left/right/auto anchoring — adoption wiring is HINT-02's scope by design. #171 (the automated-review follow-up) scoped the legacy mobile geometry to `.workspace-setup-stage` so shared and future modal contexts keep a local containing block, proven by a 390×844 modal-fixture e2e, and corrected the runtime census to 21 mounted usages. Guide impact: none.

**Why:** `WorkspaceInfoHint` is styled by global `.workspace-info-hint*` classes
named for the setup surface and its tooltip anchors bottom-right (`right:0`),
which clips on full-width/left-column form fields — 7 of the 12 recommended
placements need anchoring flexibility.
**Do:** move/rename the `.workspace-info-hint*` styles to a shared or
module-scoped form; add left/right/auto tooltip anchoring; relocate the component
to a shared components path.
**Accept:** the 21 existing Settings→Google Workspace usages render
byte-identically; `tests/workspace-setup-guidance.test.mjs` pins and the e2e
stepper tooltip assertions stay green with mutation-sensitive updates only where
class names change.

### HINT-02-A · Adoption, extracted modules (small, after HINT-01)
**Status:** Complete — PR #177, July 24, 2026. Source-only and undeployed. Opus fleet clean: all seven recommended-tier hints byte-verbatim from the audit table with correct anchors, AI-08 composition pins undisturbed, usage census honestly 21→23. Review fix (6a4d209) made the AccessibleOverlay Escape guard panel-scoped so hover-opened tooltips consume Escape before the modal closes, e2e-proven both paths. Guide impact: none.

**Do:** the recommended-tier hints in `WorkspaceBlueprintEditor` (closes the
settings-redesign-spec §4.1 mandate) and `InboxRulesPanel`'s RuleModal; the three
WorkspaceDefaultsPanel reminder-hours hints WAIT for AI-08's merge (contended
file) and for SET-06's wiring fix (their copy must describe the fixed behavior).
**Accept:** audit-table copy verbatim, pinned; tooltip a11y (focus/Escape) per
the existing e2e pattern.

### HINT-02-B · Adoption, FloorOpsApp modals (small; ONE FloorOpsApp queue slot at the tail, after AI-02)
**Status:** Complete — PR #262, July 31, 2026. Source-only and undeployed. All five recommended-tier hints shipped with verbatim audit copy and placement-specific anchors, mutation-pinned. Golden hashes byte-identical, verified on the combined tree alongside DES-11(B). Two guards were added beyond the packet's ask: the forms-audit budget is now **mechanically enforced** (`previousFormsAuditHintCount + hints.length <= 20`, currently 12/20) rather than merely stated, and the FollowUpResultModal exclusion is asserted as an **absence** (`doesNotMatch(followUpResultModal, /<WorkspaceInfoHint\b/)`) so the label-fix routing cannot be quietly reversed. **The `app/FloorOpsApp.tsx` queue slot is free again.**
**Do:** the recommended-tier hints in LeadModal, ClientModal, and
NewProjectModal per the audit table — written against post-DES-05/07 component
names. (FollowUpResultModal's "Post-installation callback" is a LABEL FIX per
the audit, not a hint — routed via the findings label-fix track, not this
packet.)
**Accept:** audit-table copy verbatim, pinned; golden hashes unchanged (modals
sit outside the hashed containers); axe green.

### HINT-03 · Pinning + closure (small, last)
**Status:** Complete — PR #273, August 1, 2026. Source-only and undeployed.
**Do:** one representative e2e tooltip-semantics assertion per new surface
family; verify the ≤20 initiative budget holds (audit-scope hints only; grandfathered setup-flow hints excluded); flip Workstream H statuses; reconcile the
audit doc.
**Accept:** every shipped hint copy-pinned mutation-sensitively; ledger and
audit agree.

---

## Sequencing at a glance

**Start now, in parallel (no owner input needed):**
OIDC-04 is complete in PR #49, with its closure guarded by PR #50. OIDC-02 and OIDC-03
are complete in source in PRs #54/#55.
TRK-02 is complete in PR #66.
BE-09 is complete in source in PR #51 and remains undeployed.
BE-12 is complete in source in PR #53 and remains undeployed.
KPI-02 is complete in source in PR #52 and remains undeployed. SET-10 is complete in
source in PR #56 and remains undeployed. The application-logo refresh is complete in
merged source in PR #57 and remains undeployed; the reviewed PR #51–#57 merge train is
complete. KPI-03 and SET-13 have since completed (PRs #75/#76). Of the Workstream E starters, GI-02
completed in PR #79 (July 21, 2026); GI-01 and GI-05 remain assignable in parallel with the
SET track once their listed dependencies are met.

> **Dispatch authority — read this before picking work.** Do **not** treat any
> "unclaimed packets" sentence in this document as a list of available work. Those lists are
> historical narrative and have gone stale repeatedly — they have named merged packets
> (BE-07, SET-11, WS-13, GI-02) as available for days. **A packet is available if and only
> if it has no status line.** The status lines are the single dispatch authority, and they
> are the only part of this file a test enforces.

All work here is source-only; none authorizes external configuration, apply, deployment,
live login, another user, or real data.

**Chains:** BE-02→BE-03 · BE-06→BE-07→(coordinate SET-05) · BE-04+BE-06→BE-09→BE-10 ·
BE-06→BE-12 · BE-08+BE-09+BE-11→BE-14 · SET-01→SET-02→{SET-03..SET-12} ·
SET-03→SET-10 · SET-04→SET-11 · **EDIT-01→EDIT-03→{EDIT-05, EDIT-04, EDIT-06, EDIT-07}**
(EDIT-01 and EDIT-03 share four lead files — leads route, lead port, both lead adapters — so
they serialize; EDIT-01→EDIT-04 also holds) · OIDC-01→OIDC-02→OIDC-03. OIDC-04 was the
documentation/guard reconciliation; it is complete in PRs #49/#50 and does not change
the runtime dependency chain.

**Owner track (sequential):** WS-01 → WS-02 → WS-05 → WS-06 → WS-07 → WS-08 → WS-09(live
half) → WS-11. Agents should never be blocked idle on this track — every agent item above
is schedulable independently.

**Merge-conflict hotspot:** `app/FloorOpsApp.tsx`. Do not run two packets that touch it
concurrently. PR #33 (actionable lists), PR #35 (SET-01), PR #37 (SET-02), PR #41
(KPI-01), and PR #52 (KPI-02) are merged source-only, and KPI-03 (#75), GI-03 (#80),
and SET-35 (#107) have since cleared the queue. Whichever packet next takes the
`FloorOpsApp.tsx` slot must preserve the extracted
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

**Wave 2 — current:** PRs #51–#57 are merged and the BE-09, KPI-02, BE-12, SET-10,
OIDC-02/OIDC-03, and application-logo refresh completions are recorded. The reviewed
merge train and its post-merge tracking flips are complete; the shared-UI browser reruns
are green.
The dashboard-setup track starts now: SET-13 → SET-14 (SET-19 parallel), then
SET-15 → {SET-16, SET-17, SET-05} → SET-18 → SET-21, with SET-23…SET-26 following
their listed dependencies. Workstream E runs in parallel where dependencies allow:
GI-01/GI-05 after their SET dependencies (GI-02 completed in PR #79); GI-03/GI-04 after the
WS-15 owner step; GI-06 after WS-16's edition confirmation; GI-07 after live employee
login. **Owner priority (July 21): maps and validation on the client and project
screens (GI-03/GI-04) and first-run data import (SET-25) jump the queue.** The
`FloorOpsApp.tsx` single-file queue order is now KPI-03 → GI-03 → GI-04 → SET-22 UI →
SET-26 UI, and the setup track prioritizes SET-14 → SET-15 → SET-16 → SET-25, with
SET-27 and SET-28 following their listed dependencies. WS-15 (Maps billing/keys) is
the owner step that unblocks GI-03/GI-04 — do it early.
BE-10 was assignable because PR #51 merged and has since completed (PR #82); BE-14 has
since completed too (PR #178, July 24, 2026). KPI-03 was assignable because PR #52
merged and has since completed (PR #75). SET-13 is assignable because SET-03, SET-04, and SET-10 are complete. BE-07 (PR #140),
SET-11 (PR #162) and WS-13 (PR #144) have since completed. **For what is actually available
now, read the status lines — see the dispatch-authority note above; do not dispatch from this
paragraph.**

**Design-remediation wave order (approved July 21, 2026 — anti-rework):** the
full-codebase review and the settings redesign run in four waves so nothing is built
twice. **R1** — full-review foundation fix packets (FIX-01…FIX-06 plus FIX-10 in
`docs/full-review-2026-07-21-findings.md`) that touch shared primitives, config
layering, or test infrastructure. **R1 completed July 22, 2026 (PRs #95–#112,
reviewed and flipped), so R2 is unblocked and active.**
**R2** — the SET-29 → SET-34 stage-shell series (design authority:
`docs/settings-redesign-spec.md` + approved wireframe; strictly one packet at a
time — all six touch `GoogleWorkspacePanel.tsx`). **R3** — remaining full-review fix
packets that touch settings UI, built on the new frame (FIX-07, FIX-08). **R4** — the
feature queue resumes stage-native, plus FIX-09, the production-only FIX-11
(anonymous login-flow throttle), and the FIX-12 consolidation + residual sweep. Settings-UI packets that would add cards to the old layout
(SET-23 viewer placement, SET-24, SET-27 card) WAIT for SET-29; engine-side packets
(SET-17, SET-18, SET-21, SET-25, GI-04, and the FloorOpsApp queue) are unaffected
and proceed in parallel with R1-R3.

**AI wave (Workstream G, approved July 23, 2026; order updated July 24,
2026):** the backend chain AI-01 → AI-03 → AI-08 → AI-07 is fully MERGED and
AI-07 is COMPLETE (PR #185 + PR #195, July 25, 2026 — do not re-claim the
merged sub-PRs). AI-02 is COMPLETE (PRs #182/#187/#193, July 24, 2026) and
the FloorOpsApp queue slot is RELEASED. NFIX-03 (PR #197) and BE-16 (PR #198)
both MERGED July 25, 2026. AI-04 (PR #201), AI-05 (PR #205), and FIX-15
(PR #206, with the N7-7/N7-8 folds) and FIX-17 (PR #208) are COMPLETE —
AI-06 (PR #212) and SET-25 (PR #213) are COMPLETE as of July 26, 2026, and
**AI-09 (PR #216) is COMPLETE**, so the original AI feature series AI-01→AI-09 is
fully merged: AI-09 closed it by reconciling one truthful account of what the AI
does, what is production-gated, and every residual the series recorded.
**AI-10 is a new packet opened after that closure**, on a recorded owner decision
of July 26, 2026 (`docs/ai-assistant-spec.md` §12). Adding a packet after the
closure packet is a deliberate convention break, called out here rather than made
silently: AI-09 closed the *reconciliation* of AI-01→AI-08, not the workstream's
capacity to take new work. AI-10 is **the dispatchable head of the AI lane** and
is unblocked now that PR #216 has merged.
**SET-22 is the dispatchable head of the FloorOpsApp fix-tail** (SET-26 remains
gated on SET-23, open); SET-18 was drafted as a paste and is dispatchable in
parallel with it. `tests/rendered-html.test.mjs` stays additive across all
lanes — serialize merges only. DES-08's
remaining sub-scope c stays owner-deferred awaiting a truthful attention
signal — AI-02 and AI-04 completed **without** landing one (the Chat
notification boundary doc recorded that gap as catalog-only until AI-10 d+e
supplied the trigger); the durable
needs-review count **AI-10** stores is that signal, so DES-08c unblocks after
AI-10, not the reverse (no cycle). Contended-file flags: `WorkspaceDefaultsPanel.tsx`
= AI-08; the Chat notifier/user-settings/ChatNotificationSettingsCard trio was
AI-07b's (released at the PR #195 merge); `tests/rendered-html.test.mjs` is
touched additively by the AI packets — serialize merges. DES-10 (brand refinement, not priority) takes the globals
lock only for its `.brand` edit, in a free window after DES-04/05/07. Migration numbers are assigned at merge time by reading
the current high-water mark, never by quoting one from a document — see global guardrail 3.
The three packets this line used to name as open (BE-07's reserved v7, KPI-04, DES-08 a-T2)
have all merged; as of July 26, 2026 the marks are **PostgreSQL v10** and **D1 0019**.

**Owner/Brett track (calendar time — start nudging now):** Brett's read-only GCP
inventory + Workspace resource verification (WS-01/WS-02, checklists 01/02) are the only
things gating the live data connection. Jason must review that inventory before any API,
IAM, billing, OAuth, or Admin-console change. The agent packets above proceed without
those inputs; Jason's other open decisions live in checklists 00/06/10.

**FloorOpsApp single-file queue (one packet at a time):** PR #33 (actionable lists) →
SET-01 / PR #35 → SET-02 / PR #37 → KPI-01 / PR #41 → KPI-02 / PR #52 → KPI-03 /
PR #75 → GI-03 / PR #80 → SET-35 / PR #107 are complete in source. The reconciled
queue order is FIX-07 → GI-04 → DES-06 → DES-05 (absorbs FIX-08) → DES-04 →
DES-07 → DES-08 (b/c/d/a-T1) → AI-02 (a→b→c, one slot) → SET-22 UI (in flight, PR #217/#221) →
**EDIT-05** → **EDIT-04** → **AI-10 sub-PR (f)** → **EDIT-06** → **EDIT-07** →
SET-26 UI (blocked on SET-23) → HINT-02-B.

> **Reordered July 27, 2026 (owner decision + devils-advocate review).** Three deliberate
> changes from the previous order: (1) **EDIT-05 (projects) now precedes EDIT-04 (leads)** —
> owner decision of July 27: the owner's original report was project fields, the audit rates
> projects Critical vs leads High, and cheapest-first was the wrong sort key. (2) **EDIT-04
> precedes AI-10 sub-PR (f)**: the "identical change" the implement-once note described is one
> prop; the real work diverges — EDIT-04 does the LeadModal rework (initialValues, edit mode,
> conflict UX, isAdmin gating) and AI-10 (f) consumes it, adding prefill state and an InboxView
> opener prop (LeadModal is file-local and unexported; InboxView has no opener today — AI-10
> (f)'s Files description undercounted this). (3) **SET-26 UI moved behind the EDIT block**: a
> queue-head packet with an unmerged prerequisite (SET-23 is unstarted) **yields its slot,
> recorded here, never silently** — that rule is now standing.
AI-02 is complete in PRs #182/#187/#193 and released the slot; AI-09 is a
docs/tests-only closure packet and does not claim `app/FloorOpsApp.tsx`.

> **This list is the claim order, and it must stay complete.** Until July 27, 2026 it ended at
> `SET-26 UI` and named no packet filed after AI-09 — while AI-10 sub-PR (f) and EDIT-04…07 all
> list `app/FloorOpsApp.tsx` in their Files and EDIT-04 calls itself "the merge-conflict hotspot;
> takes one queue slot". Combined with the dispatch law ("a packet is available if and only if it
> has no status line"), **two agents could legitimately claim this file at the same time** — the
> exact collision `AGENTS.md:54-58` names as its canonical example. Any packet that adds a
> `FloorOpsApp.tsx` change must be added here in the same PR that files it.
>
> **Implement once, not twice:** AI-10 sub-PR (f) and EDIT-04 both specify the *same* source
> change — an `initialValues` prop on `LeadModal` (`app/FloorOpsApp.tsx:1572-1574`). Whichever
> reaches the slot first ships it; the second consumes it and says so. See "Cross-item
> coordination (implement once)".

Interleave other SET items only in extracted modules that do not
touch `FloorOpsApp.tsx`. Workstream D's KPI packets are
otherwise independent of the BE/WS tracks (KPI-04 coordinates PostgreSQL migration
version numbers with BE-06).

**Cross-item coordination (implement once):** multi-key token decryption is complete in
BE-08 / PR #45 under WS-04's documented boundary; calendar-ID single authority remains
SET-05 ↔ BE-07; integration events reader remains SET-09 ↔ WS-10;
`GOOGLE_WORKSPACE_PUBSUB_TOPIC` removal (WS-03, referenced by BE-02); version-37 doc fixes
(BE-01, referenced by WS-03; preserve accurate historical release evidence);
**`LeadModal` `initialValues` prop (`app/FloorOpsApp.tsx:1572-1574`) remains AI-10 sub-PR (f)
↔ EDIT-04** — both packets specify the identical change, the earlier one through the
FloorOpsApp queue ships it, and the later one consumes it and records that it did.

## Enhancement & follow-up backlog (single home — added July 28, 2026, owner request)

The owner's product-level roadmap remains
[`docs/ui-and-product-readiness-review.md`](ui-and-product-readiness-review.md) (steps 1–13,
"Next: lead-to-closeout operations", "Later: automation and intelligence") — this section does
NOT copy it. It is the single home for **review-born and research-born items that would
otherwise be owned by nobody**. Rules: each item is ONE line + a pointer; when an item gains a
packet, replace its line with the packet id; nothing here is dispatchable (the status lines
remain the only dispatch authority).

**Now owned (recently resolved from this list):**
- AI activity view (owner transparency ask, July 26) → **AI-11 (d)**.
- Filed-email read decoupling (per-user Gmail increment 1) → **WS-18**.
- Offboarding credential severance → **WS-17**. Doc-pin fragility → **FIX-20** (findings ledger).

**Unfiled — engineering candidates (source in parentheses):**
- **Durable employee identity foundation** — the unlock for real capability enforcement,
  per-user OAuth, and project-level permissions alike (the July 27 research's unifying
  finding); file as its own wave when the owner green-lights it.
- Per-user Gmail stages beyond WS-18: per-user OAuth connect, per-mailbox readiness, the
  mailbox picker, multi-mailbox attach (plan PART 5; blocked on identity).
- Refresh-token caching — every Gmail request performs a live, non-retryable refresh grant
  (PART 5 research); a rate-limit problem at ~20 users.
- Un-file path for a mis-filed email — `gmail_file_archives` has no reversal; misfiles are
  permanent (July 27 devils-advocate).
- Lead conversion as one transaction (roadmap step 8) — natural EDIT-08 once EDIT-06/07 land.
- Meetings editing — filing condition met (EDIT-03 shipped through EDIT-04/05); awaiting the
  owner's word to file.
- Client-status semantics (archived clients selectable in pickers; status is display-only
  everywhere) — enhancement candidate from the EDIT-05 review.
- Gmail Workspace Add-on ("the flagship",
  [`docs/google-integration-opportunities.md`](google-integration-opportunities.md)) — filing
  where staff already read mail; strategic option, not scheduled.

**Orchestrator to-dos (not Codex):**
- ~~Amend GI-01 before any dispatch~~ — **done July 29, 2026.** Its "existing scheduled
  Sheets reads" premise was false (no scheduler exists and repo law forbids one); the
  packet now specifies an on-demand admin-triggered read with a durable watermark, on the
  AI-10 precedent. GI-01 is dispatchable.
- Nightly-review program: nights 2–5 and 9–10 remain pending the owner's kickoff, but the
  enshrine-vs-retire decision is **settled — the owner chose enshrine, July 30, 2026.**
  Their specs now live in `docs/nightly-reviews/SPECS.md` rather than in a chat session, so
  a kickoff no longer depends on a transcript surviving. Those six specs are **reconstructed
  from the program rules and the four completed nights, not recovered verbatim**; judgement
  calls are marked `[reconstructed]` and the owner's memory outranks the file. The program
  rules and co-run matrix in `docs/nightly-reviews/README.md` are recovered and
  authoritative.

**Open owner decisions (recorded homes only when decided):**
- Flooring-specific intents: selection/sample decision; change-order/approval (plan PART 1).
- Party axis: routing signal or display-only (plan PART 1).
- Cross-mailbox viewing: confirm with counsel before enabling anything beyond
  attach-by-sign-in (plan PART 5).

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
