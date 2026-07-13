# Action: Harden the interface for multi-user work

Owner: Codex/developer, with workflow decisions from the business owner

Status: Not started

Depends on: Approved roles/capabilities and production API contracts

The interface is suitable for learning the single-user workflow. It needs explicit authorization, freshness, error, accessibility, and feature-readiness behavior before about 20 employees can rely on it together.

## P0 integrity fixes

- [ ] Remove the live Settings action that applies `FCI/Filed` without an exact project copy.
- [ ] Pass the authenticated user, real role, capabilities, and assigned-project scope to the interface.
- [ ] Hide or disable unauthorized navigation and actions for clarity while also enforcing every rule on the server.
- [ ] Display a session-expired/disabled state and require reauthentication instead of silently falling back.

## Truthful feature state

- [ ] Label every module and action as Working, Pilot, Setup required, or Planned.
- [ ] Disable or relabel Send update until a durable draft/send workflow exists.
- [ ] Explain that Calendar/reminder preferences are configuration only until a background worker consumes them.
- [ ] Keep Tasks, Files, Schedule, and messaging placeholders explicit until their durable models exist.
- [ ] Add an Administrator-only indicator when the app is using simulation or test resources.

## Multi-user data behavior

- [ ] Use a query cache such as TanStack Query or SWR with independent loading/error states per resource.
- [ ] Refetch on focus/reconnect and after writes; show a visible last-updated/stale indicator on operational views.
- [ ] Use version/ETag checks for edits and show a conflict-resolution message instead of losing another employee’s update.
- [ ] Split the initial all-or-nothing data load so one failed API does not blank unrelated modules.
- [ ] Validate request and response payloads with shared runtime schemas.
- [ ] Show Google work as queued/in progress/succeeded/failed when it is processed asynchronously.

## Navigation and component structure

- [ ] Give Overview, Leads, Clients, Projects, Schedule, Inbox, Assistant, Reports, and Settings real App Router URLs.
- [ ] Preserve filters, selected project, and useful search state in the URL where appropriate.
- [ ] Split the large client component by route and feature; prefer server rendering for stable shells and dynamically load heavy, rarely used panels.
- [ ] Consolidate duplicate Inbox and Settings Google workflows behind shared components and hooks.

## Accessibility and feedback

- [ ] Use one accessible dialog/drawer primitive with `role="dialog"`, an accessible name, initial focus, focus trap, Escape handling, and focus restoration.
- [ ] Add Arrow Up/Down, Enter, Escape, and current-selection semantics to global search.
- [ ] Create typed success, warning, and error notifications; use `role="alert"` for errors and offer inline retry where safe.
- [ ] Clean up notification timers when components unmount.
- [ ] Raise metadata text to at least 12 px and body/action text to 14–16 px unless a documented exception is tested.
- [ ] Test keyboard-only use, screen-reader names, reduced motion, 200% zoom, contrast, 390 px mobile, tablet, and desktop widths.

## Test coverage and completion

- [ ] Add Playwright happy paths for each real role plus denied cross-project navigation and direct URL requests.
- [ ] Add automated accessibility checks such as axe for primary pages, modals, drawers, search, and error states.
- [ ] Test offline/reconnect, stale responses, simultaneous edits, API partial failure, OAuth expiry, and queued Google work.
- [ ] Test a 20-user concurrency scenario for common reads/writes and Google queue behavior.
- [ ] Capture approved desktop and mobile screenshots for the pull request after browser capture is reliable.
- [ ] Include lint in CI and fail on unhandled console errors in browser smoke tests.

## Completion result

This action is complete when each role sees only its intended work, the server denies direct unauthorized requests, stale/conflicting data is handled safely, all major workflows pass keyboard/mobile/accessibility checks, and rendered multi-user tests pass without console errors.
