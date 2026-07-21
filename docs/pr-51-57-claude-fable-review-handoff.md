# Claude/Fable review handoff: pull requests #51–#57

Snapshot date: July 20, 2026  
Repository: [`OneStreamerNE98/FCI-Brett`](https://github.com/OneStreamerNE98/FCI-Brett)  
Source baseline: `main` at `f589ee61db58d93827563982e880adc23a829183`

> **Snapshot scope:** This document records the review state observed on July 20,
> 2026. It is not an authoritative task-status ledger. For current sequencing and
> status, use the [agent execution plan](agent-plan-architecture-workspace-and-setup.md),
> the [OIDC follow-up ledger](be04-oidc-review-and-followups.md), and the linked GitHub
> pull-request pages.

## Reviewer assignment

Review PRs #51–#57 as source-only draft work. Check the implementation, tests,
documentation, security boundaries, and cross-PR contracts described below. Do not
merge, deploy, apply a migration or Terraform plan, change hosted configuration, connect
a provider, admit another user, or use real client data. Return every actionable finding
with severity, PR number, file and line or symbol, evidence, user/security impact, and a
recommended correction. If a PR has no actionable finding, state that explicitly.

## Executive summary

Seven draft pull requests are open. Six target `main`; PR #55 is deliberately stacked on
PR #54. The review heads below include the documentation reconciliations pushed to PRs
#51, #52, #53, and #56 on July 20; all current checks on those four heads are green.
PRs #54 and #55 also remain green, with #55 still stacked on #54. PR #57 includes SVG
implementation commit `deb69a1779da98c2deab5cc0b8fca2cc8aec7e52` and corrective
metadata commit `4bdb07d`. At prior head `3af9869`, both Chromium workflows passed
74/75 tests but exposed a real Vinext shortcut-URL defect; the exact failure and fix are
recorded in the PR #57 section below. The PR page is authoritative for the checks rerun
after this documentation is pushed.

None of PRs #51–#57 is merged or deployed. None applies PostgreSQL or D1 migrations to a
hosted database, changes hosted secrets or environment values, provisions Google Cloud,
connects Workspace, publishes an image, runs a Cloud Run Job, admits a second user, or
uses real client data.

| PR | Packet | Pinned code/doc head | Base | Size | Main outcome |
| --- | --- | --- | --- | --- | --- |
| [#51](https://github.com/OneStreamerNE98/FCI-Brett/pull/51) | BE-09 | `ba2a386` | `main` | 35 files, +1,357/−149 | Production core-record read/write routes with authorization, CSRF, idempotency, and a closed project payload |
| [#52](https://github.com/OneStreamerNE98/FCI-Brett/pull/52) | KPI-02 | `d61987a` | `main` | 31 files, +2,512/−115 | Flooring booking inputs, additive D1 migration 0012, and Tier-2 KPI reporting |
| [#53](https://github.com/OneStreamerNE98/FCI-Brett/pull/53) | BE-12 | `54ddc64` | `main` | 15 files, +1,485/−60 | Version-2 rehearsal inventory plus lead and meeting migration coverage |
| [#54](https://github.com/OneStreamerNE98/FCI-Brett/pull/54) | OIDC-02 | `53ac53c` | `main` | 4 files, +71/−5 | OIDC issuer and attempt-cookie hardening |
| [#55](https://github.com/OneStreamerNE98/FCI-Brett/pull/55) | OIDC-03 | `c5e62a2` | `codex/oidc02-verifier-cookie-hardening` | 5 files, +656/−4 | Mutation-sensitive login negatives and real-PostgreSQL concurrency/session tests |
| [#56](https://github.com/OneStreamerNE98/FCI-Brett/pull/56) | SET-10 | `fe28af0` | `main` | 11 files, +422/−23 | Administrator-only Workspace connection-health card |
| [#57](https://github.com/OneStreamerNE98/FCI-Brett/pull/57) | Brand assets | `4bdb07d` code head; this handoff follows | `main` | 12 files, +740/−19 before this documentation follow-up | Vector app-shell and icon assets with PNG compatibility fallbacks |

## Dependency and merge-order constraints

1. **PR #54 must precede PR #55.** PR #55 targets PR #54's branch. After #54 merges,
   retarget or rebase #55 onto current `main`, update its dependency wording, and rerun
   every check before considering it independently mergeable.
2. **PRs #51, #52, and #53 intentionally form a closed KPI boundary.** Development D1
   accepts KPI-02 fields in #52; production creation in #51 rejects them until KPI-04;
   rehearsal format v2 in #53 requires the keys but rejects non-null values until KPI-04.
   Do not “fix” one side without completing the planned PostgreSQL parity packet.
3. PR #51 unlocks BE-10 and BE-14. PR #52 unlocks KPI-03. KPI-04 depends on the KPI field
   packets and BE-12's rehearsal format.
4. PRs #52 and #57 both touch `app/FloorOpsApp.tsx`; PRs #52 and #56 both touch
   `app/globals.css` and the agent plan. Their current changes are in separate regions,
   but recheck mergeability and rerun focused browser tests after either predecessor
   lands.
5. All seven branches began from the same July 20 `main` baseline except stacked #55.
   A green, clean draft today is not evidence that it will remain conflict-free after a
   sibling merges.

## PR #51 — BE-09 production core-record routes

### Outcome and behavior

This packet adds the first production Cloud Run write boundary for core records while
preserving the existing Sites/D1 development contracts:

- `POST /api/v1/clients`
- `POST /api/v1/projects`
- `GET|POST /api/v1/leads`
- `GET|POST /api/v1/projects/:projectId/meetings`

Portable lead and meeting operations are shared by the D1 and PostgreSQL surfaces.
Production mutations require a valid employee session, same-origin session-bound CSRF,
the named capability and record scope, and exactly one bounded `Idempotency-Key`.
Replays are isolated by actor and operation and use the production `{data}` envelope.
Authorization denial occurs before body parsing or repository work.

Project creation accepts only fields that the production PostgreSQL repository can
persist. `flooringCategory`, `squareFeet`, `contractValue`, and other unknown fields fail
with `400 unsupported_project_fields` rather than being accepted and silently dropped.
Initial production assignment is creator-only. Project Manager lead lists remain empty
until an approved lead-to-project scope mapping exists. File, Gmail, and Calendar
provider routes remain fail-closed with `503 feature_unavailable`.

### Key files

- `app/application/lead-operations.ts`
- `app/application/project-meeting-operations.ts`
- `app/application/authorization-policy.ts`
- `app/application/authorization-service.ts`
- `app/platform/google-cloud/employee-request-router.ts`
- `production-runtime/src/cloud-run-server.ts`
- D1 lead/meeting routes, admin bootstrap clients, and route/idempotency tests

### Verification evidence

- Local `npm test`: 426 total, 411 passed, 15 environment-gated skips.
- Focused route/security matrix: 33/33 passed.
- GitHub Node/PostgreSQL: 426 total, 424 passed, 2 expected skips.
- GitHub Chromium: 75 passed.
- Lint, Terraform validation, and source-image construction passed; image publication
  correctly skipped.

### Impact and deliberate limits

- No schema, migration, database apply, seed, hosted configuration, provider call, or
  deployment.
- Adds server-side authorization, scope, CSRF, idempotency, and payload-closure controls.
- The generated 24-hour idempotency `expiresAt` is retention metadata, not permission to
  reclaim a key; existing completed keys remain stable.
- BE-10/BE-14 may begin only after this packet is accepted and merged.

### Review questions

- Is permanent idempotency-key ownership correct despite the current retention timestamp?
- Are creator-only assignment and an empty Project Manager lead list the right fail-closed
  first-release behaviors?
- Do all four creation routes prove replay, changed-body conflict, actor/operation
  isolation, denial-before-work, and audit behavior?
- Is the development bare-JSON versus production `{data}` envelope difference documented
  and unambiguous?

## PR #52 — KPI-02 flooring booking inputs and reporting

### User-visible outcome

Project creation can optionally capture flooring category, square feet, and contract
value. The project drawer shows the captured fields. Flooring category and square feet
are non-financial; contract value is Administrator-only, rejected on non-admin writes,
masked to `null` on non-admin reads, and returned from a non-cacheable project response.

Reports adds product mix, revenue per square foot, estimate accuracy, capture counts, and
contract-first values for booked value and average job value. The definitions document
pins empty, zero, fallback, role, month, and accounting caveats rather than presenting
missing inputs as zero.

### Data and formula contract

- Additive, nullable D1 columns: `flooring_category`, `square_feet`, and
  `contract_value` through generated migration `0012_green_magneto.sql`.
- Seven validated flooring categories; positive whole-number square feet; non-negative
  whole-dollar value.
- Booking month uses project `createdAt` in `America/New_York`.
- Booked and average job value use `contractValue ?? estimatedValue` where documented.
- Revenue per square foot is the arithmetic mean of eligible per-project ratios.
- Estimate accuracy is the arithmetic mean of `contractValue / estimatedValue` where
  both are captured and estimate is positive.
- A recorded zero is data; no eligible capture produces “Not yet captured.”
- PostgreSQL parity remains KPI-04, so no production field persistence is implied.

### Key files

- `db/schema.ts` and generated Drizzle migration 0012
- `app/domain/project-creation.ts`
- `app/application/create-project.ts`
- `app/api/v1/projects/route.ts`
- `app/FloorOpsApp.tsx`
- `app/features/reports/BusinessKpisPanel.tsx`
- `app/features/reports/flooring-kpis.ts`
- `docs/flooring-kpis.md`

### Verification evidence

- Local `npm test`: 421 total, 406 passed, 15 expected skips.
- Migration generation and local D1 application passed.
- Focused desktop/mobile, API, role, modal/drawer, formula, and axe acceptance: 20/20.
- GitHub Node/PostgreSQL: 421 total, 419 passed, 2 expected skips.
- GitHub Chromium: 79 passed; lint, Terraform, and image-build checks passed.

### Impact and deliberate limits

- Additive nullable D1 migration only; no backfill, destructive constraint, hosted D1
  apply, PostgreSQL change, configuration change, or deployment.
- No installation dates, callback workflow, cost accounting, or gross margin.
- Production creation and rehearsal keep the fields closed until KPI-04.

### Review questions

- Is project creation the correct durable booking event, and are whole dollars the right
  storage unit?
- Do the seven categories cover the expected business without creating a false taxonomy?
- Are the arithmetic-mean ratio formulas the intended business definitions?
- Can any contract value enter a non-admin response, UI state, log, or cache?
- Should the duplicated category allowlists be centralized now or deliberately wait for
  the production-parity packet?

## PR #53 — BE-12 rehearsal inventory and v6 payload coverage

### Outcome and behavior

The strict test-only rehearsal format moves to version 2. It inventories all 21 D1
tables plus R2 and assigns every source category a reasoned `migrated`, `transformed`,
`excluded`, or `blocking` disposition. Inventory-only categories remain zero-only:
classification never authorizes silent loss.

The bounded payload now includes clients, contacts, leads, projects, project meetings,
and explicitly classified activity, including lead-linked activity. It validates
identifiers, relationships, bounds, meeting evidence, and markers before database
access, inserts in dependency order in one transaction, reads the destination back, and
reconciles counts plus deterministic content/identifier hashes. `cutoverReady` remains
hard-coded `false`.

Format v2 requires the three KPI project keys but allows only `null`; a non-null value
fails before connection until KPI-04 supplies PostgreSQL parity. The exact rehearsal
grant template expands to six import tables with `SELECT, INSERT` and three control
tables with `SELECT`, without sequence, function, or broader schema rights.

### Key files

- `app/platform/migration/core-record-rehearsal.ts`
- `infrastructure/postgres/rehearsal-importer-template.sql`
- `tests/fixtures/production-core-rehearsal.json`
- rehearsal unit, least-privilege, and real-PostgreSQL integration tests
- migration/cutover runbook and production-foundation documentation

### Verification evidence

- Local focused suite: 23 passed, 1 expected local PostgreSQL skip.
- Local `npm test`: 426 total, 410 passed, 16 environment-gated skips.
- GitHub PostgreSQL 16 ran and passed the bounded rehearsal with exact importer grants
  and lead references.
- GitHub Node/PostgreSQL: 426 total, 424 passed, 2 expected skips.
- GitHub Chromium: 75 passed; lint, Terraform, and image build passed.

### Impact and deliberate limits

- Safe source, fixture, test, SQL-template, and documentation changes only.
- No new or changed PostgreSQL migration; immutable v1–v6 remain unchanged.
- The real database execution occurred only in a disposable GitHub CI PostgreSQL 16
  schema. No approved hosted development/staging rehearsal, production migration or
  grant apply, live-data import, Cloud SQL resource, or deployment occurred.
- Temporary schemas and test-created roles are bounded and removed by the integration
  suite.

### Review questions

- May format v1 be retired, or does a compatibility requirement exist?
- Is every inventory disposition correct, and does zero-only handling prevent every
  silent-loss interpretation?
- Are the six import and three control-table grants exact and sufficient?
- Are cleanup paths bounded if setup, migration, or role creation fails midway?
- Can any source row or identifier leak into the emitted evidence report?

## PR #54 — OIDC-02 verifier and attempt-cookie hardening

### Outcome and behavior

The verifier now requires Google's ID-token `iss` claim to be a string before allowlist
matching, closing single-element-array coercion. Cookie parsing tolerates malformed
unrelated fragments but remains fail-closed for a bare, empty, or duplicate
`__Host-fci_oidc_attempt` cookie.

The packet explicitly documents the accepted residual boundary: the encrypted login
attempt remains stateless and may be reused only inside its fixed ten-minute lifetime if
a browser ignores the clear-cookie response and obtains a fresh Google authorization
code. AAD binding, constant-time checks, PKCE, state, nonce, and expiry remain unchanged.

### Key files and verification

- `app/platform/google-cloud/employee-oidc.ts`
- `tests/employee-oidc.test.mjs`
- `docs/authorization-simulation.md`
- `docs/be04-oidc-review-and-followups.md`
- Local `npm test`: 421 total, 406 passed, 15 expected skips.
- GitHub Node/PostgreSQL: 421 total, 419 passed, 2 expected skips.
- GitHub Chromium: 75 passed; all build, lint, Terraform, and image checks passed.
- Mutation checks proved the new regressions fail when prior behavior is restored.

### Impact and review questions

- Security hardening only; no schema, data, secret, config, provider, or deployment change.
- Is the documented ten-minute stateless residual acceptable before live activation, or
  is durable one-use attempt persistence required?
- Does the parser reject every malformed exact-name attempt cookie while ignoring only
  unrelated damage?
- Are issuer type and cookie behaviors independently mutation-sensitive?

## PR #55 — OIDC-03 employee-login test backfill

### Outcome and behavior

This stacked, test-only packet makes production login security claims falsifiable. It
adds verifier negatives for expiry, audience, issuer, email verification, nonce, and
hostile `HS256`/`none` algorithm labels. Router coverage proves cross-origin login-start
denial, callback `403 login_not_authorized` versus retryable `503 login_unavailable`,
attempt-cookie clearing, and denial-audit fidelity.

The PostgreSQL unit matrix covers invitation required/mismatch, identity conflict, user
unavailable, both disallowed-role paths, and named `23505` conflict handling with a
separate audit transaction. The PostgreSQL 16 integration test deliberately queues two
transactions behind the same invitation row lock, proves exactly one redemption, checks
the resulting identity/role/session state, and separately verifies idle expiry, absolute
expiry, logout, and audit evidence.

### Key files and verification

- `tests/cloud-run-employee-login.test.mjs`
- `tests/employee-oidc.test.mjs`
- `tests/postgres-employee-login-persistence.test.mjs`
- `tests/postgres-employee-login.integration.test.mjs`
- `docs/be04-oidc-review-and-followups.md`
- Local `npm test`: 444 total, 427 passed, 17 expected skips.
- GitHub Node/PostgreSQL: 444 total, 442 passed, 2 expected skips; both named real-PG
  login tests ran and passed.
- GitHub Chromium: 75 passed; all build, lint, Terraform, and image checks passed.
- Twenty-two one-at-a-time mutations failed their intended tests before restoration.

### Impact and review questions

- Tests and status documentation only; no production source, schema, migration, data,
  credential, provider, config, or deployment change.
- Is lock-wait synchronization deterministic across supported PostgreSQL CI runners?
- Is UUID-derived schema creation and `DROP SCHEMA … CASCADE` cleanup narrowly bounded?
- Does every test fail for its intended guard rather than a shared upstream failure?
- Does the suite add any production-only test seam or fail to close one acceptance claim?

## PR #56 — SET-10 Workspace connection-health card

### User-visible outcome

Workspace setup step 1 gains an Administrator-only connection-health card. It displays a
masked account, simulation versus Workspace mode, persisted status, and an exhaustive
Shared Drive/Gmail/Calendar/Sheets matrix separating FCI-enabled state from recorded
OAuth permission. Simulation says “Not applicable — simulated” rather than inventing a
grant or provider-health result.

Persisted `reauthorization-required` remains visible. **Disconnect Workspace** moves
inside the card so an Administrator can recover even from an invalid-grant state.
Readiness refreshes also update connection details after a manual check, OAuth callback,
disconnect, and simulation reset. Office users neither render the card nor request the
Administrator endpoint.

### Backend and privacy contract

- One canonical four-service list.
- `grantedServices` derives independently from persisted scopes; it is `null` in
  simulation.
- Reauthorization remains required when persisted status says so, the stored account is
  no longer approved, or an enabled service lacks a recorded scope.
- Only a masked account and bounded status/boolean fields are exposed. Raw scopes,
  tokens, keys, provider responses, freshness, and expiry are not returned.
- “Recorded OAuth permission” is evidence of persisted consent, not a live provider
  health check.

### Key files and verification

- `app/lib/google-oauth.ts`
- `app/settings/components/GoogleWorkspacePanel.tsx`
- `app/globals.css`
- Workspace rollout guide and SET-10 ledger
- Six focused Node/Playwright contract and role-gating test files
- Local `npm test`: 423 total, 408 passed, 15 expected skips.
- Focused Node: 27/27; focused Playwright: 6/6.
- GitHub Node/PostgreSQL: 423 total, 421 passed, 2 expected skips.
- GitHub Chromium: 77 passed; desktop/390px axe and overflow checks passed.

### Impact and review questions

- No schema, migration, hosted Workspace configuration, provider mutation, or deployment.
- Is the account masking useful and appropriate for this Administrator-only context?
- Is recorded permission unmistakably different from live health?
- Should stale details remain visible with a refresh error, or should the card clear them?
- Does the global small-screen table-header rule affect any unrelated responsive table?

## PR #57 — vector logo and app-icon refresh

### User-visible outcome

The supplied full Floor Coverings International wordmark appears in expanded desktop and
mobile navigation. The supplied compact app mark appears in the collapsed desktop rail.
Browser and install metadata prefer the vector icon, with the supplied PNG retained as a
compatibility fallback. Apple touch metadata remains PNG because that is the safer Apple
format.

The packet also fixes a pre-existing responsive defect: a sidebar collapsed on desktop
now becomes the intended 246-pixel mobile drawer instead of staying a 78-pixel rail. The
mobile close control remains clear of the wordmark.

### Asset mapping and integrity

| Surface | Primary | Fallback |
| --- | --- | --- |
| Expanded/mobile sidebar | `/fci-logo-enhanced-master.svg` | `public/fci-logo-enhanced-master.png` retained |
| Collapsed desktop rail | `/fci-app-icon-master.svg` | `public/fci-app-icon-master.png` retained |
| Browser icon/shortcut | SVG | PNG browser-icon fallback |
| Web-app manifest | SVG, `sizes: any` | PNG, `1254x1254` |
| Apple touch icon | PNG | — |

- Full logo SVG: 107,264 bytes, SHA-256
  `81946ae0e8d4a5a53b639f95708ef288615c9b1082adb5b9800602b39b971506`.
- App icon SVG: 5,000 bytes, SHA-256
  `b510970816cefa2ca1d43b424de7de5f687910c902e95d369693d72315593050`.
- Both are native vector paths with no script, event handler, `foreignObject`, embedded
  raster image, external href, or data URL.
- The two SVGs total 112,264 bytes versus 1,512,140 bytes for the PNG pair, a 92.6%
  uncompressed reduction on vector-capable surfaces.
- The supplied `trace.svg` is imported under the product-facing name
  `fci-app-icon-master.svg`; visual bounds match the supplied app-icon PNG.
- Both SVGs retain an opaque off-white square background. The full-logo SVG has fixed
  1254×1254 dimensions but no `viewBox`. It is preserved byte-for-byte and scales as an
  external image; a transparent or viewBox-corrected source would be a future approved
  asset replacement, not an unreviewed mutation here.
- HTML supplies the meaningful wordmark alternative text. The compact duplicate remains
  decorative and hidden from assistive technology.

### Key files and verification

- `public/fci-logo-enhanced-master.svg`
- `public/fci-app-icon-master.svg`
- Existing PNG masters retained for compatibility and provenance
- `app/FloorOpsApp.tsx`, `app/layout.tsx`, and `public/manifest.webmanifest`
- `tests/rendered-html.test.mjs` and `tests/e2e/floor-ops.spec.ts`
- Implementation commit: `deb69a1779da98c2deab5cc0b8fca2cc8aec7e52`.
- Shortcut metadata correction: `4bdb07d`.
- Local lint passed.
- Focused rendered contracts: 21/21 passed.
- Full local `npm test`: both builds passed; 419 total, 404 passed, 15 expected
  environment-gated skips, 0 failed.
- At prior head `3af9869`, both GitHub Chromium workflows passed 74/75 tests. The sole
  failure was `tests/e2e/floor-ops.spec.ts:81`: Vinext serialized the object-form
  `icons.shortcut` descriptor as `href=".../[object Object]"`. The regular typed SVG and
  PNG icons and PNG Apple icon were already correct.
- Commit `4bdb07d` uses Vinext's supported string form for `icons.shortcut` and keeps the
  E2E assertion on its exact SVG href. Local in-app inspection rendered
  `/fci-app-icon-master.svg` correctly for the shortcut and regular SVG icon, retained
  the PNG fallback and Apple icon, and reported no browser warnings/errors. The focused
  Playwright journey reached and passed all icon assertions; its final console-health
  assertion was blocked only by the documented Windows Vinext `file:///.../.vinext/fonts`
  issue. GitHub Chromium is the authoritative cross-platform rerun.

### Impact and review questions

- Static assets, metadata, responsive shell CSS, and tests only. No API, authorization,
  data, schema, config, migration, provider, or deployment change.
- Is preserving the full SVG byte-for-byte preferable to adding a `viewBox` locally?
- Is retaining PNG for Apple touch and compatibility the right platform boundary?
- Are crop, whitespace, off-white background, and contrast acceptable in expanded,
  compact, and 390-pixel layouts?
- Does the collapsed-desktop-to-mobile correction preserve every navigation state?

## Documentation reconciliation findings

The implementation PRs update their primary packet documents. Confirm the owning-branch
corrections below during review, then perform only the listed post-merge reconciliation
after each implementation is accepted:

| PR | Documentation item to reconcile |
| --- | --- |
| #51 | Commit `ba2a386` corrects future-BE-09 wording and removes BE-09 from assignable queues while keeping it **In review**. The GitHub PR description was aligned to that wording on July 20. After merge, mark BE-09 complete and add #51 to the merged-packet guard. |
| #52 | Commit `d61987a` documents additive D1 migration 0012 and its hosted-apply gate, removes KPI-02 from assignable queues, and labels it draft/source-only/undeployed. After merge, mark KPI-02 complete and register #52 in the guard. |
| #53 | Commit `54ddc64` records the disposable GitHub CI PostgreSQL 16 rehearsal while preserving the no-hosted-apply boundary, expands the runtime summary, and removes BE-12 from assignable queues. After merge, mark BE-12 complete and register #53 in the guard. |
| #54 | Current OIDC-02 status correctly says draft review. After merge, change it to complete and register #54 in the merged guard. |
| #55 | Current OIDC-03 status and stacked dependency are truthful. After #54 merges, retarget/rebase, update the dependency wording, rerun checks, and only then change the post-merge status/guard. |
| #56 | Commit `fe28af0` changes SET-10's branch-ledger wording to `In review — draft PR #56, July 20, 2026.` Do not call it complete until merge; register it afterward. |
| #57 | This document and the GitHub PR description replace the stale PNG-only asset note and record the `3af9869` Chromium failure plus `4bdb07d` shortcut fix. No canonical packet status changes are required for this independent brand packet. |

These are documentation accuracy tasks, not permission to mark an open packet complete.
Canonical ledgers must change to `Complete` only after the corresponding PR merges and
its acceptance checks still pass on the merged baseline.

## Requested Claude/Fable return format

For each finding, return:

1. **Severity:** P0, P1, P2, or P3.
2. **PR:** one of #51–#57.
3. **Location:** exact file plus line range or the narrowest named symbol/section.
4. **Finding:** one concrete defect or missing acceptance condition.
5. **Evidence:** the failing path, contradiction, mutation, or reproducible check.
6. **Impact:** user, data, security, accessibility, operations, or maintainability risk.
7. **Recommended correction:** bounded change and tests/docs that should move with it.

Also answer these cross-PR questions explicitly:

- Is the #51/#52/#53 KPI boundary internally consistent and fail-closed?
- Is the #54→#55 stacked order safe and completely documented?
- Do #56 and #57 expose only truthful state and accessible UI at desktop and 390 pixels?
- Is any PR claiming deployment, provider health, cutover readiness, or production parity
  that its code and evidence do not establish?
- Are the documentation reconciliation items above complete, or did this review find
  another stale source-of-truth statement?

If no code blocker exists, say which PRs are acceptable as written and list only the
documentation/rebase steps that remain before merge. Do not perform a merge or deploy as
part of the review.
