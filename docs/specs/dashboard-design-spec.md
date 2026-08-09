# Dashboard design enhancement — DES series specification

**Status:** Approved by the owner on July 22, 2026 (plan sign-off; the visual
mockup `docs/dashboard-design-mockup.html` accompanies this spec for the
affordance-grammar and brand-treatment look). This document is the design
authority for the DES-01…DES-09 packets in
`docs/ledger/agent-plan-architecture-workspace-and-setup.md` (Workstream F).

**Goal (owner's words, binding):** keep the UI **simple and minimalist** while
making it easier to navigate: the nav pane correct on every device open and
collapsed; the logo without its white background; icon-only Edit-layout; cards,
buttons, and objects always aligned; interactive vs. static cards visibly
distinguishable; the inert "Add section" label fixed; consistent design across
all pages; plus a small set of flooring-business additions.

---

## 1. Simplicity guardrails (binding on every packet)

- **Zero new pages, zero new nav items, zero new modals** anywhere in the series.
- **Net-negative chrome:** the series removes more visible elements than it adds.
  Removed: the false `trend="Current"` pills ×4, the lone topbar Add-lead button,
  the white logo card, the "Add section" pseudo-button, the "All available
  sections are shown." filler, the Edit-layout text label, and the button/radius
  variant sprawl (11+ control heights → 3). Added: chevrons on truly-clickable
  cards, one optional user-hideable Today's-meetings section, one dropdown
  option, one small report list.
- **One interaction rule per element:** an interactive card is a whole-card link
  — never nested buttons inside a clickable card; a static card has no hover, no
  cursor, no chevron, no shadow. Users learn the grammar once.
- **Every packet's PR includes 1280 px and 390 px screenshots**; the review gate
  rejects anything that adds visual noise or a second way to do an existing
  action.

## 2. The affordance grammar (applies app-wide)

Generalized from the two patterns the app already proved (Reports bar rows'
chevron-vs-spacer; the project card's hover lift):

| | Interactive | Static |
|---|---|---|
| Element | Whole-card `<Link>`/button | Plain `<article>`/`<div>` |
| Cursor | pointer | default |
| Resting | border + `--shadow-card` | border only, **flat** (no shadow) |
| Hover/focus | lift (`translateY(-1px)` + `--shadow-raised`) + focus ring | none |
| Marker | `ChevronRight` in the accent used by `.bar-chart-chevron` | none |

Metric-card destinations (Overview): Active pipeline → Leads; Active projects →
Projects (Active); Filed emails → Inbox; **Project meetings → static-flat** (it
counts saved meeting notes — a cumulative stat; see §5). Reports summary metrics
follow the same mapping where a destination exists. Cards render as non-links
while records are not `ready`.

## 3. Design tokens (DES-01 foundation; DES-13 value language)

DES-13 keeps one `:root` block and extends the existing radius, control, and shadow
foundation with an Apple-aligned value language. The intent is restrained: neutral
surfaces, one application accent, a compact system type ramp, and a 4 pt spacing grid.
Selectors and component markup do not change to adopt these values.

| Scale | Tokens |
|---|---|
| Ink | `--color-ink`, `--color-ink-secondary`, `--color-ink-muted`, `--color-ink-subtle`, `--color-ink-inverse` |
| Surfaces and lines | `--color-canvas`, `--color-surface`, `--color-surface-sunken`, `--color-surface-muted`, `--color-line`, `--color-line-soft`, `--color-line-strong` |
| Accent and state | `--color-accent`, `--color-accent-hover`, `--color-accent-soft`, paired `success`, `warning`, `danger`, `info`, and `violet` foreground/soft-surface tokens |
| Type | caption `12px`, body `13px`, label `14px`, headings `16/20/24px`, display `28px`; weights `400/500/600/700`; caption/body/heading line-height tokens |
| Space | six everyday component steps (`--space-1…6`: `4/8/12/16/24/32px`) plus two macro-layout steps (`--space-7…8`: `48/64px`) |
| Motion | `--motion-duration-fast:120ms`, `--motion-duration-standard:180ms`, and one `--motion-ease` curve |

The original compatibility names (`--ink`, `--surface`, `--line`, `--accent`, and
their siblings) remain as aliases during the value-only migration. Radius and shadow
values remain the DES-01 values because those dimensions already tested well:
`--radius-chip:6px · --radius-control:8px · --radius-card:10px ·
--radius-pill:999px · --control-compact:34px · --control-standard:40px ·
--control-page:42px · --target-min:44px · --shadow-card:0 1px 2px
rgba(29,55,40,.04) · --shadow-raised:0 5px 15px rgba(29,55,40,.06) ·
--shadow-overlay:0 25px 70px rgba(35,31,32,.65)`.

The packet's approximately six-step spacing direction is the six-step component scale.
The two larger values are retained as named macro-layout steps so existing page-shell
padding also leaves the raw-value census; they are not additional component spacing
choices.

### Reset layer decision

`@import "tailwindcss"` is deliberately retained at `app/globals.css:1` as the app's
load-bearing Preflight reset layer. No Tailwind utility classes are in use, and DES-13
does not adopt the Tailwind framework. A future removal must provide an equivalent
minimal reset in the same change and re-run the complete visual regression gate; it is
never a dependency-cleanup-only deletion.

## 4. Brand & nav decisions (owner, July 22)

- **Logo:** background paths removed from both SVGs; the transparent logo sits
  **directly on the cream sidebar — no card, no border** (`object-fit:contain`).
  Manifest/apple PNG icons keep their baked backgrounds byte-identical.
- **Nav:** same structure and items (no IA change). Polish only: 44 px collapse
  toggle repositioned inside the rail; the compact badge becomes real text via
  `FeatureStateBadge variant="compact"` (both `font-size:0` hacks deleted; the
  test allowlist empties to zero); collapsed-rail items ≥44 px tall; drawer
  focus-trap behavior re-verified at every breakpoint.

## 5. Meetings & calendar resolution (owner question, answered)

- **"Today's meetings" becomes a real Overview section** (DES-08d): a read-only
  list (max ~5 one-line rows + "and N more…") of today's/upcoming
  `project_meetings`, each row opening its project drawer; honest empty state.
  Joins the SET-35 section catalog (closed catalog + widen-on-read makes the
  addition safe). This is display of existing records — NOT scheduling; the
  scheduling boundary is untouched.
- **The Project-meetings metric card stays static-flat** — it counts saved
  meeting notes, not today's agenda; linking it would be dishonest.
- **A full Outlook/Gmail-style calendar** remains the Schedule page's future,
  behind the scheduling acceptance gate + WS-14. Out of this series.

## 6. Record-page list views (owner-approved amendment, August 3, 2026)

Leads keeps its board as the default and adds a persisted Board/List choice. The list
reuses the same lead-row content as the existing status panels; it is not a second record
action. Leads, Clients, and Projects use sortable row grids at 821 px and wider, with a
search field and compact sort controls in the card band. Every visible data column sorts
in both directions, desktop headers expose `aria-sort`, and every control keeps the
44 px target minimum. Client and Project results reveal progressively so an unbounded
record set is never reconciled in one render.

This is the deliberate, owner-approved exception to the rule against adding a second way
to do an existing action: the Board/List toggle and sortable headers are alternate views
of the same records, while whole-row activation remains the single way to open one. View
and sort choices are per-user settings stored with the existing page-layout
personalization data, not a separate browser-only preference system.

## 7. Layout-editor polish (DES-06)

Icon-only Edit button (`Settings2` only, `aria-label` byte-identical — e2e
selects by it — plus `title` tooltip, ≥44 px target; the Retry error variant
keeps icon + text). The add row renders **only when sections are hidden**,
retitled **"Hidden sections"** as a plain group label (no Plus icon, no button
styling); the unreachable "All available sections are shown." branch is deleted.
`PageTitle` wraps its `action` in `.title-actions`; Overview adopts `PageTitle`
so the Edit control sits in the identical place on both pages.

## 8. Test discipline (every packet)

Golden SHA256 hashes in `tests/e2e/page-layouts.spec.ts` regenerate only as a
sanctioned event available to ANY packet whose PR includes owner-approved
before/after screenshots of both pinned pages at 1280 (with the change
rationale) and updates the three additional pinning suites in the same commit;
each regeneration stays isolated to one PR with the diff reviewed to contain
only that packet's deltas, and every other packet treats unchanged hashes as an
acceptance criterion. The named-packet restriction (historically DES-05: both
hashes; DES-07: Reports only) was lifted August 3, 2026 by owner decision under
the standing law-lift rule (checklist 06); scope of the lift: the authority
model only — the hashes, the pinned selectors, and the three-suite requirement
are unchanged. All e2e `aria-label`s and
`data-layout-*` attributes are preserved byte-identical. Pinned-source tests
(`tests/rendered-html.test.mjs` CSS strings, asset SHA256s, copy pins) are
updated mutation-sensitively in the same PR as the change — never deleted.
DES-02 adds the undersized-control guard (Phase-4 item); DES-04 empties the
font-size-zero allowlist; DES-09 lands the reference screenshots.

**Aesthetic direction (owner, August 4, 2026):** the design language aligns to Apple
iOS/macOS — without going overboard — in service of the owner's stated goal: "a simple
and easy to navigate webapp so users are more inclined to use it." Value-level
execution and the Path A+ decision (no framework; evidence recorded) live in the plan
ledger's DES-13; the standing usability acceptance lens for DES packets lives beside
DES-16 in the same ledger. This spec's component grammar is unchanged by the
direction; where a future value choice here is ambiguous, Apple's Human Interface
Guidelines are the tiebreaker.

## 9. Order & interleaving (with the SET-30…34 series running in parallel)

```
globals.css lock (ONE holder at a time): DES-01 → DES-02 → DES-03(.brand) → DES-04 → DES-05 → DES-07
FloorOpsApp.tsx queue (strict serial):   FIX-07 → GI-04 → DES-06 → DES-05 → DES-04 → DES-07 → DES-08(b,c,d,a-T1)
Parallel-safe anytime:                   DES-03 SVG surgery; SET-30…34 (GoogleWorkspacePanel, module.css only
                                         while a DES packet holds the globals lock); SET-36; 8a-T2 joins the
                                         migration queue after the visual series; DES-09 closes.
```

The full packet definitions (Why / Do / Accept / Effort) live in the plan
ledger, Workstream F. What is deliberately NOT changed by this series: any API
route, server logic, authorization, persistence, or Google mutation path; the
nav IA; the Schedule page.
