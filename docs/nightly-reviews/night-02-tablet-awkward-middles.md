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
- Every filed candidate was verified by **live `elementFromPoint` hit-testing**,
  not by rectangle geometry alone. That distinction changed the disposition of
  every one of them.
- **Adjudication took two rounds.** Round 1 examined only the three largest
  clusters. Round 2 — prompted by the owner asking whether the testing was
  actually complete — covered the 14 remaining hits and produced N2-4 (a P2
  more severe than anything in the original filing) and N2-5.

## What we found

| ID | Sev | Finding | Disposition |
|---|---|---|---|
| N2-1 | P2 | Inbox toolbar: the Gmail search input is **unreachable by pointer** at 834 (blocked at 5/5 sample points), 900 (4/5) and partly 1024 (2/5) — the "Load messages" button and the status aside are painted over it, so clicking the search field activates Load messages instead | New — proposed NFIX packet |
| N2-2 | P3 | Settings → Google Workspace resource-action rows overlap at 834/900: `Open` over `Ensure spreadsheets` (77×19px), `Open` over `Open` (60×6px), `Open` over the info-hint trigger (34×12px), all inside `_resourceItemActions_` | New — proposed NFIX packet |
| N2-3 | — | Leads board horizontal overflow at 600/720/768 — **REFUTED.** `.board` is `overflow-x:auto; display:flex` under `@media (max-width:820px)`; measured `scrollWidth 1082 > clientWidth 736` and `scrollable: true`. The intended Kanban scroller, not a defect | No action |
| N2-4 | P2 | Projects table: **"Estimated value" is 94.6% clipped at 834 and unreachable** — value rect `left 831` in an 834 viewport, `.projects-table` is `overflow-x: hidden` and **not scrollable**. Fits at 900 and 1024; reflows to a stacked layout at 768. A single-width band | New — proposed NFIX packet |
| N2-5 | P3 | Settings → Testing & launch: the `Open Google Workspace setup` primary button is **40px (19%) clipped** at 834, label included. Still clickable at 10%/50%, so visual truncation rather than unreachability. **NFIX-04 fixed this surface at 360/390/430 only** — the fix was phone-scoped and never covered the tablet band | New — extends NFIX-04's scope |
| N2-6 | — | Zero page-level horizontal overflow at every width — **clean**, but see the caveat below | No action |
| N2-7 | — | Zero WCAG 2.2 SC 2.5.8 target-size or spacing failures across all 102 page-views | No action |

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

### N2-4 — three corrections from the July 31 adversarial audit

The finding stands; three statements about it did not.

1. **The clipping box is misidentified.** This page attributed the clip to
   `.projects-table{overflow:hidden}`. That rule is real, but the actual clipping boundary
   is the row's own paint containment from `content-visibility:auto`
   (`app/globals.css:143`), which applies `contain: layout style paint`. An implementer
   following the original diagnosis would have edited the wrong box.
2. **The "only 821–899 fails" band is wrong.** It was derived from clearance against the
   *viewport* rather than against the clipping box. The row content-box left is a constant
   294px and its content width is `W − 342`, so **900 is still clipped**. NFIX-06 (PR #267)
   scoped its fix `821–900` inclusive, which covers the real case — but this page's band
   was not the reason.
3. **"Cannot be reached by any means" is false.** The row's `accessibleDescription`
   (`app/FloorOpsApp.tsx:2009`) ends `Estimated value ${project.value}.` and renders into an
   `sr-only` span, so the figure **is** available to assistive technology. The defect is
   that it is invisible to a sighted pointer user, which is still a P2 — but the stronger
   claim was the stated basis for the severity and it was not true.

### N2-4 detail (found only after the owner challenged the first pass)

At 834 the Projects row's value cell begins at `x=831` in an 834px viewport — 3px
of a 50px element inside the frame, **94.6% clipped**. `.projects-table` carries
`overflow-x: hidden` and reports `scrollWidth === clientWidth`, so there is no
scroll to recover it: the figure `$125,000` cannot be reached by any means.

It is a **single-width defect**. At 768 the table reflows to a stacked layout
(value rect `left 34, width 700`, fully visible); at 900 and 1024 it fits with
19px and 80px to spare. Only the 821–899 band fails, which is the precise reason
this night's width list included the awkward middles rather than only the
standard tablet sizes.

The site address in the same row also truncates mid-word at 834
("Cherr…", "Hill, N"), which is the same root cause and should be fixed with it.

### N2-5 detail (a completed fix with a coverage gap)

`NFIX-04 · Phone polish: testing-launch overflow…` is **Complete (PR #203)** and
its recorded proof is *"zero overflow/gap findings across the four affected
routes at 360/390/430"*. That proof is honest and it holds — but it is
**phone-scoped**. The same surface still clips at 834: the primary button spans
`667–874` in an 834px viewport, so 40px including part of its label is cut off
by `div.app-shell`'s `overflow-x: hidden`.

This is filed as extending NFIX-04's scope rather than as an unrelated defect,
because it is the same surface and almost certainly the same rule set stopping at
a phone breakpoint. **A fix verified only at the widths it targeted is not a fix
verified everywhere** — worth recording as a pattern, since NFIX-04's evidence
was otherwise exemplary.

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

**The first adjudication pass was incomplete and this page originally said
otherwise.** The scan itself was complete — 102/102 page-views, 17 routes × 6
widths, no missing combinations, zero errors, zero vacuous. But adjudication
examined only the three largest clusters (leads, settings-google-workspace,
inbox) and left **14 element-overflow hits on `/projects`, `/reports` and
`/settings?section=testing-launch` unexamined**, while the page claimed every
candidate had been verified. The owner asked whether the testing was actually
complete; it was not. Re-adjudicating those 14 produced **N2-4, a P2 more severe
than anything in the original filing**, and N2-5.

The lesson is specific: *filing from the biggest clusters is not adjudication.*
A 3-hit cluster on `/projects` hid a fully-clipped monetary value, while a
30-hit cluster on `/leads` was entirely by design.

**A capture-method error is also recorded.** The first screenshot of
Testing & launch showed page content shifted left with letters clipped
("ONTROL CENTER", "anage shared"). That was an artifact of the capture script
calling `scrollIntoView` on the overflowing element, not the app's state.
Re-measured with `scrollX: 0` confirmed. The finding survived, but the original
evidence for it was wrong and would have overstated the defect.

**Method deviation from the program spec.** The program calls for 2–3 focused
review lenses to adjudicate the scan output. This night used direct adjudication
plus live `elementFromPoint` hit-testing instead. Hit-testing is stronger than a
lens for layout questions — it is what refuted N2-3 and correctly identified the
victim in N2-1 — but it is not what the spec asks for, and the missed 14 hits are
plausibly the cost of skipping the lens structure. Recorded so the next scan
night either runs the lenses or amends the spec.

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
and it is what surfaced the element-overflow hits. **Corrected:** this sentence previously
said "the 55 element-overflow hits that resolved to N2-3", conflating the run's 55-hit total
with the 30 hits on `/leads` that N2-3 actually refuted. The remaining 25 split across
`/inbox`, `/settings?section=google-workspace`, `/projects`, `/reports` and
`/settings?section=testing-launch`, and produced N2-1, N2-2, N2-4 and N2-5.

**A further scanner limitation, found by the same audit:** the element-overflow probe
compares each rect against `document.documentElement.clientWidth` — the **viewport** — never
against the element's own scroll or clip container. Anything clipped by an inner box that
does not itself reach the viewport edge produces **zero hits**. N2-4 registered only because
`.projects-table`'s clip edge happens to sit near the viewport edge at 834. Other clipped
content elsewhere in the app would be invisible to this probe, so a clean overflow result
from this scanner is weaker evidence than it appears.

**Dedup.** Checked against Night 1 (phone widths — no overlap in route/width
space), Nights 6, 7 and 8 (static/architecture — different evidence class), and
the open packet backlog. N2-1 and N2-2 are new; neither appears in NFIX-01…05
nor in any open EDIT/SET/AI/DES packet.
