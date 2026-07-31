# Nightly Review Program — findings ledger (July 2026)

> **Sibling reviews:** all findings ledgers are grouped under
> [docs/README.md → Findings & reviews](README.md#findings--reviews). (Added July 24, 2026.)

**Target:** `origin/main`, re-synced at each night's kickoff. **Method:** per
night — automated scans (viewport capture matrix; overlap / overflow /
touch-target / control-gap / mid-word-wrap detectors with WCAG 2.2 SC 2.5.8
geometry as the violation threshold) followed by 2–3 focused review lenses,
adversarial verification of every P1/P2 candidate, and dedup-first filing
against the open packet backlog and all prior nights. Program index:
[`nightly-reviews/README.md`](nightly-reviews/README.md).

**Grammar note:** findings use four-hash headings `#### N<night>-<seq> ·
<title> (P<sev>)` (outside the tracking guard's packet-structure assertions);
fix-packet drafts use `### NFIX-<nn> · <title>` with a grammar-legal status
line and appear in the Packets section below. This document joins the tracking
guard's tracked-document list in the same PR that files the first NFIX packet.

---

## Nights

### Night 6 — Architecture & duplication (run July 24, 2026; co-run with Night 8)

Static review of `origin/main` (post-#180): three Opus lenses (boundaries,
duplication with the 3+-instances rule, dead code), adversarial verification on
every P1/P2. Summary page:
[`nightly-reviews/night-06-architecture-duplication.md`](nightly-reviews/night-06-architecture-duplication.md).

#### N6-1 · Application read-path bypasses the ports architecture (P2, verified)
Five `app/application` read services (search-records, dashboard-data,
today-project-meetings, assistant/project-evidence, assistant/tools) import
concrete `adapters/d1` and run inline SQL, and `tools.ts` instantiates the
concrete D1 task repository although `app/ports/task-repository.ts` exists.
The write path uses ports; the read path does not — so the dormant PostgreSQL
suite cannot back reads without rewriting each service. Not a live bug; a
migration tax. **Disposition: owner-gated architecture proposal** — recommend
scheduling read-side query ports alongside the next PostgreSQL-migration work,
not as a nightly fix packet.

#### N6-2 · `noStore()` response helper duplicated ~22× (P2, verified)
A four-line no-store JSON wrapper is copy-defined byte-identically in 16 route
files with 6 more re-implementing it via a header-constant variant. Same-shape
duplication: the Google-integration `errorResponse()` wrapper is redefined in
8 routes over the existing shared `mapGoogleIntegrationError`, and USD
formatting has no single home (2 identical `Intl.NumberFormat` consts + a
`money()` wrapper + 4 inline strings). → NFIX-03.

#### N6-3 · ~10 dead CSS families in globals.css (P3, verified; folded into FIX-17)
Removed-dashboard-mock remnants (`.timeline*`, `.calendar-board*`, `.day-cell`,
`.crew-label`, `.shift-block`, `.draft-shift*`, `.mail-list*`, `.health-donut`,
`.recent-activity`, `.next-actions`, `.prompt-chips`, `.add-card`,
`.google-ready/-pending` and neighbors) with zero className references. Same
fix-shape as FIX-17's orphaned-stepper item — **folded into FIX-17** (dated
amendment) rather than a new packet. **Correction (July 24, 2026, automated
review):** the originally-listed `.panel-header-subtitle*` family is LIVE
(emitted dynamically by `OperationsPrimitives.tsx` PanelHeader) and was removed
from the deletion scope; FIX-17 requires per-selector grep-proof so any other
mis-classification fails loud at implementation.

#### N6-4 · Dead exports (P3)
Four legacy alias/parser exports in `adapters/postgres/postgres-values.ts` and
four scattered dead exported callables/consts (`chooseEmailDestination`,
`WORKSPACE_SIMULATION_ACCOUNT`, and two others) have zero callers repo-wide.
→ NFIX-03 (removal rides the hygiene sweep).

Coverage honesty: import-direction and duplication sweeps were repo-wide;
dead-export analysis covered `app/lib`, `app/application`, and the 12 largest
source files — not every module. The ~120 module-local type exports that serve
the house testability convention were deliberately not filed.

### Night 8 — Google integration depth (run July 24, 2026; co-run with Night 6)

Static review of the live (non-simulation) Google paths: three Opus lenses
(idempotency/partial-failure, quota/backoff/degradation, token/scope hygiene),
adversarial verification on every P1/P2. Summary page:
[`nightly-reviews/night-08-google-integration-depth.md`](nightly-reviews/night-08-google-integration-depth.md).

#### N8-1 · Client Directory sheet sync has no lease (P2, verified)
`syncClientDirectory` reads sheet rows then blind-appends new clients with no
connectionKey-scoped lease, while client-create, project-create, provisioning,
and the manual sync button can all trigger it concurrently. Two overlapping
syncs append the same client twice; the next sync then trips the duplicate-id
guard (409) and **all mirroring wedges** until an admin hand-deletes the row in
the shared sheet. Every other ensure/filing/provision path is properly leased —
this is the one unprotected mutation family. → NFIX-01.

#### N8-2 · No timeout on any core Google client fetch (P2, verified)
drive, sheets, gmail, calendar, and the OAuth token request all await a bare
`fetch` with no `AbortSignal` — one hung socket is an unbounded await that can
wedge a sync request (and, once composed, the outbox drain inside its 60-second
lease). The chat-notifier and OIDC clients already thread timeouts — the four
data clients and the token request do not. → NFIX-02.

#### N8-3 · Project Register clear-then-write wipe window (P3)
`syncProjectRegister` clears the tab then writes replacement rows in a second
request; a failure between the two leaves the register visibly empty until the
next successful sync. Self-heals; scoped transient. → NFIX-01.

#### N8-4 · Mirror status can wedge at "syncing" (P3)
Both mirror entities set `syncing` up front and only transition via
success/catch paths — a process death mid-batch leaves a permanent "syncing"
claim. (A stale "synced" is impossible — verified written only after
completion.) → NFIX-01.

#### N8-5 · Burst call-sites surface raw 429s with no retry (P3)
Drive provisioning's nested loops and the sheet sync's ~10 sequential writes
abort wholesale on the first transient 429; failures are honest and retries
idempotent, so severity is modest at 20-person scale. → NFIX-02.

#### N8-6 · Calendar maps 429 to HTTP 503 (P3)
`calendar_rate_limited` is surfaced as 503, discarding the rate-limit signal
that sheets/drive/gmail preserve as 429. → NFIX-02.

#### N8-7 · Scope-revocation staleness in the status endpoint (P3)
The refresh path never reconciles granted scopes and the status endpoint runs
no liveness probe, so an externally part-revoked connection keeps presenting
its services as available until a real call fails. Needs a reauth-UX design
decision — filed as a finding for the WS/GI space, no packet yet.

Token hygiene otherwise verified strong: AES-GCM-256 keyring encryption at
rest, no token in any log or response path, fail-closed account allowlist,
clean connectionKey partitioning, no over-scoping (broad Drive scope justified
and acknowledged).

Coverage honesty: static reads only — no live Google calls, no e2e; the D1
adapters behind the lease helpers were trusted per their own test suites;
sim-only branches skipped by repo law.

### Night 1 — Responsive: phones (run July 25, 2026; co-run with Night 7)

Scan-first review at 360/375/390/430 across all 16 routes: 64 page-views
against the seeded e2e server (populated test data), 114 deduped probe
findings (93 touch-target, 10 wrap, 7 gap, 3 container-overflow, 1 overlap),
then three Opus lenses (targets/gaps, overflow/wrap + visual screenshot pass,
synthesis) and adversarial verification per P1/P2. Summary page:
[`nightly-reviews/night-01-phone-viewports.md`](nightly-reviews/night-01-phone-viewports.md).

#### N1-1 · Testing & launch forces page-level horizontal scroll on phones (P2, verified)
Two causes, one symptom — the app's only page-level horizontal overflow
(`page-wrap` scrollWidth 397 vs 360, reproduced live). (a) OIDC requirement
names (`FCI_EMPLOYEE_OIDC_ALLOWED_HOSTED_DOMAIN`, …) render in
`.settings-security-list strong` with no overflow-wrap, and the unbreakable
tokens push the page wide. (b) `.settings-heading` is flex with no wrap and
the ≤560px heading-stack rule is scoped to `.workspace-settings` only, so the
test-launch heading + "Open Google Workspace setup" button never stack.
Verifier-agent crash was backfilled by an orchestrator inline verification
(live re-scan repro + source confirmation). → NFIX-04.

#### N1-2 · Projects filter pill gap (P3, refuted from P2)
The 4px intra-control gap inside the Projects segmented filter pill is
intended spacing; segments are 34px (≥ the WCAG 24px floor) and no 8px token
governs intra-pill gaps. Recorded so future nights do not re-file. Note-only.

#### N1-3 · The three sub-44 control tokens drive ~70 below-HIG targets (P3; corrected July 25, 2026)
`--control-compact:34 / --control-standard:40 / --control-page:42` drive ~70
below-HIG (24–43px) targets across routes. Uniformly ≥24px, so no WCAG 2.5.8
failure. **Correction (automated review):** `--target-min:44` is NOT unused —
it is deliberately applied to sidebar-collapse, collapsed nav links,
icon-button/mobile nav, workspace-stage-toggle, ProjectSegmentSelector
options, PageLayoutEditor buttons, and the connection-health toggle. This is
a chosen two-tier density scale, not a single unused-token root; NFIX-04 must
enumerate the actual below-44 selector families and raise a curated set, not
blanket-bump tokens on a false premise. → NFIX-04 (CSS-only; default-layout
markup is byte-pinned by the golden hashes).

#### N1-4 · Sub-8px gaps between adjacent action controls (P3)
google-workspace action row (6px between primary/soft buttons); the
info-hint→reminder-input pairs on workflow-notifications and calendar (7px).
Violates the 8px design rhythm, not WCAG geometry (both sides ≥24px). → NFIX-04.

#### N1-5 · Scanner "wcag-fail" checkboxes are label-wrapped false positives (P3, documented)
The probe measures the 15–18px `<input>`, but every flagged checkbox sits in
a clickable `<label>` ≥44px (featureList, notificationRow, settings-checkbox,
attestationRow — CSS-verified), which is the real WCAG target. Documented as
an allowlist note so future nights do not re-file; no fix needed.

Coverage honesty: the first scan pass was vacuous — every page rendered a
Vite error overlay from a stale root-clone serve state — and was detected by
screenshot inspection and re-run in full against the seeded e2e server (the
dev-DB server was unmigrated and near-empty, which would have scanned empty
states). Captures at four phone widths; DES-04's scroll-reveal topbar and the
≤1180/≤820 single-column collapses are by design; golden hashes constrain all
N1 fixes to CSS-only.

### Night 7 — Code correctness (run July 25, 2026; co-run with Night 1)

Static review: three Opus lenses (domain/application computation, API route
correctness, client-state + synthesis), adversarial verification with
executed-proof preference per P1/P2. **Zero P1/P2 survived verification** —
the computation core held up; eight P3s filed. Summary page:
[`nightly-reviews/night-07-code-correctness.md`](nightly-reviews/night-07-code-correctness.md).

#### N7-1 · filing-rules mutations are office-gated; every sibling settings config route requires admin (P3, verified core, severity-refuted from P2)
POST/PATCH/DELETE call `requireOfficeUser` without `{admin:true}` — confirmed
reachable — while all sibling settings mutations pass the admin flag and the
UI hides the panel behind `isAdmin` (API-only surface). Refuted to P3:
trusted-insider actor, same-origin only, review-first impact (no Gmail
write). Defense-in-depth parity fix. → NFIX-05.

#### N7-2 · Revenue-per-sq-ft averages per-project ratios, not aggregate ÷ aggregate (P3; verified intentional)
`average(value/sqft per project)` weights a 250-sqft job equally with a
10,000-sqft job. **Resolved as documented intended behavior (automated
review):** `docs/flooring-kpis.md` defines this KPI as "the arithmetic mean
of those per-job ratios, **not aggregate dollars divided by aggregate square
feet**" — the code matches its source of truth exactly. No open decision;
revisit only if the owner wants the definition itself changed.

#### N7-3 · Booked value/count and average job value include cancelled projects (P3; verified intentional)
`bookedProjects` filters only by creation month; `averageJobValue` spans all
loaded valued projects. **Resolved as documented intended behavior (automated
review):** `docs/flooring-kpis.md` defines monthly bookings by `createdAt`
with no status exclusion and average job value across "all currently loaded
projects." Code matches the accepted formulas. No open decision; revisit only
if the owner wants the definitions changed.

#### N7-4 · Win-rate-by-source groups on raw casing/whitespace (P3)
`lead.source.trim()` without case normalization splits one logical source
into several rows with misleading per-row rates, while lead status in the
same loop is normalized. Overall win rate unaffected. → NFIX-05.

#### N7-5 · "Last synced" renders raw epoch milliseconds (P3)
DirectorySyncPanel's `syncTime` stringifies the number (e.g.
`1753142400000`) while GoogleWorkspacePanel formats the identical field with
`toLocaleString()`. → NFIX-05.

#### N7-6 · Meeting POST coerces unknown meetingType to "other"; far-off meetingAt accepted (P3)
Unlike task validation (unknown → 400), an unrecognized meeting type is
silently stored as "other", and any parseable date passes. UI dropdown +
datetime-local avoid it; direct-API surface only. Note-only.

#### N7-7 · refreshDirectoryData lacks the load-generation guard its sibling loaders use (P3)
The core CRM loader can resolve out of order with a mutation-triggered
refresh and briefly restore a stale snapshot (self-heals on next refresh).
The loadId idiom already exists in three other loaders. Fold into FIX-15's
FloorOpsApp pass (same file zone).

#### N7-8 · Optimistic meeting prepend ignores meeting_at DESC order (P3)
A newly saved past-dated meeting jumps to the top until reload, contradicting
the server sort. Cosmetic transient. Fold into FIX-15's FloorOpsApp pass.

Verified clean along the way: settings/me + my-settings + workspace-resources
load-generation guards, toast-timer cleanup, mobile-nav focus trap,
optimistic project updates re-sync selectedProject, ask-loading Q-race guard,
inbox loadedBucket guard. Coverage honesty: page wrappers
(leads/clients/projects/reports/schedule), management/access,
GoogleWorkspacePanel L720+ (Night 8's zone), the workspace editor/defaults
cards, features/maps, and repo internals were not read by any lens.

---

### Night 2 — Tablet & awkward middles (run July 31, 2026; solo)

Scan-first over `origin/main` at `c0f7b47`: 102 page-views (17 routes ×
768/834/1024/600/720/900) against the seeded e2e server using the newly
committed scanner [`tools/nightly/layout-scan.mjs`](../tools/nightly/layout-scan.mjs),
then live `elementFromPoint` hit-testing of every candidate. Summary page:
[`nightly-reviews/night-02-tablet-awkward-middles.md`](nightly-reviews/night-02-tablet-awkward-middles.md).
**Two of three scan passes were discarded as invalid** — see that page's
coverage-honesty section, which is the substantive part of this night.

#### N2-1 · Inbox search input is unreachable by pointer at tablet widths (P2)

At 834 the Inbox toolbar's three controls share one 34px row: mailbox `select`
x293–421, `Load messages` button x402–522, search `input` x430–613. The button
overlaps the select by 19px and the input by 92px. Hit-testing resolves the
button on top, so the button itself is fine — the **search input** is blocked
at **5/5** sample points (button at 5/25/50%, the `Inbox status` aside at 75%,
the `Provider` div at 95%). At 900 it is blocked 4/5; at 1024, 2/5; at 768 the
toolbar collapses and the row is clean. Clicking the search field activates
Load messages instead. Verified live, not from rectangle geometry, and
confirmed visually — the button is painted over the field and the
"Search this Gma…" label truncates mid-word at the card edge. P2 not P1: the
Inbox is admin-only, still `Dev`-badged, and keyboard tab order is unaffected —
only pointer input is blocked. P2 not P3: a form control that cannot be clicked
at three of six tested widths is broken, not untidy.

#### N2-2 · Google Workspace resource-action rows overlap at 834/900 (P3)

Inside `_resourceItemActions_`: `Open` over `Ensure spreadsheets` (77×19px),
`Open` over `Open` (60×6px), `Open` over the info-hint trigger (34×12px), six
overlapping pairs at each of 834 and 900. All `position: static`, opacity 1,
pointer-events auto — real geometric collisions in an action row, not stacking
artifacts. Lower severity than N2-1 because each control retains a clickable
majority; no control was found fully blocked.

#### N2-3 · Leads board overflow — REFUTED (no action)

The scan reported 10 overflowing elements on `/leads` at each of 600/720/768
(30 hits, the single largest cluster in the run). All are the intended Kanban
scroller: `.board` is `overflow-x:auto; display:flex` under
`@media (max-width:820px)`, measured `scrollWidth 1082 > clientWidth 736` with
`scrollable: true`; at 900 it reverts to `display:grid` with no overflow.
Recorded so a later night does not re-file it.

**Coverage honesty (summary; full version on the night page).** Pass 1 lost 64
of 102 page-views to a dev server killed by shell exit. Pass 2 lost 6 to a bug
in this scanner — its vacuity heuristic matched `vite` inside the word
**"Invite"**. Only pass 3 (0 vacuous) is reported. No interaction states, no
orientation changes, no real tablet hardware, no touch-contact geometry.
Zero page-level horizontal overflow is a weak signal here because `html, body`
carry `overflow-x: hidden`, which clips rather than scrolls.

---

## Packets

### NFIX-01 · Sheets mirror sync robustness: lease, write order, status recovery (small-medium)
**Status:** Complete — PR #184, July 24, 2026. Source-only and undeployed. Opus fleet + two review fixes: the sync serializes behind the existing 5-minute connection-scoped lease (overlapping syncs 409 honestly), the Project Register replaces via one atomic open-range updateCells (never observably empty, stale rows cleared), over-age live 'syncing' recovers as 'pending' on reads; the fixes fault-isolated BOTH lease bookkeeping paths so a transient release/fail rejection can neither record a real success as failure nor mask the original sync error. Residual: a >TTL-hung request could still let a successor overlap — closed structurally by NFIX-02's timeouts (amendment below). Guide impact: `docs/settings-guide.md` updated.

**Why:** N8-1/N8-3/N8-4 — the mirror sync is the one unleased live mutation
family: concurrent syncs duplicate rows and wedge all future syncing; the
register wipes transiently on mid-sync failure; a process death freezes
"syncing" forever.
**Do:** serialize `syncGoogleDirectory` behind the same connectionKey-scoped
lease pattern every ensure/filing route uses (or make the client append an
upsert keyed on the id column); make the Project Register replacement
write-then-swap (or one batchUpdate) so the tab is never observably empty;
give the `syncing` state a stale-deadline recovery (treat an over-age
`syncing` as `pending` on the next status read).
**Accept:** a concurrency test proving two overlapping syncs cannot
double-append; a failure-injection test proving the register never renders
empty mid-swap; a stale-`syncing` recovery test; existing mirror pins
untouched; guide impact stated per the currency rule.
**Effort:** small-medium. **Cost:** $0.

### NFIX-02 · Google client resilience: timeouts, bounded retry, honest 429 (small)
**Status:** Complete — PR #189, July 24, 2026. Source-only and undeployed. Opus fleet verified: one shared google-fetch-resilience policy with a genuine 20-second OVERALL deadline (retry shares, never doubles, the budget) threaded through all four data clients plus the OAuth token/revocation/userinfo paths with a static no-bypass guard test; retries are per-call idempotent opt-in only (every opted-in site audited — the lone marked create, Calendar insert, is deliberately replay-safe via deterministic event id + 409-recover); Sheets append, Gmail draft/test-message, Drive creates, and OAuth grants are never auto-replayed; calendar 429 surfaces as 429. The directory-sync lease-outlive window is structurally closed (worst-case sync ≪ the 5-minute TTL). Residual P3s: Retry-After ignored on 429; the pre-existing userinfo 409 timeout mapping kept for flow consistency. Guide impact: none.

**Why:** N8-2/N8-5/N8-6 — no data-client fetch carries a timeout; burst paths
abort on the first transient 429; calendar hides its rate-limit signal as 503.
**Do:** thread `AbortSignal.timeout(~20s)` through the shared fetchers of the
four data clients and the OAuth token request (matching the chat-notifier/OIDC
precedent); add ONE bounded, jittered retry on 429/503 **restricted to
idempotent operations only** (amended July 24, 2026 per automated review: an
ambiguous 503 can arrive AFTER Google commits a mutation, so a blanket retry
inside `request()` would replay non-idempotent POSTs — Sheets `:append`
recreates the exact duplicate-row hazard NFIX-01 fixes, Gmail draft/test-message
creation duplicates drafts). Implement as per-call opt-in (e.g. an
`idempotent: true` flag set on GETs and find-before-create ensures), never a
blanket `request()` retry; surface calendar 429 as 429 `calendar_rate_limited`
like its siblings. **Amended July 24, 2026 (from the NFIX-01 review):** the
~20s timeouts also structurally close the directory-sync lease-outlive window —
a bounded ~10-request sync completes or fails in a fraction of the 5-minute
lease TTL, so a hung call can no longer let a successor sync overlap a zombie;
if these timeouts are ever loosened past the TTL, add an ownership recheck
before the sync's final writes.
**Accept:** timeout tests per client (hung-fetch fake → bounded failure, no
unbounded await); retry test proving exactly one bounded retry on an
opted-in idempotent call AND a test proving a non-idempotent call (append/
draft-create) is NEVER retried on 503; calendar 429 mapping test; no behavior
change on success paths.
**Effort:** small. **Cost:** $0.

### NFIX-03 · Server hygiene sweep: response-helper and formatter consolidation, dead-export removal (small)
**Status:** Complete — PR #197, July 25, 2026. Opus fleet clean with executed proof (82 tests green on the PR branch): response byte-identity settled decisively (Next 16's NextResponse.json wraps Response.json, so every constructor swap preserves status/headers/body), all 8 dead exports grep-proven zero-reference, every test hunk justified with none weakening a response assertion, BE-16 zone confirmed untouched by empty-diff proof. P3 notes: the api-correctness no-store source guard was relaxed to accept a helper import (coverage held by the new nfix03-server-hygiene suite asserting the header + all 25 route imports); the gmail file route intentionally skips the noStoreResponse wrap (matches its original behavior, test-encoded); two test-helper CRLF-normalization hunks were benign bundled scope. Merged after a conflict-resolution merge with main (status-line collision with PR #196, resolved 6e5542b). Source-only and undeployed.

**Why:** N6-2/N6-4 — one four-line `noStore` helper exists ~22×, the Google
error-response wrapper 8×, USD formatting has no home, and eight exports are
dead.
**Do:** single `noStoreJson()` home adopted across the ~22 route sites; add
`googleIntegrationErrorResponse(error, fallback)` beside the existing
`mapGoogleIntegrationError` and adopt in the 8 routes; one `formatUsd()` in
`app/lib` adopted by the two UI call sites (assistant inline strings optional);
delete the 8 zero-reference exports (postgres-values aliases +
`chooseEmailDestination` + `WORKSPACE_SIMULATION_ACCOUNT` + two others) with
grep-proof in the PR.
**Accept:** byte-identical responses (headers and bodies) proven by the
existing route tests passing unchanged; zero behavior change; dead-export
removal breaks no test; `npm test` green.
**Effort:** small. **Cost:** $0.

### NFIX-04 · Phone polish: testing-launch overflow, 44px control tier, 8px control gaps (small)
**Status:** Complete — PR #203, July 25, 2026. Opus fleet clean — zero confirmed findings: screenshots verified faithful down to pixel-crops, the census test derives every `--control-*` family and pins raise-or-keep decisions (mutation-sensitive), all 8 `.settings-heading` consumers audited under the broadened stack rule. Executed scanner proof on the PR head: zero overflow/gap findings across the four affected routes at 360/390/430, with a live 360px capture confirming the OIDC names wrap in-viewport (vacuous-zero check per the Night-1 lesson). Bot P2 fixed on-branch (d184675): decorative direct-child heading icons hidden in the ≤560px stacked layout, capture-verified. Density notes recorded: the two module-file gap raises (WorkspaceDefaults planned fields, Drive-resource action buttons) are unscoped and add ~1–2px at desktop too; the google-workspace action row keeps its 6px gap on desktop (phone-scoped raise); shared control tokens 34/40/42 unchanged. Source-only and undeployed. Guide impact: none.

**Why:** N1-1 — the app's only page-level horizontal overflow (testing-launch
at 360–390: unbreakable OIDC requirement names + a heading-stack rule scoped
to `.workspace-settings` only). N1-3 (as corrected) — the three sub-44 control
tokens drive ~70 below-HIG targets while `--target-min:44` is already applied
to a deliberate set of controls. N1-4 — 6–7px gaps in three settings sections
against the 8px rhythm.
**Do:** add overflow-wrap/word-break to `.settings-security-list strong`;
broaden the ≤560px heading-stack rule beyond `.workspace-settings` (or give
`.settings-heading` flex-wrap); **enumerate the below-44 interactive selector
families** (the `--control-compact/-standard/-page` consumers) and raise a
curated set to the 44px tier on phone widths — per-family, with a one-line
keep-or-raise rationale each, NOT a blanket token bump (CSS-only —
default-layout markup is byte-pinned by the golden hashes, NO markup edits);
raise the three sub-8px control gaps to ≥8px. PR carries before/after phone
screenshots (density changes are owner-visible).
**Accept:** Night-1 scanner re-run at 360/375/390/430 shows zero page-level
overflow and no sub-8px gaps on the three named sections; the PR lists every
below-44 family with its keep-or-raise decision; golden hashes
byte-identical; `npm test` and e2e green.
**Effort:** small. **Cost:** $0.

### NFIX-05 · Correctness small fixes: filing-rules admin gate, normalized win-rate sources, readable sync timestamps (small)
**Status:** Complete — PR #202, July 25, 2026. Opus fleet clean — zero findings, executed proof (959-test full sweep, 0 fail): admin gate landed on exactly the three mutations with GET left office-visible (matches the admin-only UI), the non-admin 403 test proven to fail without the fix; win-rate grouping matches the updated `docs/flooring-kpis.md` definition exactly with a doc-pin test (the formula-refinement rule satisfied in-PR); mirror timestamps render via the shared `toLocaleString` pattern with e2e assertions strengthened (negative raw-epoch checks added). Merged on green CI after an empty bot window (one summon, no response). Source-only and undeployed.

**Why:** N7-1 (filing-rules mutations office-gated while every sibling
settings config route requires admin; UI already admin-only), N7-4 (win-rate
rows split by raw source casing), N7-5 ("Last synced" shows epoch
milliseconds).
**Do:** add `{admin:true}` to filing-rules POST/PATCH/DELETE authorization +
a non-admin 403 test (mirrors sibling settings routes); key
win-rate-by-source on trimmed+lowercased source with a canonical display
label (first-seen casing) — this is a **formula refinement**, so the same PR
must update the win-rate grouping definition in `docs/flooring-kpis.md`
(currently "trimmed `source`") and the pure-helper tests, per that document's
own refinement rule; format `DirectorySyncPanel` `lastSyncedAt` via the
existing `toLocaleString` pattern used for the same field in
GoogleWorkspacePanel.
**Accept:** non-admin office user gets 403 on all three filing-rules
mutations (test-asserted); same-source case variants collapse to one row with
a combined rate (test-asserted) AND `docs/flooring-kpis.md` + pure-helper
tests updated in the same PR; "Last synced" renders a locale timestamp;
`npm test` green; no other behavior change. Owner dispatch of this packet is
the sign-off on the grouping-definition refinement.
**Effort:** small. **Cost:** $0.
