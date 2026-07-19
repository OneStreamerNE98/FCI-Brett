# Task checklist: Harden the interface for multi-user work

Owner: Codex/developer, with workflow decisions from the business owner

Status: In progress — July UI remediation and Reports drill-through are merged and deployed through private Sites development version 38; structural and multi-user work remains

Depends on: Approved roles/capabilities and production API contracts

The interface is suitable for learning the single-user workflow. It needs explicit authorization, freshness, error, accessibility, and feature-readiness behavior before about 20 employees can rely on it together.

The complete July 17 design-critique finding ledger, including intentionally deferred structural work and verification gates, is maintained in [the UI design critique remediation plan](../design-critique-fix-plan.md).

## July 13, 2026 UI audit priorities

These are the eight implementation priorities confirmed against the hosted Sites development environment and the current GitHub source. Keep an item open until its acceptance criteria are covered by source tests and rendered browser verification.

- [x] **P0 — Project-manager data integrity:** correct the inappropriate live development value through an authorized admin workflow; replace unrestricted free text with an approved staff identity; validate the identifier and membership on the server; preserve a safe display path for legacy records.
  - Completed July 18, 2026 in private Sites development version 37: creation uses an authorized email identity, raw invalid legacy text is not returned, and the owner used the audited **Assign to me** action on the flagged test project and confirmed the corrected project-manager identity and activity evidence.
- [x] **P1 — Keyboard and focus accessibility:** make the mobile navigation a true modal drawer, keep its closed controls out of the tab order and accessibility tree, inert the background, restore launcher focus, complete global-search keyboard semantics, and return focus to search after a project drawer closes.
- [x] **P1 — Truthful feature readiness:** remove unfinished modules from normal production navigation or label them clearly as Planned or Setup required; do not present placeholder project tabs or disabled future actions as available work.
- [x] **P1 — Deployment-time database migrations:** remove schema DDL from normal request paths and rely on the checked-in, versioned Sites/D1 migration sequence; retain an explicit migration/bootstrap path for controlled environments only.
- [x] **P2 — Readable type and contrast:** raise meaningful metadata to at least 12 px, keep body and action text at 14–16 px where practical, and meet WCAG AA contrast for normal operational text.
  - The July 18 gap pass completes the stylesheet-wide 12 px declaration floor and higher-contrast muted-text sweep, including integration, filing, meeting, rule, popover, client, and assistant states. Phase 3 still tracks removal of redundant legacy declarations without reopening this acceptance item.
- [x] **P2 — Mobile project comparison:** retain status, site/date, and value in a compact stacked mobile row instead of hiding decision-useful fields; do not imply that placeholder dates are durable schedule data.
- [ ] **P2 — Initial-load and bundle performance:** break the monolithic client surface into feature boundaries, dynamically load rare/heavy panels, start critical data earlier where safe, deduplicate shared reads, and bound long record lists.
  - First pass complete: initial client loading starts immediately; duplicated account/Workspace reads share a TTL cache; the overview clock no longer rerenders the app shell; project counts are one-pass; the phone panel is lazy-loaded; long rows defer off-screen rendering; and fixed App Router wrappers now support direct entry.
  - The first Phase 3 boundary now moves shared page/panel/metric/avatar/status UI and report-filter navigation behavior out of the monolith without changing rendered behavior. Feature-level route splitting, rare-panel chunks, and server-started core data remain open.
- [x] **P2 — Rendered regression coverage:** add browser-level coverage for mobile navigation, overlays, search focus/keyboard behavior, feature-state labels, responsive project rows, console health, and primary accessibility checks.

## P0 integrity fixes

- [x] Remove the live Settings action and standalone API route that applied `FCI/Filed` without an exact project copy.
- [x] Display the current server-derived access label (`Admin` or `Office`) instead of hardcoding Administrator.
- [ ] Pass the authenticated user, real role, capabilities, and assigned-project scope to the interface.
- [ ] Hide or disable unauthorized navigation and actions for clarity while also enforcing every rule on the server.
- [ ] Display a session-expired/disabled state and require reauthentication instead of silently falling back.

## Truthful feature state

- [x] Label operational modules as Working, In development, Setup required, or Planned.
- [x] Replace the transient project-update composer with static Planned information until durable update support exists.
- [ ] Explain that Calendar/reminder preferences are configuration only until a background worker consumes them.
- [x] Keep Tasks, Files, Schedule, and activity/update plans explicit without presenting them as active controls.
- [ ] Add an Administrator-only indicator when the app is using simulation or test resources.

## Multi-user data behavior

- [ ] Use a query cache such as TanStack Query or SWR with independent loading/error states per resource.
- [ ] Refetch on focus/reconnect and after writes; show a visible last-updated/stale indicator on operational views.
- [ ] Use version/ETag checks for edits and show a conflict-resolution message instead of losing another employee’s update.
- [ ] Split the initial all-or-nothing data load so one failed API does not blank unrelated modules.
- [ ] Validate request and response payloads with shared runtime schemas.
- [ ] Show Google work as queued/in progress/succeeded/failed when it is processed asynchronously.

## Navigation and component structure

- [x] Give Overview, Leads, Clients, Projects, Schedule, Inbox, Assistant, Reports, and Settings real App Router URLs, with direct-entry authentication, refresh, Back/Forward, bookmark, 404, and outside-identity denial coverage.
- [ ] Preserve filters, selected project, and useful search state in the URL where appropriate.
  - Project status, exact report lifecycle, Lead report stage, Settings section, and Inbox bucket now use bounded canonical query values with safe invalid/duplicate fallback and Back/Forward behavior. Selected-record drawers and free-form search remain intentionally transient until record-detail routing and privacy-safe search-link behavior are designed.
- [ ] Split the large client component by route and feature; prefer server rendering for stable shells and dynamically load heavy, rarely used panels.
  - First boundary implemented for review: reusable operations primitives and the report-driven Leads/Projects filter/focus pattern now live outside `FloorOpsApp.tsx`; the durable route views themselves remain to be split.
- [ ] Consolidate duplicate Inbox and Settings Google workflows behind shared components and hooks.

## Accessibility and feedback

- [x] Use one accessible dialog/drawer primitive with `role="dialog"`, an accessible name, initial focus, focus trap, Escape handling, and focus restoration.
- [x] Remove the closed off-canvas mobile navigation from the keyboard order and accessibility tree; restore focus to its launcher and support Escape when it is open.
- [x] Add Arrow Up/Down, Enter, Escape, and current-selection semantics to global search.
- [x] Create typed success, information, warning, and error notifications; use `role="alert"` for persistent errors and offer inline retry where safe.
- [x] Clean up notification timers when components unmount or a newer notification replaces them.
- [x] Raise metadata text to at least 12 px and body/action text to 14–16 px unless a documented exception is tested.
- [ ] Test keyboard-only use, screen-reader names, reduced motion, 200% zoom, contrast, 390 px mobile, tablet, and desktop widths.

## Test coverage and completion

- [ ] Add Playwright happy paths for each real role plus denied cross-project navigation and direct URL requests.
- [ ] Add automated accessibility checks such as axe for primary pages, modals, drawers, search, and error states.
- [ ] Test offline/reconnect, stale responses, simultaneous edits, API partial failure, OAuth expiry, and queued Google work.
- [ ] Test a 20-user concurrency scenario for common reads/writes and Google queue behavior.
- [ ] Capture approved desktop and mobile screenshots for the pull request after browser capture is reliable.
- [x] Include lint in CI.
- [ ] Fail on unhandled console errors in every browser smoke path.
  - Primary page/sidebar and durable-route tests enforce console health; the remaining Playwright paths still need the same guard.

## Completion result

This action is complete when each role sees only its intended work, the server denies direct unauthorized requests, stale/conflicting data is handled safely, all major workflows pass keyboard/mobile/accessibility checks, and rendered multi-user tests pass without console errors.
