# Settings redesign specification — Google Workspace four-stage flow

**Status:** Approved by the owner on July 21, 2026 (wireframe sign-off). This document is
the design authority for the SET-29…SET-34 packet series in
`docs/agent-plan-architecture-workspace-and-setup.md`. The approved wireframe is
committed beside this file as `docs/settings-redesign-wireframe.html`.

**Inputs:** the July 2026 settings design review (Fable), the full-review UI-honesty
lens findings at pinned commit `58e4498`, and the owner's design directives.

**Audience for the redesign:** a small (~20-person) flooring company on Google
Workspace Business. One or two administrators run setup once and touch it rarely
afterward; everyone else never sees these screens.

---

## 1. Owner design directives (apply to every decision)

1. **Simple and straightforward.** Fewer, clearer surfaces beat feature density.
   Anything an admin touches once a year sits behind progressive disclosure; anything
   weekly stays one click away.
2. **Instructions where a property needs explaining.** A reusable info-hint (ⓘ) on any
   field, row, or chip whose meaning is not obvious — hover/focus tooltip on desktop,
   tap-to-reveal at 390 px, plain language ("The app's ID card with Google", not OAuth
   jargon), never containing environment values or secrets.
3. **One status source; plain words over badges.** Owner-facing text says what to do
   next ("Finish Stage 1, then Connect"), not what subsystem state is.

## 2. The problem being fixed (evidence)

The Google Workspace section (`app/settings/components/GoogleWorkspacePanel.tsx`) has
absorbed six packets of cards since its last design pass and is now a nine-piece
single-column scroll: heading → mode card → domain checklist → five numbered steps →
blueprint editor → resources table → connection-health table → filing modal.

Verified frictions (full-review UI-honesty lens, P2, at `58e4498`):

- **The same mode/connection state is restated nine times** in one panel (mode card
  title + badge; Step-1 chip; connection strong-text; connection status span; Resources
  header status; Resources "Mode" row; Connection-health header status; Connection-health
  "Mode" row; Connection-health "Status" row), sourced from **three independently loaded
  endpoints** (`/api/v1/google-workspace`, `/api/v1/integrations/google/setup/resources`,
  `/api/v1/integrations/google/connection`) that can transiently disagree during partial
  loads.
- The Resources table and Connection-health table are near-duplicates stacked at the
  bottom.
- Hosting/env-var guidance is interleaved mid-flow inside the numbered steps, so a
  click-through admin hits deployment concerns between actions.
- Other sections (Client Directory, Testing & launch) bounce users to the top of this
  panel rather than to the relevant part.
- The non-admin nav label ("My settings") does not match its section name
  ("My account").

## 3. The redesign — four-stage setup flow

The panel becomes **one status banner + four collapsible stages**. Stages
auto-collapse when complete; the first incomplete stage auto-expands. Every stage
works at 390 px. The approved wireframe (`docs/settings-redesign-wireframe.html`)
shows the target layout.

### 3.1 Status banner (the single source of truth)

One banner at the top of the panel, always visible:

- **Mode chip:** `SIMULATION` or `WORKSPACE` (from the effective config the panel
  already loads).
- **Headline + next step in plain words:** e.g. "Not connected to Google yet — Next:
  finish Stage 1, then Connect", "Connected as ops@… — Next: create your workspace in
  Stage 3", "Simulation ready — everything below runs locally".
- **Progress:** "Stage N of 4" + current stage name.

The banner **replaces** every duplicate mode/status display listed in §2: the mode
card, the Step-1 restatement, the Resources header status and Mode row, and the
Connection-health header/Mode/Status rows all disappear as their content migrates.
Per-stage headers carry only a stage chip (`DONE` / `IN PROGRESS · x of y` /
`WAITING ON STAGE N`), never a second mode/connection readout. Rule for all future
cards: **mode and connection state render only in the banner and stage chips.**

The banner derives from the endpoints the panel already calls; it introduces no new
API. While any source is loading, the banner says "Checking current status…" rather
than guessing; if sources disagree, the banner shows the most conservative state and
the health expander (Stage 2) shows the details. The UI never fabricates backend
state.

### 3.2 Stage 1 · Prepare the tenant

Everything done **outside** the app, usually by the Workspace admin (Brett's lane).

Contents, in order:
1. The domain/tenant checklist (today's `WorkspaceDomainChecklistCard`), rendered as
   DONE/MISSING rows with one ⓘ per row.
2. The hosted-configuration prerequisites table (which env values exist vs. are
   missing — names only, never values).
3. The copy-exact helpers (redirect URI, settings template, key command), relocated
   here from the current steps so hosting concerns never interrupt the click-through
   flow. The Step-2/Step-5 env-var notes move here too.

**Completes** when `connectReady` is true. The stage chip shows "x of y" while
incomplete.

### 3.3 Stage 2 · Connect

One action: authorize (or reconnect / disconnect) the one company Google account —
today's Step 1. **Connection health** (account, granted-vs-enabled services,
reauthorization warnings — today's bottom Connection-health card) becomes an
**expander inside this stage**: health is connection detail, not a separate card.
In simulation mode the stage explains that no Google account is involved and offers
the simulation reset here.

**Completes** when connected (live) or immediately (simulation), per the existing
`connectReady`/connection-status semantics — no new backend logic.

### 3.4 Stage 3 · Define & create your workspace

The blueprint editor (`WorkspaceBlueprintEditor`) and the resource actions
(`WorkspaceDriveResourceActions` + the Resources table) **unify into one
define-then-create surface**. The blueprint sits beside a **dependency-ordered
creation list** where each row unlocks the next:

1. **Shared Drive** — adopt/verify (today's Step 2 + the shared-drive adopt action)
2. **Folder tree** — from the blueprint (ensure-roots)
3. **Spreadsheets** — Client Directory, Project Register, and owner-defined extras
   (sheets ensure)
4. **Templates** — after folders exist
5. **Calendars** — verify-only until WS-14 lands, labeled as such

Each row shows its own state (`FOUND — ADOPT` / `CREATE` / `AFTER DRIVE` …) with an ⓘ
explaining what will be created and where. The current Resources/Health duplicate
tables merge into this single list. All existing server behavior (leases, review-first
adoption, never-delete, idempotency, simulation parity) is unchanged — this is a
presentation unification only.

**Completes** when every required row reports created/adopted (calendar verify-only
rows do not block completion while WS-14 is pending).

#### 3.4.1 Stage 3 row copy (normative for SET-32 — labels, chips, InfoHints)

| # | Row label | State chips | InfoHint (ⓘ) text |
|---|-----------|-------------|--------------------|
| 1 | Shared Drive | `FOUND — ADOPT` / `VERIFY` / `DONE` | "The one company drive where every project folder lives. The app never creates a second drive — it adopts the one your admin set up." |
| 2 | Folder tree (from your blueprint) | `AFTER DRIVE` / `CREATE` / `DONE` | "Creates the top-level folders exactly as your blueprint defines them. Rename them from this screen later — never directly in Drive." |
| 3 | Spreadsheets | `AFTER FOLDERS` / `CREATE` / `DONE` | "The Client Directory and Project Register the app keeps in sync, plus any extra sheets you defined. The app is the source of truth — the sheets are mirrors." |
| 4 | Templates | `AFTER FOLDERS` / `CREATE` / `DONE` | "Starter documents — estimate, work order, change order, checklist, budget — placed in your Templates folder. Edit their content in Google; the app only creates them." |
| 5 | Calendars | `VERIFY ONLY` | "Checks that the appointments calendar your admin shared is reachable. The app doesn't create calendars yet — that arrives with a later update." |

Locked-row caption (when a dependency is unmet): "Unlocks after <previous row>." —
plain words, no jargon. Every chip term above is the exact rendered text.

### 3.5 Stage 4 · Verify & maintain

First-run verifications — Gmail labels + test email (Step 3), Calendar window/test
hold (Step 4), Sheets mirror sync (Step 5) — followed by the **ongoing** surfaces,
clearly labeled "ongoing" rather than first-run: drift check/reconcile (SET-18 when it
lands), renames, notification routing. This stage never shows "complete"; its chip
reads `READY` once every service verification has passed at least once.

#### 3.5.1 Stage 4 copy (normative for SET-33 — labels, sections, InfoHints)

First-run verification rows:

| Row label | InfoHint (ⓘ) text |
|-----------|--------------------|
| Gmail — labels & test email | "Creates the three FCI labels and sends one test email to yourself to confirm filing works. Nothing is ever sent to clients from here." |
| Calendar — appointments & test hold | "Reads the upcoming appointments window and can create one private test hold with no invitations — confirm access without touching anyone's calendar." |
| Sheets — mirror sync | "Runs one sync of the Client Directory and Project Register mirrors and reports exactly what changed." |

Ongoing section: group label **"Ongoing upkeep"** with the caption "Tools you'll
come back to — these never block setup." Rows: drift check ("Compares your
blueprint with what's actually in Drive and shows any differences before you fix
them."), renames ("Rename managed folders safely — the app updates Drive and its
own records together."), notification routing (existing card copy unchanged).
The stage chip is `READY` (never `DONE`); before all three verifications have
passed at least once it shows `x OF 3 VERIFIED`.

### 3.6 Cross-cutting rules

- **Anchors:** the SET-07 section slug is preserved unchanged; each stage gets a URL
  anchor (`#workspace-stage-1` … `#workspace-stage-4`). Bounce-links from other
  sections (Client Directory's "Configure", Testing & launch's "Google setup") target
  the specific stage anchor, not the panel top.
- **Naming:** the non-admin nav label and section name unify (one name — "My
  settings" — in both the audience navigation and the section switch).
- **Non-admins** never see any of this (unchanged; UI gating remains honesty, not
  security — server-side authorization is untouched).
- **390 px:** stages stack full-width; ⓘ hints are tap-to-reveal; the banner wraps to
  two lines (mode chip + headline, then progress).
- **The filing modal** (`GmailFilingModal`) is unaffected.

### 3.7 What deliberately does NOT change

No API routes, server logic, authorization, persistence, blueprint semantics, lease
behavior, simulation behavior, or Google mutation paths change in this series. The
redesign is a settings-UI restructure only. Defect fixes discovered by the full
review (shared sheet-status label mapper, admin-gating single source) are **FIX
packets in the full-review ledger**, not part of this series — SET-33 consumes the
label-mapper fix if it has landed, and falls back to the polished FloorOpsApp label
map otherwise.

## 4. New primitives

### 4.1 `InfoHint`

One reusable component (extends the blueprint editor's existing lock-badge +
reason-tooltip pattern): an ⓘ trigger rendering a plain-language tooltip on
hover/focus (desktop) or tap (mobile), dismissible with Escape, `aria-describedby`
wired, max ~2 sentences, **never containing env values or secrets**. Used by every
blueprint field, creation-list row, checklist row, and stage chip whose meaning is
not obvious.

### 4.2 `SetupStage`

The collapsible stage shell: number, title, one-line description, stage chip,
open/closed state. Auto-behavior: complete stages collapse (manually expandable);
the first incomplete stage expands. State derives from the completion conditions in
§3; nothing is stored server-side.

## 5. Test strategy for the migration

`tests/e2e/workspace-setup-stepper.spec.ts` (~1,000 lines) and the settings unit
suites assert today's step structure. Each migration packet must keep the suite
green by **mutation-sensitively updating** assertions to the new structure — never by
deleting coverage: every behavior asserted today (step gating, admin gating, honest
status text, copy-helper contents, resource action outcomes, simulation parity) must
have an equivalent assertion against the new frame, plus new assertions for: banner
single-source rule (the old duplicate status strings no longer render), stage
auto-collapse/expand, anchor navigation, and InfoHint accessibility.

## 6. Packet series and sequencing

All packets touch `GoogleWorkspacePanel.tsx` — they run **strictly one at a time, in
order** (same-file rule): **SET-29** (shell: banner + stages + InfoHint, existing
cards slotted unchanged) → **SET-30** (Stage 1 interior) → **SET-31** (Stage 2 +
health expander) → **SET-32** (Stage 3 unified define-and-create) → **SET-33**
(Stage 4 verify & maintain) → **SET-34** (anchors, naming unification, 390 px polish,
final duplicate-status sweep).

Wave placement (anti-rework order): full-review **R1 foundation fixes** land first,
then this series (**R2**), then settings-UI fixes on the new frame (**R3**), then the
feature queue resumes stage-native (**R4**). Settings-UI feature packets that would
add cards to the old layout (SET-23 viewer placement, SET-24, SET-27 card) **wait for
SET-29**; engine-side packets (SET-17, SET-18, SET-21, SET-25, GI-04) are unaffected
and may proceed in parallel.
