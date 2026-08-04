# Enhancement request — dense list/grid views with filtering, and the iOS design question

**Requested by:** Jason (owner), August 3, 2026
**Status:** requirements only — not a packet. Hand to Fable to plan.
**Verified against:** `origin/main` @ `301947d`, and the live site.

---

## 1. What I want, in plain terms

I want to see my data in a **grid** and **filter it**.

Right now the app is card-heavy and it feels clunky. When I want to answer a simple
question — *"show me every active lead"*, *"which projects are unscheduled"*, *"who
haven't we contacted in two weeks"* — I have to visually scan cards spread across a
board instead of reading a dense list I can sort and narrow.

I want this to be **done right from a best-practices standpoint**, and I want the design
to **match iOS**.

Three questions I want answered as part of the plan:
1. Is a grid view already part of the design and I just can't find it?
2. If not, what is the best way to build it?
3. Is a full redesign necessary?

---

## 2. What actually exists today — answering question 1

**Short answer: no, there is no grid view of leads, and there is no sorting anywhere.**
This is a real gap, not a discoverability problem.

Verified against source:

| Screen | How it renders today | Dense view? | Sort? | Filter? |
|---|---|---|---|---|
| **Leads** | Kanban **board** — `.board` → `.board-column` per stage → `article.lead-card` per lead (`app/FloorOpsApp.tsx:1956`) | **No** — cards only, no list alternative | No | Report filter only |
| **Projects** | Row-shaped layout — `.project-row` with identity / status / details / value spans (`:2013-2016`) | Partly — rows, but not a table | No | Status filter (`ProjectStatusFilter`) |
| **Clients** | `ClientsView` (`:1966`) | Partly | No | No |
| **Schedule** | — | No | No | No |

**A table primitive already exists and is not used for records.**
`app/components/operations/OperationsDataTable.tsx` takes `columns` + rows and renders a
plain `<table>`. It has **no sorting, no filtering, no column selection** — it is purely
presentational. Its only consumers are Settings and import surfaces
(`GoogleWorkspacePanel`, `InboxRulesPanel`, `WorkspaceOperationsHealthCard`,
`WorkspaceReconcileCard`, `WorkspaceDomainChecklistCard`, `FirstRunImportCard`). **No
record page uses it.**

**Filtering today is one narrow slice per page, not a system.** There is a single global
`searchTerm` (`:598`), a project status filter, and a report-driven lead filter. There is
no shared filter model, no multi-criteria filtering, no saved views, and no sort control
anywhere in the app.

**There is already precedent for user-configurable views.**
`app/components/operations/PageLayoutEditor.tsx` (DES-11) lets a user reorder, resize and
hide sections against a section catalog, persisted per page. Whatever gets built should
sit alongside that concept rather than inventing a second, competing personalisation
model.

---

## 3. Is a redesign necessary? — answering question 3

**No. And I would push back on doing one.** Three reasons, in order of weight:

**a) The problem is not "cards vs grid" — it is that there is no dense view at all, and
no sorting.** Replacing cards with a grid would fix the density complaint and lose the
board, which is genuinely good for a pipeline. The actual defect is that Leads offers
*only* the board. Adding a second view mode is additive and cheap; a redesign is
expensive and throws away work that is already owner-approved.

**b) There is an owner-approved design authority, and it is specific.**
`docs/dashboard-design-spec.md` pins interaction rules that a redesign would have to
re-litigate: one interaction rule per element (an interactive card is a whole-card link,
never nested buttons inside a clickable card); interactive vs static cards visibly
different; a fixed radius and shadow scale (`--radius-card:10px`, `--shadow-card`); and
`--target-min:44px`. **That 44px minimum is already the iOS touch-target standard** — the
foundation is closer to iOS than the card-heaviness suggests.

**c) Two pages are byte-pinned and a global redesign would fight them.**
`tests/e2e/page-layouts.spec.ts:8-9` holds SHA-256 digests of the **Overview** and
**Reports** markup, regenerable only by two named packets. **Leads, Clients, Projects and
Schedule are NOT pinned** — which is exactly where this work belongs. A record-page view
toggle can be built without touching a golden hash. A redesign cannot.

**Recommendation: additive view modes on the four record pages. No redesign.**

---

## 4. The iOS requirement — the most important thing in this document

**"Grid view with column filters" and "match iOS" pull in opposite directions, and this
has to be resolved before anything is built.**

Apple's Human Interface Guidelines have no real "data grid" idiom. iOS does **lists**:

- A **single-column list** of rows, each with leading content (avatar/icon), a primary
  and secondary line, and trailing content (value, chevron, status).
- **Inset-grouped** sections with section headers — not spreadsheet gridlines.
- **Filtering via a search field plus a segmented control**, not per-column header menus.
- **Swipe actions** for row-level operations, and a long-press context menu.
- Sorting exposed through a **menu button**, not clickable column headers.

A spreadsheet-style grid with sortable column headers, resizable columns and per-column
filter dropdowns is a **desktop/web idiom**. It is what people usually mean by "grid" —
and it is explicitly *not* iOS.

**So the plan must pick one and say so:**

- **Option A — iOS-native list (my recommendation).** A dense, inset-grouped list with a
  search field, a segmented filter, and a sort menu. Reads as native on iPhone and iPad,
  matches the stated iOS goal, and reuses the existing 44px target rule. On wide screens
  it can add columns progressively without becoming a spreadsheet.
- **Option B — true data grid.** Sortable/resizable columns, per-column filters, column
  chooser, density toggle. Better for bulk desktop triage. **Will not look like iOS**, and
  will conflict with the card-and-list visual language already approved.
- **Option C — responsive hybrid.** iOS list on narrow widths, grid on wide. Honest to
  both, and the most work: two layouts, two sets of interaction rules, two test surfaces.

**My recommendation is A**, with the note that "grid" in the original request most likely
means *"dense and filterable"* rather than *"literally a spreadsheet"*. That distinction
should be confirmed with me before build.

---

## 5. What I want built (functional requirements)

**View toggle** on Leads, Clients, Projects and Schedule: **Board / List** on Leads,
**List** as the default elsewhere. The choice persists per user, alongside the existing
page-layout preferences rather than in a new mechanism.

**A shared filter model, not per-page one-offs.** One filter component reused across all
four pages, driven by a common shape, so a filter learned on Leads works identically on
Projects. Filter state belongs in the URL so a filtered view can be bookmarked and shared
— the app already does this for `?section=` and `?bucket=`.

**Filters, per record type:**
- Leads: stage, owner, source, estimated value range, date created, stale-since
- Clients: status, industry, has-active-projects, last activity
- Projects: status, lifecycle, client, flooring category, scheduled/unscheduled, value range
- Schedule: date range, crew, project, meeting type

**Sorting** on every column shown, ascending/descending, with the current sort visible and
persisted with the view.

**Density** that is honest about the data: show the fields people actually decide on. For
leads that is company, stage, value, owner, next action, age — not everything the record
holds.

**Empty and filtered-empty states must differ.** "No leads yet" and "no leads match these
filters" are different situations and the second needs a one-click clear. The app already
does this correctly on Leads (`:1956`) — keep that standard.

**Bulk selection is explicitly out of scope for v1.** Selecting rows implies bulk edit and
bulk delete; record editing is still being built (EDIT series) and archive-only is a
recorded owner decision. Do not build selection until there is something safe to do with it.

---

## 6. Constraints the plan must respect

- **`app/FloorOpsApp.tsx` is a single-file queue slot.** All four record views render from
  that file, so this work takes the slot and must claim it in the queue appendix. It cannot
  run in parallel with GI-04 or the other queue holders.
- **Do not regenerate the Overview or Reports golden hashes.** This work should not touch
  either page.
- **Follow the existing design authority** (`docs/dashboard-design-spec.md`) or amend it
  deliberately in the same PR — not silently.
- **44px minimum touch targets** are already the rule and must survive a denser layout.
  This is the main tension in "dense" plus "iOS", and it is where the design will be won or
  lost: rows can be tight, but tappable things cannot shrink below 44px.
- **Accessibility:** a real `<table>` with proper headers and scope if Option B, or a
  correctly-labelled list if Option A. The e2e suite runs axe; a new view must pass it.
- Test cost is real: new views need e2e coverage at the responsive widths the nightly
  program already scans (390 / 834 / 1280).

---

## 7. Open questions for me to answer before build

1. **"Grid" — do I mean a dense sortable list (iOS-native), or a true spreadsheet grid?**
   This determines Option A vs B and everything downstream.
2. **Does the Leads kanban board stay?** I like seeing pipeline stages; the list is meant
   to be an addition, not a replacement — confirm.
3. **Saved views** ("My open leads", "Unscheduled jobs") — v1 or later?
4. **Which fields matter most per record type?** Whoever builds this should not guess at
   my columns.
5. **Phone vs desktop priority.** Crews are in the field; office staff are at desks. If
   phone-first, that further supports Option A.
