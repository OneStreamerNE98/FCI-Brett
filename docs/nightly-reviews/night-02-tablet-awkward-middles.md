# Night 2 — Tablet & awkward middles (768–1024 + 600–900)

**Run:** July 31, 2026 (solo — nights 6 and 8, the only static partners the
co-run rules allow for a scan night, are both already complete). **Target:**
`origin/main` at `c0f7b47`, post-#264. **Method:** scan-first — a new
one-pass Playwright layout scanner (page-overflow / element-overflow /
interactive-overlap / WCAG 2.2 SC 2.5.8 target-size and spacing probes) across
17 routes at six widths against the **seeded e2e server**, then adjudication,
then live hit-testing of every candidate before filing.

## What ran

- **102 page-views** (17 routes × 768/834/1024/600/720/900). Routes: the 9 nav
  destinations, 7 addressable Settings sections, and `/management/access`.
- The scanner is new and is committed at
  [`tools/nightly/layout-scan.mjs`](../../tools/nightly/layout-scan.mjs). It
  did not exist before tonight — the program had been running with an
  uncommitted scanner, which is the same single-fragile-copy problem that
  motivated enshrining the specs in #264.
- **Three scan passes were required.** Passes 1 and 2 were discarded; only
  pass 3 is trustworthy. See Coverage honesty — this is the most important
  section on this page.
- Every candidate was verified by **live `elementFromPoint` hit-testing**, not
  by rectangle geometry alone. That distinction changed the disposition of
  all three candidates.

## What we found

| ID | Sev | Finding | Disposition |
|---|---|---|---|
| N2-1 | P2 | Inbox toolbar: the Gmail search input is **unreachable by pointer** at 834 (blocked at 5/5 sample points), 900 (4/5) and partly 1024 (2/5) — the "Load messages" button and the status aside are painted over it, so clicking the search field activates Load messages instead | New — proposed NFIX packet |
| N2-2 | P3 | Settings → Google Workspace resource-action rows overlap at 834/900: `Open` over `Ensure spreadsheets` (77×19px), `Open` over `Open` (60×6px), `Open` over the info-hint trigger (34×12px), all inside `_resourceItemActions_` | New — proposed NFIX packet |
| N2-3 | — | Leads board horizontal overflow at 600/720/768 — **REFUTED.** `.board` is `overflow-x:auto; display:flex` under `@media (max-width:820px)`; measured `scrollWidth 1082 > clientWidth 736` and `scrollable: true`. The intended Kanban scroller, not a defect | No action |
| N2-4 | — | Zero page-level horizontal overflow at every width — **clean**, but see the caveat below | No action |
| N2-5 | — | Zero WCAG 2.2 SC 2.5.8 target-size or spacing failures across all 102 page-views | No action |

### N2-1 detail (the one that matters)

At 834 the three Inbox toolbar controls share row `y=720`, all 34px tall:

| control | x-range |
|---|---|
| mailbox `select` | 293–421 |
| **`Load messages` button** | **402–522** |
| search `input` | 430–613 |

The button overlaps the select by 19px and the input by 92px. Hit-testing
resolves the button on top everywhere, so the *button* is fine — the **input**
is the victim: blocked at 5%, 25% and 50% by the button, and at 75% and 95% by
the `Inbox status` aside and the `Provider` div. Every sample point on the
search field belongs to something else.

The screenshot confirms it visually: the button sits on the search field and
the "Search this Gma…" label is truncated mid-word at the card edge.

Severity is P2 rather than P1 because the Inbox is admin-only and still carries
its `Dev` badge, and the field has a keyboard path (tab order is unaffected —
only pointer input is blocked). It is not P3 because a form control that
cannot be clicked at three of the six tested widths is broken, not untidy.

## Recommended

Both findings are CSS-only and reachable without touching `app/FloorOpsApp.tsx`
or any golden-hashed region, so a single small packet can carry them. Neither
should regenerate a golden hash — the Inbox and Settings surfaces sit outside
the hashed containers, which was verified rather than assumed.

**Deliberately not proposed:** a general audit of every wrapping toolbar. Two
instances is not yet a pattern, and the program's rule is that
enhancement-sized proposals wait for explicit owner approval.

## Pastes issued

None yet — filed for the owner's dispatch decision alongside the Night 6
re-run currently queued for Codex.

## Coverage honesty

**Two of the three scan passes were invalid, and the first one would have
passed silently as an all-clear.**

- **Pass 1: 64 of 102 page-views vacuous.** The dev server died partway
  through because it had been started with `&` inside a foreground shell that
  then exited; the log ends cleanly at `/schedule` with no error. Restarted
  detached and re-run.
- **Pass 2: 6 of 102 vacuous — all false positives, caused by a bug in this
  scanner.** The vacuity heuristic matched the substring `vite` inside the word
  **"Invite"** on the People & Access page. The check now detects the Vite error
  overlay by DOM element and uses word-bounded text markers. **A scanner that
  cries wolf is worse than no scanner**, because the entire value of the guard
  is that a silent all-clear can be trusted.
- **Pass 3: 0 vacuous.** Only this pass is reported above.

The vacuity guard exists because Night 1's first full pass returned zero
findings *vacuously* — every page was a Vite error overlay, caught only by
eyeballing screenshots. Tonight it caught both failures automatically, which is
the guard working; it also introduced a false positive of its own, which is the
guard needing the same scrutiny as the code it watches.

**Not covered.** No interaction states — every page-view was the default
render, so nothing behind a modal, drawer, expanded disclosure, or populated
filter was scanned. Night 4 owns disclosure states. No orientation changes, no
real tablet hardware, and no touch-event testing: `elementFromPoint` models
pointer targeting, not finger contact geometry. `/management/access` renders an
"In development" stub, so its clean result carries little weight.

**One caveat on N2-4.** Zero page-level horizontal overflow is a weaker result
than it appears: `html, body` carry `overflow-x: hidden`, so overflowing
content is *clipped rather than scrollable* and cannot produce a page-scroll
signal. The element-level overflow probe is the meaningful one at these widths,
and it is what surfaced the 55 element-overflow hits that resolved to N2-3.

**Dedup.** Checked against Night 1 (phone widths — no overlap in route/width
space), Nights 6, 7 and 8 (static/architecture — different evidence class), and
the open packet backlog. N2-1 and N2-2 are new; neither appears in NFIX-01…05
nor in any open EDIT/SET/AI/DES packet.
