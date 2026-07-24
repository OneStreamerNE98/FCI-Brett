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
**Status:** In progress — `codex/nfix02-google-client-resilience`, July 24, 2026. Source-only and undeployed.

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
**Status:** Blocked — awaiting owner dispatch; BE-15 hold released (merged PR #181, July 24, 2026), paste now HELD until the AI-02 serial slot clears — the formatUsd adoption touches FloorOpsApp.tsx, owned by AI-02's sub-PRs b/c.

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
