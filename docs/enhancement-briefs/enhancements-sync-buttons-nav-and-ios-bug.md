# Seven UI items — auto-sync, button bulk, rearrangeable menu, collapsed-rail border,
# the brand mark, presentation mode, and one iPhone bug

**Requested by:** Jason (owner), August 3, 2026
**Status:** requirements only — not packets. Hand to Fable to plan.
**Verified against:** `origin/main` @ `301947d`, and the live site.

> **Item 3 is a defect, not an enhancement** — triage it separately.
> **Item 6 is already filed as DES-10** and is blocked on an owner variant decision, not
> on engineering.
> **Items 5 and 6 touch the same sidebar area** — do them together, not twice.

---

## 1. Stop making me press sync buttons

### What I want
The directory sync — and the other sync/refresh buttons — should happen on their own. I
shouldn't have to remember to press things to see current data.

### Why it is the way it is
**There is a test-enforced law against background work.**
`tests/ai-outbound-guard.test.mjs:388-391` asserts the Worker stays fetch-only and rejects
any `scheduled` handler. There is no cron trigger anywhere in the repo, and the
watch/queue design document records a polling schedule as *not authorized*. Every sync in
this app is a button because **nothing is allowed to run when no one is looking.**

So "just add a background sync" is an architecture change requiring an owner decision, not
a small feature.

### The options
- **A — Staleness-driven refresh during ordinary requests (recommended).** When you open a
  page whose data is older than a threshold, it refreshes as part of that request. This is
  the *sanctioned* pattern, not a loophole: AI-04 is chartered "computed on open", and a
  client-side timer already ships (`app/FloorOpsApp.tsx:450-468` re-fetches the dashboard
  at local midnight). Removes most button-pressing with no law change.
- **B — `waitUntil` deferral.** Kick work off during a request and let it finish after the
  response. Explicitly allowed. Good for the slower syncs so they never block a page.
- **C — Real scheduling.** A genuine background sync. **Requires the owner to lift the
  no-scheduler law**, and brings cost, failure-visibility and lease concerns with it.

**Recommendation: A, plus B for the slow ones.** Keep one explicit **Sync now** for when
you want certainty — but it becomes a reassurance, not a chore.

### Which buttons should NOT be automated
Some are manual **by design** and automating them would be a defect:
- **"Check for new form responses"** — deliberately on-demand and bounded to 25 rows, so a
  Sheet with 500 rows cannot produce a runaway. Automate the *checking*, never the
  *creating*: leads stay review-first.
- **Anything that files, approves, or creates a record.** Review-first is the app's
  backbone. This request is about removing chores, not removing approval.
- **"Verify calendar" / "Check readiness"** — these are setup verification steps a human is
  deliberately performing.

The buttons worth removing are the ones that only mean *"show me current data"*:
**Refresh operations**, **Refresh mirror status**, **Refresh** (inbox), **Load messages**.
Those should just be true when the page opens.

---

## 2. Buttons are bulky — reduce them

### What I want
Fewer and less bulky buttons. The screens feel heavy.

### What the measurements say
I scanned the live site today at 390 / 834 / 1280 across all 17 routes. Control counts per
page at 834px:

| Page | Controls |
|---|---|
| **Settings → Google Workspace** | **62** |
| Settings → Workflow & notifications | 43 |
| Settings → Calendar | 38 |
| Settings (My settings) | 33 |
| Inbox rules / Client Directory / Testing & launch | 30–32 |
| Overview | 31 |
| Projects / Clients / Inbox | 23–25 |
| Assistant / Leads / Reports / Schedule | 17–20 |

**Google Workspace is the outlier at 62 controls** — roughly triple a record page. It is
also the page with the one genuine layout defect found today (Rename/Open overlapping the
Operations health controls at every width). The bulk and the defect are the same problem:
too much crammed into one column.

### Recommendation
Target that page first rather than doing a global button audit. Concretely: collapse
completed setup stages (you don't need Stage 1's controls after Stage 1 is done), promote
**one** primary action per card and demote the rest into an overflow menu, and drop the
"Refresh…" buttons that item 1 makes unnecessary. Removing chore-buttons and reducing bulk
are the *same* piece of work — do them together.

**Constraint:** the design authority sets `--target-min:44px`. Buttons may become fewer and
visually lighter; they must not become smaller than 44px. Denser is fine, tinier is not.

---

## 3. **BUG** — info buttons don't display when pressed on iPhone

### What happens
On iPhone, tapping an information (ⓘ) button does nothing visible.

### What I verified on the live site
- **The touch handling is correct.** `WorkspaceInfoHint.tsx` explicitly separates touch
  from mouse: `onPointerEnter`/`onPointerLeave` only act for `pointerType === "mouse"`, and
  the click handler toggles on `pointerType === "touch"`. This is not a "they forgot
  mobile" bug.
- **A simulated touch tap does open the state.** At both 834px and 390px the wrapper gains
  the `open` class and the trigger's `aria-expanded` flips to `true`. So the state machine
  works.
- **Positioning is fine at iPhone width.** At 390px the tooltip lands at x=46, right edge
  314 — comfortably on-screen, and **not clipped by any ancestor**. Mobile CSS repositions
  it below the trigger as intended.
- **What I could NOT confirm:** whether it actually paints. In my measurements the computed
  `visibility` stayed `hidden` even with `.open` applied and the more-specific rule
  (`.info-hint.open .info-hint-tooltip { visibility: visible }`) matching. **That is most
  likely a measurement artefact** — the tab/iframe I measured in isn't foregrounded, and
  CSS transitions don't advance on unpainted content. I am not reporting it as the cause.

### Most likely cause, stated as a hypothesis
The tooltip animates via `transition: opacity .12s, transform .12s, visibility .12s`
(`app/globals.css:671`). **Transitioning `visibility` is a well-known fragile pattern**, and
iOS Safari is the browser most likely to leave it stuck. A tap that flips the class but
never repaints would look exactly like "nothing happens".

### What the fix should do
- **Test on a real iPhone or a proper iOS simulator.** My tooling cannot settle this, and
  the plan should not pretend otherwise.
- If confirmed, stop transitioning `visibility`. Toggle it discretely and animate only
  `opacity`/`transform`, or drive the open state from `hidden`/`display` rather than a
  transitioned property.
- **Add a regression test at iPhone width** that asserts the tooltip is actually visible
  after a touch tap — the current e2e suite clearly doesn't cover this or it would have
  caught it.

---

## 4. Let me rearrange the menu icons

### What I want
Reorder the left-hand navigation myself.

### What exists
Navigation is a **frozen nine-item array** — `OPERATIONS_VIEWS` in
`app/lib/operations-routes.ts:1-11`: Overview, Leads, Clients, Projects, Schedule, Inbox,
AI Assistant, Reports, Settings. It is `as const` and its type `OperationsView` is derived
from it, so the *set* is compile-time and used for routing and typing throughout.

**There is a strong precedent for exactly this.**
`app/components/operations/PageLayoutEditor.tsx` (DES-11) already lets a user reorder,
resize and hide sections against a catalog, with the layout persisted per page. Whatever
gets built here should extend that concept, not invent a second personalisation system.

### Recommendation
**Make the display order data; keep the const as the source of truth.** The nine views stay
a fixed compile-time union for routing and types; only the *render order* becomes a stored
per-user preference. That keeps every route, deep link and test valid while the sidebar
reorders freely.

Specifics worth stating in the plan:
- Persist alongside the existing page-layout preferences, not in a new mechanism.
- Drag to reorder, with a **keyboard-accessible alternative** — the layout editor already
  ships move-up/move-down buttons; reuse that pattern rather than drag-only.
- A **reset to default** control.
- **If hiding items is allowed, be careful:** Inbox and Overview carry attention signals.
  Hiding a nav item that would have shown a count means the user stops seeing work. Either
  disallow hiding for those, or surface the count elsewhere.
- Settings should probably be pinned last regardless — it is the escape hatch.

### Cost note
This touches `app/FloorOpsApp.tsx` (the sidebar renders there), so it **takes the
single-file queue slot** and must be scheduled against GI-04, AI-12 and the grid-view work.

---

## Suggested triage across these four

1. **Item 3 (iPhone bug)** — it is a defect on a live system; treat it separately and
   confirm on a real device first.
2. **Items 1 + 2 together** — auto-refresh removes the chore-buttons, which is most of the
   de-bulking. Doing them apart means touching the same screens twice.
3. **Item 4** — genuinely additive, and competes for the queue slot; schedule it when the
   slot is free.

---

## 5. Collapsed sidebar — drop the border on the workspace card

### What I want
When the sidebar is collapsed, the icon shouldn't have a box/border around it.

### Verified on the live site (1440px, sidebar collapsed)

| Element | Border | Background | Radius |
|---|---|---|---|
| `.workspace-card` | **1px solid rgb(213,201,189)** | rgb(250,248,245) | 10px |
| `.profile` | 1px solid rgb(213,201,189) (top separator) | transparent | 0 |
| `.brand-compact` (logo) | **0 — none** | transparent | 0 |

**This is an inconsistency, not just a preference.** The brand logo already renders with
no card and no border in the collapsed rail — and that is the owner-approved rule in the
design authority: *"the transparent logo sits directly on the cream sidebar — no card, no
border"* (`docs/specs/dashboard-design-spec.md:67-68`). The workspace card keeps its border,
fill and 10px radius, so the two neighbouring elements follow different rules in the same
rail.

**Recommendation:** in the collapsed state only, drop the border, background and radius on
`.workspace-card` so it matches `.brand-compact`. Keep them in the expanded state, where
the card shape is doing real work. Do not remove the `.profile` top border — that is a
separator, not a card edge.

Note `.workspace-card` and `.profile` are buttons that open popovers. Removing the visual
container must not remove the hit target: the 44px minimum still applies, and the hover
and focus-visible states must stay obvious without a resting border.

### Related observation — worth checking before this is built

While measuring, at **1440px viewport with the sidebar collapsed**, I found:
- `.app-shell` correctly carried `sidebar-is-collapsed` and `.sidebar` carried `collapsed`
- the rule `.app-shell.sidebar-is-collapsed .sidebar { width: 78px }` matched, with higher
  specificity than the `.sidebar { width: 246px }` base, and no competing media query
  applied (`(width <= 820px)` evaluated false)
- **yet the computed width stayed 246px**, with no inline style overriding it

I could not fully explain that from the browser, and I am recording it as an observation
rather than a diagnosis. **If it reproduces on a normal desktop browser, the collapse
control is not actually collapsing the rail** — which would be a bigger defect than the
border, and would also explain why collapsed styling looks half-applied. Worth confirming
first: if the rail does collapse to 78px normally, this note can be dropped.

---

## 6. The logo looks small and badly aligned — make it work on phone, iPad and desktop

### What I want
The menu logo looks weird — poorly aligned, and too small for the space it sits in, at
least on desktop. I want it to look right on all three: phone, iPad, desktop.

### This is already filed as DES-10, and the complaint is measurable

Measured on the live site at 1440px with the sidebar expanded:

| | |
|---|---|
| Brand slot | **154 × 82 px** |
| Logo source | **1254 × 1254 px — a perfect square** |
| `object-fit` | `contain` |
| **Actually painted** | **82 × 82 px** (height-constrained) |
| **Dead horizontal space** | **72 px — 47% of the slot width** |

**A square mark letterboxed into a wide slot is the whole problem.** `contain` scales to
the smaller dimension, so the logo can never be wider than the slot is tall. Nearly half
the brand area is empty, which reads as "small and off" exactly as described. Nothing is
misaligned in the CSS sense — the geometry simply cannot fill the space.

### What the plan must know (this is what makes DES-10 non-trivial)

- **The master SVG has no `viewBox`**, so it cannot be cropped or re-framed without one
  being added — and the frame paths have to be identified among **133 unlabelled paths**.
- **`tests/rendered-html.test.mjs:412-418` asserts `width="1254" height="1254"` for BOTH
  SVGs in a single shared loop.** Any aspect-ratio change forces that test to be split
  first. The DES-10 packet does not mention this; it will surface as an unexplained CI
  failure otherwise.
- The three variants differ sharply in cost and queue exposure:
  - **(a) re-frame the artwork** — needs the `viewBox` work above
  - **(b) change the markup** — edits `app/FloorOpsApp.tsx:1701`, so it **takes the
    single-file queue slot**
  - **(c) CSS-only** — small, no queue slot

### What I need to do before this can be built
**Pick a variant from mockups.** DES-10 is blocked on my design sign-off, not on
engineering. The plan should show me the three options rendered at phone, iPad and desktop
widths — including the **collapsed 34×34 rail mark**, which is a different problem from
the expanded logo and must be judged at the same time.

### Related
Item 5 above (collapsed workspace-card border) is in the same visual area. If DES-10 is
being opened, do both together rather than touching the sidebar twice.

---

## 7. A Settings toggle for "preview mode" that hides development labels

### What I want
A setting to turn dev/simulation mode on and off, which switches off the pill labels that
exist only for development, so the app looks more like a finished preview.

### These are two different things, and only one of them is safe

**Simulation mode is not cosmetic and must never be a UI toggle.**
`GOOGLE_INTEGRATION_MODE` decides whether Google calls are real or faked — and critically it
changes `connectionKey` (`app/lib/google-oauth.ts:439`: `simulation ? "workspace-simulation"
: "google-workspace"`). **Every integration table is partitioned by that key.** Flipping it
on a live tenant would not "switch to preview" — it would swap the entire data partition, so
filed emails, Drive mappings, review queue and watermarks would all appear to vanish, and
flipping back would appear to restore them. That is a deploy-time value. **Leave it in the
hosted environment.**

**Hiding the development labels is a separate, reasonable request** — and it is the part
worth building.

### The labels are not all the same, and this is the crux

`FeatureStateBadge` has four states with distinct meanings
(`app/components/FeatureStateBadge.tsx:1-9`):

| Badge | Compact | Means | Safe to hide? |
|---|---|---|---|
| **Working** | Working | Available with durable saved records | **Yes** — hiding loses nothing |
| **In development** | Dev | Available for development and test-data validation | **Yes** — this is the dev noise |
| **Setup required** | Setup | Available once a connection/config is completed | **No** — it explains *why* something is not working |
| **Planned** | Planned | **Informational only; the workflow is not implemented yet** | **No** — hiding it implies a feature exists when it does not |

**Hiding "Planned" and "Setup required" would make the app lie.** A whole packet — **SET-06,
"Truthful labels for persisted-but-inert settings"** — was spent making these honest,
because settings existed that saved values nothing consumed. A blanket toggle would re-hide
exactly what SET-06 revealed, and the next person to use the app would believe a Planned
feature works.

### Recommendation — "Presentation mode", selective, and obvious

An Administrator-only toggle in Settings, stored **per user** (not globally — one person
presenting must not change what everyone else sees).

**When on, hide:**
- `In development` / `Dev` badges, including the nav pills
- The `Development environment · Test data only` banner
- The `Development workspace` label in the sidebar
- `Working` badges (positive-only; they add noise without adding information)

**When on, keep:**
- `Planned` and `Setup required` badges — these are statements that something does not work
  and must survive any presentation mode
- All honest empty states ("Saved — not yet applied", "Not yet captured")

**Also required:**
- A **persistent, subtle indicator** that presentation mode is on, and a one-click exit. The
  failure mode is forgetting it is enabled and later believing a Planned feature shipped.
- It must **change nothing but presentation** — no route behaviour, no data, no gating.
  Assert that in a test.

### Why this shape rather than a blanket switch
The owner's underlying want is *"show this to someone without it looking like a building
site."* That is fully served by hiding dev-only chrome. Hiding the two badges that mean
"this does not work" serves a different want — making it look more finished than it is —
and that one costs the honesty the rest of the app is built on.

### Note for the plan
`FeatureStateBadge` is rendered from `app/FloorOpsApp.tsx` (nav at `:1712-1715`, project
capabilities at `:2548`), so this **takes the single-file queue slot**. It is small, but it
serialises against GI-04, AI-12 and the other queue holders.
