# Dashboard design enhancement — DES series specification

**Status:** Approved by the owner on July 22, 2026 (plan sign-off; the visual
mockup `docs/dashboard-design-mockup.html` accompanies this spec for the
affordance-grammar and brand-treatment look). This document is the design
authority for the DES-01…DES-09 packets in
`docs/agent-plan-architecture-workspace-and-setup.md` (Workstream F).

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

## 3. Design tokens (DES-01 establishes; values = current dominants, so paint is unchanged)

`--radius-chip:6px · --radius-control:8px · --radius-card:10px ·
--radius-pill:999px · --control-compact:34px · --control-standard:40px ·
--control-page:42px · --target-min:44px · --shadow-card:0 1px 2px
rgba(29,55,40,.04) · --shadow-raised:0 5px 15px rgba(29,55,40,.06) ·
--shadow-overlay:0 25px 70px rgba(35,31,32,.65)` — one `:root` block only; the
duplicate block and alias tokens (`--muted`, `--green`…) are removed after their
usages are rewritten. Green-tinted legacy borders normalize to `var(--line)` /
`--line-soft:#e6e0d8` (the series' one deliberately visible, subtle change).

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

## 6. Layout-editor polish (DES-06)

Icon-only Edit button (`Settings2` only, `aria-label` byte-identical — e2e
selects by it — plus `title` tooltip, ≥44 px target; the Retry error variant
keeps icon + text). The add row renders **only when sections are hidden**,
retitled **"Hidden sections"** as a plain group label (no Plus icon, no button
styling); the unreachable "All available sections are shown." branch is deleted.
`PageTitle` wraps its `action` in `.title-actions`; Overview adopts `PageTitle`
so the Edit control sits in the identical place on both pages.

## 7. Test discipline (every packet)

Golden SHA256 hashes in `tests/e2e/page-layouts.spec.ts` regenerate in exactly
TWO packets (DES-05: both hashes; DES-07: Reports only), each isolated to one PR
with the diff reviewed to contain only that packet's deltas; every other packet
treats unchanged hashes as an acceptance criterion. All e2e `aria-label`s and
`data-layout-*` attributes are preserved byte-identical. Pinned-source tests
(`tests/rendered-html.test.mjs` CSS strings, asset SHA256s, copy pins) are
updated mutation-sensitively in the same PR as the change — never deleted.
DES-02 adds the undersized-control guard (Phase-4 item); DES-04 empties the
font-size-zero allowlist; DES-09 lands the reference screenshots.

## 8. Order & interleaving (with the SET-30…34 series running in parallel)

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
