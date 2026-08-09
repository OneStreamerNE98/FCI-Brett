# UI design critique remediation plan

Last reconciled: August 9, 2026 · Deployment truth: [GitHub issue #258](https://github.com/OneStreamerNE98/FCI-Brett/issues/258)

Source critique: the July 17, 2026 design critique supplied by the owner. This checked-in ledger is the self-contained project record; it does not depend on the original temporary worktree path.

Baseline: PR #24, merged to `main` as `80a2d5a`

Completed remediation slices: PR #25 (full-app critique pass), PR #27 (Reports
drill-through), PR #29 (shared operations boundary), PR #30 (semantic rules table),
PR #33 (actionable lists), PRs #35/#37 (Settings boundaries and honest role gating),
and Workstream F PRs #119/#126/#132/#143/#149/#159/#165 (DES-01…07).

Historical deployment evidence, retained for the tracking guard rather than as a current
live claim: PR #30 merged at `aa8ed8f`; PR #32 later deployed that source in Sites
development version 40 at `adc79b8`. PR #32 is therefore the historical version-40
deployment record for PR #30. Issue #258 supersedes this paragraph for current state.

The `codex/actionable-lists` slice completed in source in PR #33 and was not deployed at that merge.
The `codex/settings-panel-extraction` slice completed in source in PR #35 and was not deployed at that merge.
These are historical merge-time facts, not current deployment claims.

DES-09 reconciles and closes this historical critique ledger in PR #359. Current and
future design work is dispatched only from the status lines in
[`agent-plan-architecture-workspace-and-setup.md`](agent-plan-architecture-workspace-and-setup.md);
this file no longer carries a parallel open-work queue. Consult issue #258 rather than
this repository file for what is deployed.

## Purpose

This is the canonical, checked-in status ledger for the July full-app design critique. It preserves every systemic finding (A1–A8), every screen finding (B1–B16), the intended structural work, and the verification gates. An item is only marked complete when the source change and proportionate automated or rendered verification exist.

The July 17 critique was based on ten routes at desktop and 390 px widths, five interaction-state captures, and axe WCAG 2.2 AA scans across the nine routes then in the matrix. It identified two generations of UI in one app: a newer accessible pattern led by People & Access and an older set of undersized, low-contrast, and inconsistent workflow styles.

## Status legend

- **Complete** — the requested behavior is implemented; final branch-wide verification is still summarized separately.
- **Partial** — material work is implemented, but a named acceptance criterion or structural follow-up remains.
- **Planned** — explicitly retained as later work; it must not be represented as complete.
- **Intentional** — the critique said to preserve this behavior.

## Systemic findings ledger

| ID | Status | Captured adjustment and evidence | Remaining acceptance criterion |
| --- | --- | --- | --- |
| A1 — 12 px typography floor | Complete in source | PR #24 lifted the main route baseline. This branch finishes the stylesheet-wide 6–11 px declaration sweep, including integration, filing, meeting, rule, popover, client, and assistant states. | Keep the CSS regression guard green and verify computed styles in rendered secondary states. |
| A2 — WCAG text contrast | Complete in source | Added shared muted-text tokens in PR #24; this branch replaces the remaining weak legacy grays across secondary workflow states and keeps compliant status colors. | Axe serious/critical scans must remain clean at desktop and mobile; visually inspect non-default states. |
| A3 — control target sizes and focus | Complete in source | Access-scale minimums cover standard and compact controls. This branch raises assistant source actions and modal/drawer close controls and restores the solid Access tab focus ring. | Retain target-size coverage for Assistant and interaction states. |
| A4 — desktop sidebar wrapping | Complete | Nav labels remain one line with ellipsis and compact feature-state labels where needed. | Preserve at desktop, tablet, and mobile drawer widths. |
| A5 — eyebrow readability | Complete | Global 12 px eyebrow styling uses the compliant brown token. | Remove losing legacy declarations during Phase 3 CSS cleanup. |
| A6 — competing primary actions | Complete for current routes | Topbar lead capture is demoted/contextual, mobile hides the extra topbar action, Inbox has one primary load action, Refresh is soft, and the global placeholder is the short “Search.” | Reassess when future route-specific creation actions become real. |
| A7 — design-system pattern drift | Complete for the critique boundary | PRs #29/#30/#33/#35/#37 establish the structural patterns; PRs #126/#149/#165 consolidate control, card, metric, empty-state, and pill grammar. Read-only `LeadStatusPanel` rows intentionally remain static while actionable rows use the shared actionable-list pattern. | Later design enhancements have their own packet status lines in the agent ledger. |
| A8 — token/cascade/style debt | Complete for the critique boundary | PRs #119/#126/#208 removed the audited dead/cascade/control debt; PRs #309/#318 later tightened semantic-token drift and retired dead webfont/inline-style remnants. | New drift is guarded by the rendered and design-token suites. |

> **Closed August 9, 2026:** DES-09/PR #359 reconciles the July critique against the
> completed bounded PRs above. Later design packets remain independently tracked in the
> agent ledger; they do not reopen this historical findings ledger.

## Screen findings ledger

| ID | Screen | Status | Captured adjustment and evidence | Remaining work |
| --- | --- | --- | --- | --- |
| B1 | Reports | Complete | Reports becomes one column at 820 px and below. | Keep desktop/mobile screenshot coverage. |
| B2 | Reports | Complete | Both charts use labeled semantic lists with readable text. Actionable rows are native links with descriptive names, while the bar graphic is decorative and zero-record rows remain static. | Keep axe, accessible-name, target-size, and zero-record assertions. |
| B3 | Leads | Complete | The card body has an explicit View details action, a reusable read-only lead drawer, a separate labeled Advance action, and toast Undo; Overview pipeline rows open the same drawer. | Drawer separation and focus restoration are covered; add stage-advance and Undo regression coverage. |
| B4 | Leads | Complete | Stage headings, counts, IDs, source, and metadata meet the type/contrast floor. | Preserve after shared card/pill migration. |
| B5 | Overview | Complete | Right-rail, pipeline, next-action, value, and header text use the readable floor and contrast token. | Keep seeded desktop/mobile screenshot coverage. |
| B6 | Overview | Complete | Tablet and mobile retain next action as a second row, right rails align to content, and phone metrics use a two-column grid. | Keep 768 px and 390 px assertions. |
| B7 | Clients | Complete | Added name/code/contact/email filtering, explicit synced/attention/checking/not-synced colors, readable cells, and non-success neutral states. | Filter behavior is covered; add browser coverage for sync-state transitions. |
| B8 | Settings | Complete | Fields use full-width accessible chrome, 42 px controls, read-only styling, warm active nav, and one-column mobile actions. | Verify all Settings sections, not only My account. |
| B9 | Inbox | Complete | Connection and safety are one strip, Load messages is the only primary loader, Refresh is soft, empty headings are h2, and status content is a semantic stacked list without decorative live dots on static advice. | Empty/status semantics are covered; add connected, disconnected, loaded, and error-state browser coverage. |
| B10 | Assistant | Complete | Project context is a visible labeled 42 px field near the hero, only one canned-question family remains, fixed empty-state height is removed, composer controls meet the target floor, and the mobile textarea is 16 px. | Default desktop/mobile target-size scans pass; add answer and citation-state coverage. |
| B11 | Schedule | Complete | Schedule has durable navigation, one “planned for a later milestone” message, a consistent Planned state, and aligned Overview wording/action. | Keep Schedule in route and mobile accessibility coverage. |
| B12 | People & Access | Partial by design | The development/session boundary is informational, Retry is omitted for the known boundary, Invite is explained and visually secondary when unavailable, copy is plain language, the standard In development badge is visible, and the solid focus ring is restored. | Hydration-gate removal is deferred until dedicated SSR/hydration tests pass. App-shell integration remains a separate structural task. |
| B13 | Projects | Complete | “Schedule & site” is the header, “Not scheduled” is muted regular text, row hover/focus is visible, tabs are readable, and named status colors pass. | Keep the completed actionable-list regression coverage green in later slices. |
| B14 | Reports | Complete | Active-project copy is “X of Y … active,” status rows use lifecycle order, meaningless Current pills are removed, and chart rows now open exact bounded list filters. Lead links use the bounded `stage` values `new-inquiry`, `site-visit`, `proposal`, `decision`, and `other` and include active leads only; `other` contains active nonstandard stages. Project links use the bounded `status` values from `planning` through `archived` and match the exact lifecycle status. Invalid, duplicate, or obsolete values return to the normal page, and Back returns to Reports. | Keep bounded-filter regression coverage; deeper record-level and financial drilldowns remain future reporting work. |
| B15 | Global heading/copy | Complete | Lead columns and Inbox empty states use h2; Clients says “Projects” and removes repeated “independently managed” copy. | Enforce heading order in route accessibility checks. |
| B16 | Settings | Complete | When display name equals email, the account card renders the address once and uses a workspace identity line instead of duplicating it. | None. |

## Delivery phases

### Phase 1 — global stylesheet remediation

- [x] Add readable semantic tokens and the UI font token.
- [x] Enforce the 12 px meaningful-text floor across the stylesheet.
- [x] Replace failing muted colors and status colors.
- [x] Adopt 42 px page, 38–40 px standard, 34 px compact, and the documented 32 px bare-control target minimums.
- [x] Keep desktop sidebar labels on one line.
- [x] Fix the Reports, mobile metrics, Overview rail, and Assistant responsive cascade issues.
- [x] Remove redundant and dead legacy CSS declarations (PRs #119 and #208).

### Phase 2 — screen-specific remediation

- [x] Settings forms and duplicate identity.
- [x] Lead drawer, deliberate advance action, Undo, and Overview tap-through.
- [x] Inbox state strip, single primary load action, headings, and status semantics.
- [x] Reports accessibility, copy, lifecycle order, and removal of fake deltas.
- [x] Overview mobile decision data and rail alignment.
- [x] Schedule navigation and consistent planned-state language.
- [x] Clients filtering, copy, and truthful sync-state colors.
- [x] Assistant scope, target sizes, canned-question consolidation, and empty layout.
- [x] Projects placeholder hierarchy and interaction feedback.
- [x] CTA hierarchy and short global Search placeholder.
- [x] Boundary-aware Access presentation and focus styling.
- [ ] Access hydration-gate removal and app-shell composition — explicitly deferred structural work.
- [x] Reports chart drill-through — durable bounded URL/filter contract implemented and deployed in private Sites development version 38.

### Phase 3 — structural consolidation

Phase 3 is closed as a design-critique tracking surface. Its bounded work shipped through
the PRs below; later refactors and enhancements are owned by their status lines in the
agent ledger rather than duplicated here.

1. **Semantic table and actionable-list track**
   - [x] First slice: create one shared responsive semantic table based on the Access People/Activity pattern and migrate **Settings → Inbox & file rules**.
   - [x] Preserve all five rule fields at desktop and mobile, native Pause/Enable and Delete keyboard behavior, focus visibility, and serious/critical axe coverage.
   - [x] Complete in source in PR #33 from `codex/actionable-lists`: define an accessible actionable-list pattern for the whole-row Overview pipeline, Projects, and Clients views without forcing interactive rows into table semantics. The source and proportionate automated and rendered verification pass.
2. **UI primitive track**
   - [x] PR #165 consolidated metrics, empty states, and pill aliases without erasing purposeful screen differences.
   - [x] PR #126 consolidated the audited button-height patterns into the shared control scale.
   - [x] PRs #119/#126/#309 consolidated the typography, color, and spacing grammar with drift guards.
3. **Feature-boundary track**
   - [x] PR #29 established shared operations boundaries; PRs #35/#37 extracted Settings surfaces; PRs #327/#328 extracted the four record views and modal/drawer cluster.
   - [x] Tests moved with those component boundaries while rendered behavior remained pinned.
   - [x] Further shell splitting is explicitly owned by NFIX-24 and does not remain as an unnamed item here.
4. **Legacy CSS track**
   - [x] PRs #119/#208 removed audited dead rules, aliases, losing overrides, and redundant responsive declarations.
   - [x] PRs #126/#309 normalized surfaces and fixed control sizing, backed by the undersized-control and token-drift guards.
   - [x] PR #318 retired the remaining dead webfont load and inline-style island identified by the later audit.

DES-09/PR #359 performs the final cross-ledger reconciliation; no Phase-3 item remains
dispatchable from this document.

### Phase 4 — durable guardrails

- [x] Axe serious/critical checks exist for the primary durable routes and run in CI.
- [x] Add Schedule and 390 px coverage to the axe route matrix.
- [x] Modal, drawer, search, Access boundary, Inbox connection/error, Assistant answer, and layout-editor states have focused axe coverage across their owning PRs; PR #359 adds the remaining notifications-popover assertion.
- [x] Close the historical screenshot-tour item: the checked-in Playwright harness supplies configurable origin, deterministic server startup, and failure propagation; PR #359 captured the approved references after visible route identity and settled network activity. Reference capture is evidence, not a golden-image regression gate.
- [x] Add a CSS regression guard for new sub-12 px declarations.
- [x] Add a CSS regression guard for undersized fixed controls (PR #126; mutation-sensitive guard retained in `tests/rendered-html.test.mjs`).
- [x] Capture approved desktop and mobile reference screenshots (18 files in `docs/design-baseline/2026-08-09/`, PR #359).

Phase 4 is closed by DES-09/PR #359. The typography guard has an empty
`font-size:0` allowlist, the undersized-control guard is mutation-sensitive, and the
frozen Overview and Reports hashes plus their three Node pinning suites remain unchanged.

## Verification gates for this release

- `npm run lint`
- `npm test` (production build plus Node suite)
- Focused Playwright coverage for the remediated interactions
- Full route accessibility suite, including Schedule and mobile width
- Browser screenshots for the durable routes and the Lead drawer at desktop and 390 px
- No unhandled browser console errors on exercised paths
- No text-size declarations below 12 px in `app/globals.css`
- No `font-size:0` declarations; the guard allowlist is empty.
- No serious/critical axe color-contrast or target-size regressions

### DES-09 closure evidence — PR #359

- The approved post-series source reference contains all nine durable product routes at
  1280×800 and 390×844 under `docs/design-baseline/2026-08-09/`.
- `tests/e2e/frontend-correctness.spec.ts` now runs one serious/critical axe assertion
  against the open `#notifications-popover` state.
- The typography and undersized-control guards pass with the `font-size:0` allowlist
  empty and the control-size mutation probe intact.
- The Overview and Reports golden constants and all three Node pinning suites are
  byte-identical to the branch base; DES-09 performs no golden regeneration.
- The packet changes docs, tests, and reference screenshots only. It does not change
  application behavior, data, schema, migration, authorization, configuration, external
  services, or deployment state.

### July 18 verification evidence

- `npm run lint` passed.
- `npm test` passed: 332 tests total, 319 passed, 13 environment-gated tests skipped, 0 failed; both production builds completed.
- `npm run test:e2e` passed: all 49 Playwright tests passed.
- All ten durable routes passed serious/critical axe checks at 1280×720 and 390×844, including Schedule.
- Desktop and 390 px rendered QA covered all ten routes plus the Lead drawer; exercised paths had no unresolved console error.
- `git diff --check` passed.
- PR #25 merged to `main` as `13241fc`; the exact merged source built successfully and was deployed to private Sites development version 37.
- Authenticated post-deployment smoke checks covered all ten durable routes with the expected page identity, meaningful content, an H1, no framework overlay, and no console warning/error. Live interaction checks also passed for Client filtering, the Project drawer and focus return, and the fail-closed People & Access boundary.

### Reports drill-through follow-on evidence

- Route-helper tests cover valid, invalid, duplicate, cross-route, canonical, and authentication return-path behavior for Lead stage and exact Project lifecycle values.
- Playwright covers keyboard activation, exact matching-only destinations, visible filter and Clear actions, reload/bookmark behavior without focus theft, Back focus restoration, abandoned-path focus isolation, invalid/duplicate fallback, static zero-record and unsupported-status rows, and a `$0` active custom-stage record in the bounded `other` bucket.
- Reports and filtered Lead/Project routes pass serious/critical axe checks at 1280×720 and 390×844; the focused mobile check also verifies a 44 px chart-row target and no horizontal viewport overflow.
- Desktop and 390 px screenshots were reviewed for Reports and the filtered Lead/Project destinations. PR #27 merged at `cf32a9e`, all merged-commit CI checks passed, and the exact merged commit deployed successfully as private Sites development version 38. Authenticated read-only live smoke verified Reports, exact Planning-project filtering, Back focus restoration, a valid empty Proposal-lead filter, and a clean browser console. The follow-on changed no database schema, access policy, hosted environment values, or Google connection.

### Semantic rules-table slice evidence

- `npm run lint` passed.
- `npm test` passed: 333 tests total, 320 passed, 13 environment-gated tests skipped, 0 failed; both production builds completed.
- `npm run test:e2e` passed: all 55 Playwright tests passed.
- Focused browser coverage verifies the native five-column table contract, Space-key Pause/Enable behavior and request body, Enter-key Delete behavior, exact responsive field labels, and no viewport overflow at 1024 px or 390 px.
- Populated Settings inbox rules pass serious/critical axe checks at 1280×720 and 390×844, including the corrected Needs review contrast. Desktop, 1024 px, and 390 px rendered QA showed the expected table/card layouts with no unresolved console warning or error.
- PR #30 merged this slice at `aa8ed8f`. It changes presentation components, styles, tests, and documentation only; it changes no database schema, API contract, access policy, hosted configuration, migration, or Google connection. PR #32 later merged at `adc79b8`, and that exact commit deployed as private Sites development version 40, which now includes the semantic rules table.

### Actionable-list slice evidence — complete in PR #33

- Source-only PR #33 from `codex/actionable-lists` introduces one shared native `list` → `listitem` → `button` contract with explicit `role="list"` for the Overview pipeline, Clients, and Projects; it deliberately adds no table or row roles. Each row has a concise action name plus a linked accessible description that preserves all decision-useful metadata.
- Focused Playwright coverage passes for native Enter/Space activation, Escape dismissal, exact focus return to the triggering row, preserved metadata, 44 px row targets, desktop/1024 px/390 px responsive behavior, empty states outside empty lists, and browser console health. All 58 focused Playwright tests pass when run in isolated local-server groups. On Windows, the Vinext development server exits during the monolithic run, so the one-shot `npm run test:e2e` command is not recorded as a valid aggregate pass.
- All 13 routes pass the serious/critical axe matrix at desktop and 390 px, and the rendered visual QA pass covers the migrated routes and empty states. `npm run lint` passes. The final `npm test` run passed 325 active tests with 13 skipped after the accessibility and test-runner adjustments.
- The development watcher now ignores generated `work` artifacts so rendered-test output does not trigger reload loops. This source-complete slice is limited to presentation components, styles, tests, test/development configuration, and documentation. It changes no hosted configuration, data, database schema, API contract, access policy, migration, Google connection, or security boundary; private Sites development version 40 at `adc79b8` remains live.

### Settings panel-extraction evidence — complete in source in PR #35

- Source-only PR #35 from `codex/settings-panel-extraction` moves My account, Workspace defaults, Inbox rules and its rule modal, Directory sync, Data & security, Google Workspace and its filing modal, Testing & launch, and the shared Settings data notice into eight files under `app/settings/components/`.
- `SettingsView` remains the thin section switcher. The extraction preserves existing markup, copy, class names, URLs, state ownership, API calls, and business behavior while moving the related source-contract assertions to the component boundaries they now protect.
- This structural slice changes no hosted configuration, data, database schema, API contract, access policy, migration, Google connection, or security boundary. It is not deployed; private Sites development version 40 at `adc79b8` remains live, and the broader Phase 3 feature, Google-workflow, primitive, and CSS tracks remain open.

## Intentionally preserved behavior

- Honest feature-state badges and empty states.
- Em-dash loading values instead of fabricated zeros.
- Records-only Assistant mode.
- Windows `Ctrl K` search label.
- Transient drawer/search state until record-detail and privacy-safe search URLs are designed.
- The accessible mobile drawer and visible mobile feature-state labels.
- Controlled single-user test-data boundary; no second user or real client data.

## Follow-on release boundary

This July critique ledger is closed. Any remaining or later design work is governed by
the canonical packet status lines in the agent ledger. PR #359 is source evidence only:
it does not deploy, alter hosted configuration, migrate data, change Google Workspace,
or admit another user. Issue #258 is the sole authority for the current Sites deployment.
