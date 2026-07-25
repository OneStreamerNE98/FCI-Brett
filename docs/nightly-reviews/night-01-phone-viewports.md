# Night 1 — Responsive: phones (360/375/390/430)

**Run:** July 25, 2026 (co-run with Night 7 under the owner-approved pairing
rules — shared kickoff, combined publication). **Target:** `origin/main`
post-#196. **Method:** scan-first — the one-pass Playwright layout scanner
(overlap / overflow / touch-target / control-gap / wrap probes, WCAG 2.2
SC 2.5.8 24px-circle geometry as the violation threshold) at four phone
widths across all 16 routes with captures, then three Opus lenses
(targets/gaps, overflow/wrap + visual screenshot pass, synthesis), every
P1/P2 adversarially verified.

## What ran

- 64 page-views (16 routes × 360/375/390/430) against the **seeded e2e
  server** so tables, cards, and pipelines carried populated test data.
- 114 deduped probe findings compressed by the lens chain to 5 filed
  findings — no padding to the 10-finding budget.
- Live re-verification: the one P2 was reproduced with a targeted scanner
  re-run before filing.

## What we found

| ID | Sev | Finding | Disposition |
|---|---|---|---|
| N1-1 | P2 | Testing & launch forces page-level horizontal scroll (unbreakable OIDC names + heading-stack rule scoped to `.workspace-settings` only) | NFIX-04 |
| N1-2 | P3 | Projects filter pill 4px gap — refuted from P2: intended segmented-pill spacing, ≥ WCAG floor | Note-only |
| N1-3 | P3 | Control token scale caps at 42px; ~70 below-HIG targets app-wide, single-token root | NFIX-04 |
| N1-4 | P3 | 6–7px control gaps in google-workspace / workflow-notifications / calendar sections | NFIX-04 |
| N1-5 | P3 | Scanner checkbox "failures" are label-wrapped false positives (labels ≥44px are the real targets) | Documented allowlist note |

Healthy findings worth naming: the only page-level horizontal overflow in the
entire app is N1-1; no interactive target anywhere falls below the WCAG 24px
floor; DES-04's phone topbar and the single-column collapses behaved exactly
as designed at every width.

## Recommended

Fire NFIX-04 in a free globals.css window (coordinate with FIX-17's dead-CSS
deletions — either order, serialize merges). The token bump is owner-visible
density; the PR's before/after screenshots are the approval surface.

## Pastes issued

NFIX-04 drafted and zone-checked (globals.css contention with FIX-17 noted in
the packet status). NFIX-05 (Night 7's sibling packet) drafted the same
night — see night-07.

## Coverage honesty

The first full scan pass returned zero findings **vacuously** — every page
was a Vite error overlay from a stale root-clone serve state. Caught by
screenshot inspection, root-caused (54-PR-stale clone, missing `.bin`, stale
dep-optimizer cache), and re-run in full against the seeded e2e server; the
dev-DB server was unmigrated and near-empty and would have scanned empty
states. N1-5's false positives were verified from module CSS, not live DOM
hit-testing. Golden hashes constrain every N1 fix to CSS-only. The N1-1
verifier agent crashed on an infra cap and was backfilled by an orchestrator
inline verification (live repro + source confirmation) — recorded here for
process honesty.
