# Full-codebase review — July 21, 2026 — findings ledger

**Review target:** pinned commit `58e4498` (origin/main as of July 21, 2026; two docs
commits behind current main, which adds only PR #89's reviewed follow-ups).
**Method:** nine review lenses. Six ran as independent Opus agents (D1
schema/migrations, UI honesty, test health, Google mutation safety, config layering,
simulation parity); the dev-surface authorization matrix and the API-consistency
census were performed inline by the orchestrating reviewer. The final two lenses
(production employee-router authorization composition; architecture/duplication)
completed on July 22 — their results are in the **Addendum** below, making coverage
nine of nine. P0–P2 candidates were adversarially verified by independent refuter
agents where quota allowed; where a verifier could not run, the verification column
says who verified (Fable = orchestrator checked the claim directly in the tree) or
PLAUSIBLE (reported evidence is concrete but independently unconfirmed).

**Overall verdict: sound.** No P0. The codebase's core guarantees hold under
whole-app scrutiny: zero Google deletion surface repo-wide, leases/idempotency on
mutation paths, review-first preserved everywhere, migration chain fully consistent,
server-side authorization correctly ordered on all 36 dev routes, honest UI state
almost everywhere. The real theme is **integration drift between separately-built
packets**: newer layers (editable blueprint, registry/effective config) landed while
three older consumers kept reading the world as it was before them. Those are the
P1s, and they are exactly what this review existed to catch before the remaining
packets compound them.

---

## Confirmed findings

### P1 — wrong behavior that will bite when the feature is first used

**F-1 · Project provisioning ignores the editable blueprint** (mutation-safety lens;
adversarially VERIFIED)
`app/lib/google-drive.ts` `provisionProjectFolders` locates the top-level roots by
the HARDCODED literal names `"01_Client Accounts"` / `"02_Projects"` (name-only
match, no `fciRootKey` identity) and builds every project subfolder from the static
`DRIVE_BLUEPRINT` seed instead of the persisted blueprint. The rename route lets an
admin rename those same owner-managed roots. After a rename, the next provisioning
call finds no name match and silently creates a **duplicate root tree**; all
subsequent projects file under the un-managed duplicate. Admin blueprint edits to
project subfolders are likewise ignored. (No data loss; containment still holds.)

**F-2 · All five Gmail routes gate on raw config, bypassing effective config**
(config-layering lens; adversarially VERIFIED)
`app/api/v1/integrations/google/gmail/_route-helpers.ts` `getWorkspaceGmailClient`
reads `getGoogleRuntimeConfig()` and gates on raw `oauthReady`, so app-saved
(registry) configuration is invisible to the entire Gmail feature — the
app-saved > env precedence contract breaks on this surface.

**F-3 · Both Calendar routes read raw config and the raw calendar ID**
(config-layering lens; adversarially VERIFIED)
`calendar/events` and `calendar/test-hold` gate on raw `oauthReady` and pass raw
config to the calendar client, which reads `config.clientAppointmentsCalendarId` —
registry-saved calendar configuration is ignored.

**F-4 · Create-time directory mirroring reads the env-only sheet ID**
(config-layering lens; adversarially VERIFIED)
`clients/route.ts:49` and `projects/route.ts:74` pass `getGoogleRuntimeConfig()` to
`trySyncGoogleDirectory`, which reads `clientDirectorySheetId` — a client-directory
sheet created through setup and recorded in the registry is not seen by the
create-time mirror path.

### P2 — should fix, not urgent

**F-5 · `credentialsPresent` semantics conflated in the workspace summary**
(config-layering; VERIFIED) — `google-workspace/route.ts` computes
`credentialsPresent`/`configured` from effective `oauthReady`, conflating "an admin
could connect" with the summary's stronger claim. Align to the
`connectReady`/`oauthReady` split.

**F-6 · Simulation omits the integration-audit rows live paths emit**
(simulation-parity; verified by Fable) — the simulation branch of Gmail filing
writes only an `activity_events` row and returns; the live path also writes
`google_integration_events` (`gmail.archive_approved`/`archive_filed`). The
integration-audit surface is therefore empty in simulation and diverges from live.
Calendar simulation paths show the same pattern.

**F-7 · Browser e2e never exercises the simulation backend** (simulation-parity;
verified by Fable) — 31 `page.route` stubs across the e2e suite intercept
`/api/v1/integrations/google/**`, so the simulation backend — built to be the
deterministic e2e substrate — is bypassed in every browser test that touches Google
integration.

**F-8 · No simulated twin for the concurrency-guard failure mode**
(simulation-parity; PLAUSIBLE) — the live "operation already in progress" 409
(lease conflict) has no simulation equivalent in Gmail filing or project
provisioning, so that contract cannot be regression-tested in simulation.

**F-9 · CI runs the full pipeline twice per codex/** push with an open PR**
(test-health; PLAUSIBLE, static read of `ci.yml` triggers/concurrency) — `push:
[main, codex/**]` plus `pull_request` with a ref-keyed concurrency group ≈ double
25-minute Chromium jobs on the primary dev branches.

**F-10 · The tracking guard is brittle by construction** (test-health; PLAUSIBLE,
consistent with maintenance experience) — `task-tracking-docs.test.mjs` re-encodes
verbatim prose from ~19 docs as regexes and pins exact test counts; the next
legitimate test addition breaks it.

**F-11 · The same mode/connection state renders nine times in the Workspace panel**
(UI honesty; enumerated at lines 574-577, 601, 605, 607, 638, 648, 662, 668, 669,
from three independently loaded endpoints that can transiently disagree) —
**remediated by the SET-29…SET-34 series** (`docs/settings-redesign-spec.md`); no
separate FIX packet.

**F-12 · One backend enum, three label mappings, two of them leaking raw values**
(UI honesty; VERIFIED evidence) — `mirror.clients.status` renders as polished labels
in FloorOpsApp, raw enum fall-through in DirectorySyncPanel, and always-raw in
GoogleWorkspacePanel Step 5; three drifted local `SheetMirrorStatus` type
re-declarations.

**F-13 · Admin gating has two sources of truth** (UI honesty; VERIFIED evidence) —
nav affordances gate on the static `accessLabel` server prop while content gates on
the mutable `isAdmin` state seeded from `/settings/me`; the two derive from the same
config today but travel different transports and can desync.

### P3 — nits (bundled into FIX packets below)

- Migration 0008 contains the chain's one destructive `DROP COLUMN` (historical,
  absorbed); the migration guard checks only individually named migrations, so a
  future destructive statement would pass silently. (D1 lens)
- Calendar test-hold is the one Google mutation neither leased nor
  idempotent-by-identity (double-submit creates duplicate private test events).
- Blueprint-spreadsheet reuse-by-identity skips the containment check in My Drive
  (non-shared-drive) mode — the only managed-resource resolution that trusts
  identity without verifying workspace containment.
- The same physical root folders are stamped `fciWorkspaceFolder` by provisioning
  but `fciRootKey` by ensure-roots (fold into FIX-02).
- `google-workspace` POST (pure folder-name planner) is the only POST without
  `requireSameOrigin` — no CSRF risk (no mutation), breaks the uniform invariant.
  (Fable inline)
- Eight data routes lack `Cache-Control: no-store` (clients, dashboard,
  filing-rules ×2, google-workspace, connection, leads/[id], uploads). (Fable census)
- `assistant` and `meetings` hand-roll the 9 KB/180 KB body bounds instead of the
  shared `parseBoundedJsonObject` (correct behavior, duplicated pattern). (Fable
  census)
- Simulation reset clears eight tables but not simulation-authored
  `activity_events` rows (verified against the reset route).
- `drive/verify` has minor status-shape divergences between simulation and live
  responses.
- FloorOpsApp honesty polish: Planned state rendered as plain subtitle text in one
  panel vs the badge elsewhere; decorative chips styled as data (constant "Working"
  meetings stat, static `trend="Current"` ×4, notifications popover with no feed);
  error state shows "Loading current totals" copy.
- e2e: fixed 3.5 s sleep asserting non-auto-dismiss; CI `retries: 1` masks flaky
  specs with no retry surfacing; real-Postgres suites skip on
  `GITHUB_ACTIONS !== "true"` instead of keying on `TEST_POSTGRES_URL`.

## Refuted / not defects

- Suspected Inbox privacy leak of the connected account: already masked at the
  source (`google-oauth.ts`) — consistent, not a leak.
- Suspected dev auto-create vs migrations drift: `ensureWorkspaceSchema` is a
  deliberate no-op; a guard asserts zero runtime DDL. Not a defect.
- Sheets `:clear` usage: wipes only cell contents of the app-generated Project
  Register tab (D1 is source of truth); no file deletion surface exists repo-wide.

## Coverage statement (honest)

Fully reviewed: Google write paths (google-drive.ts in full + all mutating routes),
config chain (every `getGoogleRuntimeConfig` caller classified), D1 chain 0000–0016 +
PG v1–v6 (static), FloorOpsApp.tsx in full + settings panels, e2e suite health, all
36 dev routes' auth/origin/rate-limit composition (inline), bounded-body and
no-store census (inline); production `employee-request-router.ts`,
`authorization-service.ts`/`authorization-policy.ts`, `request-rate-limit.ts`,
`employee-oidc.ts`, and `secure-session-transport.ts` in full (Addendum). NOT
reviewed: internals of the Postgres authorization/identity repository adapters
(treated as per-PR-reviewed black boxes), chat notifier internals beyond its send
path, PG statement modules byte-level, deep payload-shape diffs of every endpoint
consumer.

---

# FIX packets (build order: R1 → R3; R2 is the SET-29 series)

Rules: every packet follows the global guardrails in
`docs/agent-plan-architecture-workspace-and-setup.md` (secrets, fail-closed, honest
UI, append-only migrations, never-delete, simulation parity, server-side authz,
review-first). All acceptance criteria are mutation-sensitive: a test must fail if
the fix regresses.

## Wave R1 — foundations (assignable now, in this order where files overlap)

### FIX-01 · Route Gmail, Calendar, and create-time mirroring through effective config (P1s F-2/F-3/F-4 + P2 F-5; medium)
**Status:** Complete — PR #95, July 22, 2026. Source-only and undeployed.
**Why:** the app-saved > env precedence contract breaks on three surfaces; registry
configuration recorded by setup is invisible to Gmail entirely, to Calendar, and to
the create-time directory mirror.
**Do:** in `gmail/_route-helpers.ts`, `calendar/events`, `calendar/test-hold`,
`clients/route.ts:49`, `projects/route.ts:74` (and the calendar client's
`clientAppointmentsCalendarId` read), resolve configuration through the effective
config (`getEffectiveGoogleRuntimeSetup`), preserving `getGoogleRuntimeConfig` as
the untouched base per SET-14. Fix `credentialsPresent` in
`google-workspace/route.ts` to the `connectReady`/`oauthReady` split semantics.
**Accept:** for each surface, a test that saves an app-level value (registry sheet
ID / calendar ID), leaves env unset, and proves the feature sees it — and the
reverse (env-only still works); `credentialsPresent` asserted against both
readiness states; existing route tests stay green.
**Effort:** medium. **Cost:** $0.

### FIX-02 · Blueprint-aware project provisioning with one identity-stamping scheme (P1 F-1 + stamping/containment P3s; medium)
**Status:** Complete — PR #97, July 22, 2026. Source-only and undeployed.
**Why:** provisioning forks the Drive tree after any root rename or blueprint edit —
the exact silent-drift failure the workspace registry exists to prevent.
**Do:** `provisionProjectFolders` resolves the client-accounts/projects roots by
`fciRootKey` identity via the registry/effective config (same resolution
`ensure-roots` uses), falling back to blueprint-current names — never hardcoded
literals; project subfolders build from the persisted blueprint, not the static
seed. Unify appProperties stamping so the same physical folder carries one identity
scheme (`fciRootKey`), keeping legacy `fciWorkspaceFolder` values readable. Add the
missing containment check when reusing a blueprint spreadsheet in My Drive mode.
**Accept:** simulation e2e — rename a root, then provision a project: no duplicate
root is created and the project files under the renamed root; blueprint subfolder
edit reflected in the next provisioned tree; a stamped-but-moved-outside
spreadsheet is rejected (containment); never-delete grep-guards unchanged.
**Effort:** medium. **Cost:** $0.

### FIX-03 · Simulation audit + failure-mode parity, and complete reset (P2s F-6/F-8 + reset/status-shape P3s; small-medium)
**Status:** Complete — PR #100, July 22, 2026. Source-only and undeployed. Residual
follow-up recorded: project Drive provisioning still hand-rolls divergent
`google_integration_events` types between modes (out of this packet's stated scope);
fold into a later parity/uniformity packet.
**Why:** the integration-audit surface is empty in simulation and the lease-conflict
409 has no simulated twin, so two live behaviors cannot be seen or regression-tested
without a real Google account — contrary to the simulation-parity law.
**Do:** simulation branches of Gmail filing (and the calendar/sheets paths that
diverge) write the same `google_integration_events` rows as live; add a simulated
in-progress state so the 409 lease-conflict contract is testable; simulation reset
also clears simulation-authored `activity_events`; align `drive/verify`
status shapes between modes.
**Accept:** parity test asserting identical event-row emission (type/entity/detail
shape) in both modes for filing; a test reproducing the 409 in simulation; reset
test proving zero simulation residue across all touched tables; shape test for
drive/verify.
**Effort:** small-medium. **Cost:** $0.

### FIX-04 · Test-infrastructure repairs: CI double-run, guard sustainability, flake hygiene (P2s F-9/F-10 + e2e P3s; small-medium)
**Status:** Complete — PR #103, July 22, 2026. Source-only and undeployed.
**Why:** CI wastes a full duplicate pipeline per codex/** push; the tracking guard
breaks on routine additions; retries mask flakes; two suites gate on the wrong
signal.
**Do:** scope `ci.yml` so a push to a codex/** branch with an open PR runs once
(trigger or concurrency-group fix); tracking guard — remove pinned test counts and
over-verbatim regexes in favor of structure-level assertions (keep the status-line
and heading-format laws); surface Playwright retries (fail or annotate when
`test.info().retry > 0` passes); replace the 3.5 s sleep with a deterministic
no-auto-dismiss assertion; key the real-Postgres suites on `TEST_POSTGRES_URL`
presence (still on in GitHub CI).
**Accept:** one pipeline per codex push+PR (workflow-run evidence in the PR);
guard passes unchanged on a synthetic new-test-file addition; a forced flaky spec
demonstrably surfaces; postgres suites run locally when the URL is set.
**Effort:** small-medium. **Cost:** $0.

### FIX-05 · One shared sheet-mirror status label mapper (P2 F-12; small)
**Why:** one backend enum renders three different ways, twice leaking raw values;
three local type declarations have drifted.
**Do:** extract the polished FloorOpsApp label map + a single `SheetMirrorStatus`
type into a shared lib module; consume it in FloorOpsApp, DirectorySyncPanel, and
the Workspace panel's sheets step (SET-33 re-consumes it on the new frame).
**Accept:** mutation-sensitive test that raw enum tokens (`syncing`, `pending`,
`idle`, `checking`…) never render on any of the three surfaces; single exported
type; labels byte-identical to today's polished set.
**Effort:** small. **Cost:** $0.

### FIX-06 · API uniformity bundle (P3s; small)
**Why:** close the small deviations so the invariants stay simple and testable.
**Do:** add `requireSameOrigin` to the `google-workspace` POST planner; add
`Cache-Control: no-store` to the eight data routes lacking it; migrate `assistant`
and `meetings` body reads to `parseBoundedJsonObject` (limits unchanged: 9 KB /
180 KB); give calendar test-hold an idempotency/dedup key via event
extendedProperties; extend the migration guard to scan the WHOLE drizzle chain for
destructive DDL (allow-listing historical 0008).
**Accept:** an every-POST-checks-origin census test; a no-store census test; bounds
behavior byte-identical for assistant/meetings (413 messages unchanged);
double-submitted test-hold yields one event in simulation tests; guard fails on a
synthetic destructive migration.
**Effort:** small. **Cost:** $0.

## Wave R3 — settings/UI fixes, on the NEW frame (after the SET-29 series)

### FIX-07 · Admin gating single source of truth (P2 F-13; small)
**Why:** nav and content gate on different identity transports; a stale or failed
`/settings/me` response desyncs them.
**Do:** one `isAdmin` source in the app shell (seed from the server prop, reconcile
from `/settings/me`, single variable consumed by nav AND content); document the
transport relationship. UI gating remains honesty — server-side authorization is
already correct and untouched.
**Accept:** a forced `/settings/me` failure leaves nav and content consistent
(both conservative); no behavior change for the normal path (existing gating e2e
green).
**Effort:** small. **Cost:** $0.

### FIX-08 · FloorOpsApp honesty polish bundle (P3s; small)
**Why:** three small dishonesty patterns styled as data.
**Do:** Planned state uses `FeatureStateBadge` everywhere (Overview Scheduling
subtitle); remove or make honest the constant "Working" meetings stat, the static
`trend="Current"` chips, and the notifications popover (label it as navigation
until a real feed exists); error state renders "Unavailable until live records
load" style copy (match BusinessKpisPanel), not "Loading".
**Accept:** render-invariance tests for the removed literals; error-state copy
asserted distinct from loading-state copy on Overview and Reports.
**Effort:** small. **Cost:** $0.

## Wave R4 — after the SET series (queued with the feature resume)

### FIX-09 · E2e through the real simulation backend (P2 F-7; medium)
**Why:** 31 stubs mean the simulation backend — the product's deterministic test
substrate — has zero browser-level coverage; a live-only bug in the simulated
routes' contracts survives the suite.
**Do:** add one unstubbed happy-path e2e per Google surface (connect-sim, drive
setup, gmail filing, calendar hold, sheets sync) driving the REAL simulation
routes end-to-end on the post-SET-29 frame; keep existing stubbed specs for
edge/failure shaping.
**Accept:** the new specs pass with network interception disabled for
`/api/v1/integrations/google/**`; a deliberate simulation-route contract break
fails them.
**Effort:** medium. **Cost:** $0.

---

**Sequencing recap:** R1 = FIX-01 → FIX-02 → FIX-03 → FIX-04 → FIX-05 → FIX-06 →
FIX-10 (FIX-01/02 share `google-drive.ts` call-graph — run in order; FIX-03..06 and
FIX-10 are parallel-safe with each other but serialize with anything touching the
same files). R2 = SET-29…SET-34. R3 = FIX-07 → FIX-08. R4 = FIX-09 + FIX-11 + the
feature queue. Engine feature packets (SET-17/18/21, SET-25, GI-04) remain
parallel-safe throughout, subject to the same-file rule.

---

# Addendum — lenses 8 & 9 (completed July 22, 2026)

Coverage is now nine of nine. Both deferred lenses ran as sequential Opus agents with
adversarial verification; **neither found a P0 or P1.**

## Lens 8 — Production authorization & session composition

**Verdict: sound.** Request ordering is correct and fail-closed: login/logout are the
only pre-session handlers (by design); every authenticated route flows `sessionHash`
→ (POST) `requireMutationCredentials` (same-origin + double-submit CSRF) →
`authorizeSession` (session validity → capability from the server-side snapshot →
project-scope existence → sensitive-capability DB freshness → identity-keyed rate
limit) → work. Capabilities and actor identity derive solely from the persisted
session snapshot, never from client input; only target UUIDs and bodies come from the
client and are strictly validated. 403-vs-404 mapping is consistent and non-leaking
(scope → 404, session denial → 401 + clear-cookie, capability → 403); the router
denial set exactly matches the policy union (no drift). OIDC verification (issuer,
aud/azp, exp/iat/nbf, nonce, hd, email_verified, RS256-pinned JWKS rejecting
jku/x5u/crit) and the `__Host-` SameSite=Strict session cookie + AES-256-GCM attempt
cookie are solid.

### F-14 · Anonymous OIDC login endpoints are unthrottled (P2; VERIFIED; production-only)
The only request throttle is keyed by verified `userId` and is invoked exclusively
inside `authorizeSession` (via `beforeEmployeeDispatch`). The pre-authentication
surface — `POST /api/v1/session/google/start` and `GET
/api/v1/session/google/callback` — never enters `authorizeSession`, and
`foundation-server.ts` adds no front-door throttle. The callback performs an outbound
HTTPS POST to Google's token endpoint once a caller presents a self-obtained
encrypted attempt cookie plus its state, so an anonymous client can loop
start→harvest→callback to drive unauthenticated outbound-request amplification
against the FCI OAuth client (risking Google-side throttling of real logins) and hold
Cloud Run sockets/instances open (cost / resource-exhaustion vector). Integration
gap, not a per-packet bug: the rate-limit packet and the OIDC packet are each fine
alone, but the identity-keyed limiter structurally cannot cover the endpoints that
most need anonymous protection. Dev Sites surface does not run this router; no data
exposure. → **FIX-11.**

### F-15 · Throttle fires after 1–3 authorization DB round-trips (P3)
For authenticated requests the identity-keyed limiter runs only after
`findSessionByTokenHash`, optional `projectExistsForScope`, and optional
`capabilityIsCurrentForScope` — so a rate-limited request still consumes those
queries before the bucket rejects it. Low impact at ~20 trusted employees; the
throttle protects downstream work handlers, not the authorization datastore.
(Bundled into FIX-11's note; no standalone change.)

## Lens 9 — Architecture & duplication

**Verdict: well-factored for a 20-person shop.** The four ~1,800-line giants each
carry mostly inherent complexity, and `SettingsView` is correctly a thin 14-line
dispatcher (validating the SET-28 extraction). No P0/P1 architectural defects. One
latent hazard and three consolidation opportunities:

### F-16 · Duplicated Postgres advisory-lock ID across two subsystems (P2; VERIFIED)
`core-record-rehearsal.ts` and the admin-access mutation path independently hard-code
the same advisory-lock id `7314269172071302` with no shared constant. Two subsystems
sharing one lock id can block or serialize each other unexpectedly, and a future edit
to one copy silently desyncs the pair. → **FIX-10.**

### F-17 · Per-route preamble hand-rolled 36 times; `no-store` applied 4 ways (P3)
The `requireOfficeUser` + `"response" in auth` + `ensureWorkspaceSchema` (+
`requireSameOrigin` for mutations) preamble is copy-pasted into all 36 routes, the
`no-store` header uses four divergent idioms, and 8 routes omit it (already tracked by
FIX-06). A single `withOfficeRoute` wrapper would eliminate the drift by
construction — highest-value consolidation, but a broad diff; deferred to R4 as a
mechanical follow-up, not urgent.

### F-18 · Setup-action + settings-card boilerplate (P3)
The four lease-guarded setup routes each redefine local `response`/`errorResponse`
helpers; at least three settings cards copy the same `loadRequestRef` stale-guard +
loading/error state machine. Candidates for one shared helper each; small, low-risk,
R4.

## New FIX packets from the addendum

### FIX-10 · Single shared advisory-lock constant (P2 F-16; small; Wave R1)
**Why:** two subsystems hard-code the same Postgres advisory-lock id independently; a
future edit to one desyncs the pair, and sharing one id can serialize unrelated work.
**Do:** extract `7314269172071302` to one exported constant (a shared
platform/postgres locks module) imported by both `core-record-rehearsal.ts` and the
admin-access mutation path. If the two locks are meant to be independent, give them
distinct named constants instead — confirm intent from the two call sites first.
**Accept:** a grep-guard test asserting the literal appears in exactly one source
location; both call sites import the constant; behavior unchanged.
**Effort:** small. **Cost:** $0.

### FIX-11 · Anonymous login-flow throttle (P2 F-14 + P3 F-15; small-medium; Wave R4, production-only)
**Why:** the identity-keyed limiter cannot cover the anonymous OIDC endpoints, which
trigger outbound Google token calls — an amplification / cost vector.
**Do:** add an anonymous/IP-or-global throttle in front of the router for
`session/google/start` and `session/google/callback` (or inside the OIDC handlers),
fail-closed and configurable via production-config, emitting a security-audit event
on trip — mirroring BE-10's production limiter shape. Optionally move the
identity-keyed check ahead of the sensitive-capability DB reads to address F-15. Dev
Sites surface unaffected.
**Accept:** threshold test that repeated anonymous start/callback calls get a
throttled response + audit event; a legitimate single login is byte-identical; config
default is fail-closed.
**Effort:** small-medium. **Cost:** $0. **Note:** production-surface hardening —
apply behind the same acceptance gate as the rest of the Cloud Run auth foundation;
not a dev-environment blocker, which is why it is R4 rather than R1.
