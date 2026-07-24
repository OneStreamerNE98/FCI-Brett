# Holistic review — July 23–24, 2026 — findings ledger

**Review target:** `origin/main` as of July 23–24, 2026 (post-merge state through
PR #148 / commit `4da89b4`). This is a *holistic* quality walk of the merged waves
that landed since the July 21 full review, not a fresh whole-codebase audit.

**Merged waves reviewed:** FIX-01..07 + FIX-10 (route-through-effective-config,
blueprint-aware provisioning, simulation parity, test-infra, sheet-mirror labels,
API uniformity, admin single-source, advisory-lock guard); SET-29..35 (the
four-stage Google Workspace settings redesign + My-settings rename/admin gating +
settings persistence); DES-01..03 + DES-06 (design tokens/borders, transparent
brand on cream, layout-editor + PageTitle unification); AI-01 + AI-03 (settings
persistence closure, org-wide agentic assistant); BE-07 (settings/prefs port to
PostgreSQL, workspace_settings single authority, calendar/sheet-ID precedence);
WS-13 (dev→prod connection boundary doc); GI-02/03 and KPI-01..03 (as merged).

**Method:** three review rounds plus adversarial verification and a dedup-first
filing discipline.
- **R1 — design walk (4 lenses, 32 fresh captures):** desktop-core, desktop-settings,
  mobile (390px), baseline-diff, each pixel-and-source against
  `dashboard-design-spec` and `settings-redesign-spec` (incl. normative copy
  3.4.1/3.5.1 and the 3.6 390px rules).
- **R2 + R2b — functionality walks (live Playwright, simulation DB):** core-flows
  (Leads/Projects/Meetings), settings-flows (full A2b surface), and gap-flows
  (Clients/Inbox/filing-rules/Uploads), each verifying every UI claim against the
  network response AND a reload.
- **R3 — code lenses (4):** google-integration correctness, state/persistence
  boundary, duplication/dead-code, test-guard sustainability — source-parity on
  origin/main.
- **Adjunct:** a forms-only InfoHint copy audit (B2) and the T0.1 backlog dedup
  index mapping every surface to its open owning packet.
- Every P1/P2 candidate was adversarially verified by an independent refuter; the
  verdict (CONFIRMED severity, upheld or adjusted) is folded into each entry below.
  Findings were deduplicated across rounds AND against the ~90-packet open backlog:
  a defect an open packet already owns is tagged KNOWN (appendix), not filed.

**Reviewed by:** Opus / Fable review fleets under Fable orchestration.

**Overall verdict: healthy.** No P1, no P0, no data-integrity or security defect
surfaced in any round. The merged waves landed faithfully to their specs: the
four-stage GW redesign renders as approved (banner-as-single-source, stage chips,
normative Stage 3/4 copy), design tokens/transparent brand are consistent, the
state/persistence boundary has no silent pref-wipes or drawer/list/KPI desync, and
the Google-integration write paths keep their lease/idempotency/error-honesty
guarantees. Every filed defect is polish or state-honesty debt concentrated in the
Google Workspace settings surface (which one or two admins touch during one-time
setup) plus a small cluster of toast/label/CSS rough edges. The recurring theme is
**status honesty inside the settings surface** — a handful of places where two
independently-derived signals disagree on the same row (Stage-3 done-vs-locked),
a component-state readiness that does not survive reload (Stage-4 READY), or one
stored value wearing two labels (reminder hours).

---

## Confirmed findings

Severity is the adversarially-verified level (never above what a refuter upheld).
Pre-existing-vs-wave-caused is noted where known.

### P2 — should fix, not urgent

#### H-1 · Stage-3 "Create in order" rows render DONE and locked simultaneously (P2)
**Lenses:** [google][setup-maintenance][simple][navigate] — found independently by
**three** R1 lenses (desktop-settings, mobile-390, baseline-diff); one finding.
**Where:** `app/settings/components/WorkspaceDriveResourceActions.tsx` — `CreationRow`
render L461–474; dependency derivation L583–597; row wiring L665–692 (Spreadsheets
row L668–672).
A Stage-3 creation row can display a green **DONE** chip, a contradictory
**"Unlocks after Shared Drive."** lock caption, and a **disabled** action button all
at once. The chip/`complete` prop derives from `progress.spreadsheetsComplete`
(per-group, computed independently at L117–121), while the lock caption derives from
`spreadsheetsEnabled` which chains on `sharedDriveComplete && foldersComplete`
(L552–553). The two are not mutually exclusive, and `CreationRow` applies both the
`creationRowComplete` and `creationRowLocked` classes and renders both the DONE
chip and the unlock caption with no reconciliation (L461–474). In the seeded sim
state — Shared Drive still shows VERIFY (`sharedDriveComplete=false`) while sheets
are seeded app-managed with `externalId` (`spreadsheetsComplete=true`) — the row
reads as both already-done and still-blocked, and the "N of 4 ready" counter counts
a group that sits behind an unadopted drive. The exact multi-source status
disagreement the banner redesign set out to neutralize, resurfacing inside a stage
row.
**Repro:** open Settings → Google Workspace → Stage 3 on the default sim seed;
Spreadsheets row shows `DONE` + `Unlocks after Shared Drive.` + greyed "Ensure
spreadsheets" (`settings-gw-stage-3-1280.png`, and same at 390 in
`settings-google-workspace-390.png`).
**Related manifestation (same root, P3):** on locked rows the state **chip** and the
lock **caption** name *different* blockers — Templates chip reads `AFTER FOLDERS`
while its caption reads `Unlocks after Shared Drive.` (chip encodes the static
dependency tier, caption the current root blocker). Same independent-derivation gap
in the same component; folded here, not filed separately.
**Dedup:** SET-32 (Stage 3 unify) is **merged/Complete**; FIX-12 owns route
wrapper/re-scroll/dead props; SET-18 owns reconcile/drift — none cover a
per-group-completeness-vs-gating conflict. Not in the dedup index. **New.**
**Severity note:** held at P2 (not P1) because it is only reachable via seeded dev
data (children complete while the drive is unadopted) — the real gated forward flow
prevents creating sheets before drive adoption, and the disabled button plus caption
are corrective cues. State-model polish debt a small-org admin doing one-time setup
would notice, not a one-directional production mislead.
**Disposition:** new packet **FIX-18** (make the row's complete/locked states
mutually exclusive; reconcile chip and caption to one blocker source).

#### H-2 · Stage-4 verification READY is not durable across reload/navigation (P2)
**Lenses:** [google][setup-maintenance] — R2 settings-flows (reproduced live).
**Where:** `app/settings/components/GoogleWorkspacePanel.tsx` — Gmail/Calendar
readiness state ~L353–356; mount init ~L383–394; derivation L838–918.
After all three Stage-4 checks pass, the stage chip reads **READY**, but any reload
**or** in-app navigate-away-and-back silently reverts it to **"1 OF 3 VERIFIED"**:
Gmail and Calendar drop to READY TO VERIFY while only Sheets (DB-derived) stays
VERIFIED. `gmailLabelsReady` / `gmailTestEmailPassed` / `calendarChecked` live only
in component `useState` and are never re-hydrated from the server on mount;
`checkSetup` re-derives only `sheetsVerificationPassed` from the DB mirror. A
launch-verification stage that claimed done now claims incomplete with no user
action and no backend change. It also contradicts the API on load: `GET
/gmail/messages` returns `labelReady:true` while the Gmail row shows READY TO VERIFY.
**Repro:** drive Stage 4 (Prepare labels + Add sample → 1; View events → 2; Sync now
→ chip READY); reload → chip "1 OF 3 VERIFIED", Gmail+Calendar "READY TO VERIFY",
Sheets "VERIFIED".
**Dedup:** not in backlog (SET-08 = Stage-1 launch checklist, not Stage-4). The
existing e2e pins forward progression and in-page "Check readiness" keeping READY,
but never test reload/remount persistence. **New.**
**Severity note:** P2 (not P1) — Stage 4 is not actually launch-gating
(`stageCompletion` is hardcoded `false`, L840), so progression is unaffected; it
misleads the admin about completion but has a trivial re-click workaround. The
server already holds the truth (`labelReady:true`), so this is a rehydration gap,
not a data loss.
**Disposition:** new packet **FIX-13**.

#### H-3 · One reminder-hours value is surfaced under two conflicting labels (P2)
**Lenses:** [setup-maintenance][simple] — R3 state-persistence (verified), **and**
independently surfaced by the InfoHint audit B2 shared-state note with the same line
numbers. One finding, two evidence trails.
**Where:** `app/settings/components/WorkspaceDefaultsPanel.tsx` — L146 (calendar
section) renders `settings.appointmentReminderHours` as **"Appointment reminder
hours"**; L170 (workflow section) renders the *same state slot* as **"Client reminder
hours"**. Both `onChange` handlers write `settings.appointmentReminderHours`, and
`save()` PATCHes the whole object. Field defs L22–23 confirm only
`appointmentReminderHours` and `crewReminderHours` exist; `crewReminderHours` (L171)
is the only reminder field unique to the workflow form. An admin has no way to tell
that "Appointment reminder hours" (set during Calendar setup) and "Client reminder
hours" (in Workflow) are the same stored value — the second input silently reflects
and overwrites the first.
**Dedup:** not owned by AI-07/AI-08 (automation consumers), BE-07 (port shape only),
or SET-05 (effective-config source labels). No packet owns this label duplication.
The InfoHint B2 audit flagged it as "likely a field-wiring bug, resolve before
hinting either." **New.**
**Severity note:** P2 (downgraded from the reporter's P1 "silently overwrites"
framing) — because both inputs bind the identical slot there is no distinct earlier
value to lose; the harm is misleading divergent labeling of one field, a real
clarity/correctness drag but low-harm. **Coordinate with SET-06:** these reminder
fields are inert-planned (no sender exists); SET-06 owns adding the Planned badge to
them. Decide together whether the fields render Planned-badged and whether the two
labels should point at one field or become two genuinely separate stored values.
**Disposition:** new packet **FIX-14**.

#### H-4 · Blueprint-editor folder-key chips break mid-word at 390px (P2)
**Lenses:** [google][setup-maintenance] — R1 mobile (confirmed).
**Where:** `settings-google-workspace-390.png`, Stage-3 Blueprint editor, Shared
Drive roots. `app/globals.css:566` sets `overflow-wrap:anywhere` on
`.workspace-blueprint-folder-row code`; `globals.css:743–745` collapses the mobile
row to `grid-template-columns:minmax(0,1fr) auto` with the code chip pinned to
`grid-column:1` sharing the row with the **+ Subfolder** button
(`WorkspaceBlueprintEditor.tsx:115`). The squeezed column wraps the read-only key
slug character-by-character: `company-admin` → `compan/y-/admin` (3 lines),
`client-accounts` → `client/-accounts`, `projects` → `projec/ts`, `archive` →
`archiv/e`, `email-attachments` → `email-/attachments`. Isolated cleanly: the
`templates` child chip, which has **no** adjacent + Subfolder button, fits on one
line.
**Dedup:** no open packet owns `WorkspaceBlueprintEditor` mobile layout — GW-stage
packets (SET-05/09/18/20/24/27, WS-10) cover other cards; DES-06/08d own the
*Overview* layout editor, not the blueprint editor; FIX-12 residuals are the banner
mode chip / route wrapper. **New.**
**Severity note:** P2 (not P1) — the editable "Folder name" input above each chip
(e.g. `00_Company Admin`) stays fully legible, so setup is not blocked; the up-to-3
mid-word breaks are real polish debt a small-org admin would notice on a deep mobile
admin page.
**Disposition:** new packet **FIX-19**.

#### H-5 · Overview Gmail-panel source label wraps to a 3-line pill (P2, pre-existing)
**Disposition: RESOLVED — fixed by DES-05 (PR #149, merged July 23, 2026): PanelHeader
now renders long source labels as single-line ellipsized text instead of a wrapping pill.**
**Lenses:** [google][navigate] — R1 desktop-core (confirmed).
**Where:** `app/FloorOpsApp.tsx:1131` passes `subtitle="Google Workspace Gmail"` to
`PanelHeader`, and `app/globals.css:66` renders every `.panel-header span` as a
`#f3f5f2` `radius-pill` with no `white-space:nowrap`. The 22-char label overflows the
narrow right-column panel and wraps to a 3-line stacked pill ("Google / Workspace /
Gmail") on the primary landing screen; 2 lines in the collapsed-rail view. Every
sibling panel feeds a short status word ("Planned", "1 active") that fits one line,
so the pill grammar breaks only here.
**Repro:** `overview-1280.png` bottom-right card; `overview-collapsed-rail-1280.png`.
**Pre-existing:** the July 22 pre-DES baseline (`design-baseline/2026-07-22/
overview-1280.png`) shows the identical 3-line pill — the wave neither introduced nor
fixed it.
**Dedup / disposition history:** R1's dedup initially found this unowned (DES-05's
recorded scope was Scheduling-only), so it was routed as DES-05-carried at filing
time. The orchestrator then folded the fix into the DES-05 kickoff explicitly, and
PR #149 (merged July 23, 2026) shipped it: `subtitleKind="source"` renders long
source labels as single-line ellipsized text. RESOLVED — no pickup, no owner
action, no remaining work on this finding.

### P3 — worthwhile, filed on its own

#### H-6 · Single-slot toast clobbers success confirmations (P3, two manifestations)
**Lenses:** [navigate][setup-maintenance] — R2 settings-flows + R2b gap-flows; one
root cause, two manifestations, one finding.
**Root:** `notify()` in `app/FloorOpsApp.tsx` (~L527–538) is single-slot —
`setToast` replaces with no queue — so any follow-up toast overwrites the prior one
within ~120ms.
- **Manifestation A (reset):** `resetSimulation()`
  (`GoogleWorkspacePanel.tsx:699–722`) fires "Workspace simulation reset with N
  messages and M events", then awaits `refreshWorkspaceSetup` which fires "Workspace
  readiness refreshed." The reset confirmation (what was restored) is overwritten in
  ~120ms; intended 3.2s duration cut to ~0.1s.
- **Manifestation B (filing):** `confirmGmailFiling`
  (`FloorOpsApp.tsx:~1394–1405`) fires the filing-success toast ("Email and N
  attachment(s) copied…; FCI/Filed added; Inbox retained"), then awaits
  `loadMessages()` which itself calls `notify("Loaded N messages…","info")`. After
  copying to Drive + labeling Gmail, the user's only durable feedback is a generic
  "Loaded 4 messages" that says nothing about the filing outcome.
**Dedup:** not owned by any open packet; distinct surfaces, same singleton handler.
**New.**
**Disposition:** new packet **FIX-15** (queue toasts, or suppress a follow-up info
toast when a success toast is <2s old — covers both manifestations).

#### H-7 · Custom filing rules are inert but render as active (P3)
**Lenses:** [google][setup-maintenance] — R2b gap-flows (verified byte-for-byte).
**Where:** `app/lib/google-workspace.ts` `getFilingRuleMatcher` (~L89–91) returns
`null` for any non-built-in rule name, so `evaluateInboxFilingRules` (~L144–158)
never applies a custom rule. Yet `InboxRulesPanel.tsx` (Action/Destination cells
~L24–28) renders the custom row with an active green "Suggest"/"Needs review" Action
badge, its priority rank, and "Enabled" — implying it drives inbox suggestions. It
never does; suggestion chips are unaffected. Only a small footnote discloses the
inertness.
**Repro:** added a custom rule (priority 1, action Suggest) via UI + API (POST 201);
inbox suggestion chips before vs after were byte-identical (`unchanged:true`), yet
the table ranked it priority 1 with a green Suggest badge.
**Dedup:** SET-06 owns the panel's rule-*editing* content and the per-rule
Review-first pill, not the custom-rule *inertness-vs-active-presentation* mismatch.
Not in the dedup index for this specific honesty gap. **New (coordinate with SET-06).**
**Disposition:** new packet **FIX-16** (render custom rules with an honest
inert/"Saved — not yet applied" state instead of active-looking badges; strongly
consider **folding into SET-06** since SET-06 already reworks this panel — see
Open Questions).

#### H-8 · Optional-fetch failure renders an authoritative-looking empty rules list (P3)
**Lenses:** [google][setup-maintenance][navigate] — R3 state-persistence.
**Where:** `app/FloorOpsApp.tsx` L356–367 swallow the Gmail-filing-rules and
sheet-mirror-status load in `Promise.allSettled` and only `setFilingRules` on
`fulfilled`; on rejection `filingRules` stays at its initial `[]` (L237) and
`.catch(() => {})` discards the error. `InboxRulesPanel` (L18) receives only
`rules: FilingRuleDraft[]` — no loading/error prop — so it cannot distinguish "no
rules exist" from "rules failed to load." `LiveDataBanner` retries only on core-data
error (L1081–1085), never on optional-request failure. A transient
`/api/v1/filing-rules` failure therefore renders an empty-but-authoritative rules
list while the whole app reports "ready," with no retry affordance — a load state
that lies about the Google integration's contents.
**Dedup:** FIX-12 owns the FIX-07 retry-affordance residual (missing retry on
non-layout views); the *new* concern is empty-list-as-truth for a Google surface,
beyond adding a retry button. SET-06 owns rule-editing content, not FloorOpsApp's
fetch/error handling. **New.**
**Disposition:** fold into **FIX-12** (extend the FIX-07 retry residual to give this
surface a distinct error state, not just a retry button).

#### H-9 · ~55 lines of orphaned old-stepper global CSS (P3)
**Lenses:** [simple][setup-maintenance] — R3 duplication (verified; downgraded P2→P3).
**Where:** `app/globals.css` L533–546 and L606–639 (plus L676–680, 728–734, 879) —
the numbered-step shell (`.workspace-setup-step*`, `.workspace-step-*`,
`.blocked-by-previous-step/-prerequisites`) and the resource-identity table
(`.workspace-resource-*`, `.workspace-resource-identity`, `.workspace-resource-table`,
`.workspace-restrictions-chip`, `.workspace-resource-rename`). The SET-29..34
redesign migrated these surfaces to module CSS
(`WorkspaceDriveResourceActions.module.css`, `GoogleWorkspacePanel.module.css`), so
nothing renders these globals. git-blame confirms they were orphaned by the *current*
redesign wave (commits `819f9d1`/`47a1e05`), not the old-build legacy debt. The dead
`.workspace-resource-*` names are one dash off from the still-live
`.workspace-resources-message` (L605, consumed by `WorkspaceDomainChecklistCard.tsx`)
— a real maintenance trap. Guidance tests already positively assert the live
components no longer emit these classes, yet the CSS remains.
**Dedup:** outside the A8/Phase-3 legacy-CSS track (that scope is the pre-existing
dark-green sidebar/color-alias/eyebrow/duplicated-responsive debt); the globals guard
in `workspace-setup-guidance.test.mjs` sweeps only `.drive-blueprint` /
`.project-folder-list`. No open packet owns this removal. **New.**
**Severity note:** P3 (downgraded from P2) — inert dead CSS with no rendering or
correctness impact; a developer-facing cleanup and mild comprehension trap.
**Disposition:** **FIX-17** polish sweep (delete the blocks; extend the existing
globals guard to assert these tokens' absence so it can't regrow).

### P3 — consolidated polish sweep

#### H-10 · Cross-round polish nits (P3, bundle) → FIX-17
The remaining pure-polish P3s, each verified in its round, bundled into one triage
entry (details and dispositions in the **FIX-17** packet below):
- Gmail-panel source-label 3-line pill wrap (H-5; **RESOLVED by DES-05 / PR #149** — no action).
- Inbox PageTitle header actions stack vertically under the long subtitle
  (`FloorOpsApp.tsx:1446`, `globals.css:127 .title-actions{flex-wrap:wrap}`).
- Projects table "Not scheduled" wraps to two lines in the too-narrow SCHEDULE column
  (`globals.css:123 .projects-table-row`, `FloorOpsApp.tsx:1601`).
- Settings admin subtitle is the personal-"My settings" string persisting across
  every company-setup section (`FloorOpsApp.tsx:1568`; verified P2→**P3**;
  pre-existing per the July-22 baseline).
- Orphaned old-stepper CSS ~55 lines (H-9; the substantive item in this sweep).
- Simulation calendar events return unfiltered while advertising a fixed
  [now, now+7d] window; live `listUpcomingEvents` filters via API `timeMin/timeMax`
  (`workspace-simulation.ts:247–259`).
- Simulation Gmail filing fabricates destination folder IDs
  (`${root}-email-archive` / `-email-attachments`) without confirming the managed
  sub-folders exist; live calls `resolveManagedProjectFolderPath` and throws — a
  sim-vs-live permissiveness gap
  (`gmail/messages/[messageId]/file/route.ts:132–146`).
- Readiness-refresh toast overlaps the panel intro / first Stage-3 row at 1280 and
  390 (`GoogleWorkspacePanel.tsx`; likely a capture-timing artifact of the
  auto-dismissing toast — placement nit only).
- Brand wordmark shrank ~40% and re-centered after DES-03 (left-edge alignment with
  the nav lost); LOW confidence, possibly an accepted DES-03 judgment call.
- Test-guard hardening (dev-facing): unguarded `indexOf` source-slice anchors that
  degrade silently on a moved anchor (`rendered-html.test.mjs:266–269`,
  `client-performance.test.mjs:79–85`, `settings-admin-gating.test.mjs:45`); and the
  hand-maintained 35-entry docs-vs-docs tracking map that taxes every merge
  (`task-tracking-docs.test.mjs:275–289`).
- **Note-only, already routed:** the empty layout-grid (no empty-state message when
  all Overview/Reports sections are hidden) is **DES-08d**-owned — listed for
  awareness, not to be re-picked-up here.

---

## Wave R5 — packet drafts

Rules: every packet follows the global guardrails in
`docs/agent-plan-architecture-workspace-and-setup.md` (secrets, fail-closed, honest
UI, append-only migrations, never-delete, simulation parity, server-side authz,
review-first). All acceptance criteria are mutation-sensitive: a test must fail if
the fix regresses. New packets carry no status line until started.

### FIX-13 · Stage-4 verification durability (P2 H-2; small-medium)
**Why:** Stage-4 READY is backed by ephemeral component state for Gmail and
Calendar, so a reload or in-app navigation silently reverts a launch-verification
stage from "done" to "1 OF 3 VERIFIED" with no user action — and it contradicts the
API on load (`GET /gmail/messages` returns `labelReady:true` while the row shows
READY TO VERIFY). The server already holds the truth; the UI just forgets it.
**Do:** persist and rehydrate the Gmail and Calendar verification latches from
server truth on mount, the way Sheets already derives from the DB mirror. The
`messages` endpoint already returns `labelReady:true`, so Gmail's latch can be
re-derived without new backend state; give Calendar an equivalent server-derived
signal (or persist the checked state) so `checkSetup` re-hydrates all three, not
just Sheets. Do not weaken the actual gate (`stageCompletion` stays honest).
**Accept:** an e2e reload-persistence pin — drive Stage 4 to READY, reload and
navigate away-and-back, assert the chip stays READY and Gmail/Calendar stay VERIFIED;
a test that the Gmail row reflects `labelReady:true` on first load (no
UI/API contradiction).
**Dedup:** not owned — SET-08 is the Stage-1 launch checklist; existing e2e never
tests reload/remount persistence of Stage-4. New.
**Effort:** small-medium. **Cost:** $0.

### FIX-14 · Reminder-hours field wiring (P2 H-3; small)
**Disposition (owner-approved July 23): FOLDED INTO SET-06** — the wiring split and the
Planned-badge honesty land together in the amended SET-06 packet in the main ledger;
this draft records the scope and acceptance it carried there.
**Why:** `settings.appointmentReminderHours` is surfaced under two different labels
in two settings sections — "Appointment reminder hours" (Calendar) and "Client
reminder hours" (Workflow) — both binding the same slot, so one masquerades as two
independent knobs and editing one silently rewrites the other.
**Do:** split the shared state so "Client reminder hours" binds its own field (add a
distinct persisted key alongside `appointmentReminderHours` and `crewReminderHours`),
OR, if a single reminder-hours default is genuinely intended, collapse to one label
in one place and stop rendering it twice. Decide **with SET-06** whether these inert
reminder fields render Planned-badged (no sender exists yet), and keep any InfoHint
copy truthful ("saved as a default; sending is not built yet").
**Accept:** a test proving the two inputs write distinct persisted keys (or that only
one input exists); a persistence round-trip test for the new field; no clobber of the
other value.
**Dedup:** not owned by AI-07/AI-08 (automation consumers), BE-07 (port shape), or
SET-05 (source labels); coordinate with SET-06 (Planned badge on inert reminder
fields). New.
**Effort:** small. **Cost:** $0.

### FIX-15 · Single-slot toast clobbers (P3 H-6; small)
**Why:** `notify()` is single-slot, so a success confirmation is overwritten within
~120ms by a follow-up info toast — the simulation-reset "restored N messages"
confirmation and the Gmail filing-success "copied + labeled + inbox-retained"
confirmation are both clobbered by the very same handler's follow-up reload toast,
leaving the admin with generic "readiness refreshed" / "Loaded N messages" as their
only durable feedback after a meaningful mutation.
**Do:** either queue toasts (show them in sequence with their intended durations) or
suppress a follow-up *info* toast when a success toast is <2s old. One change covers
both manifestations (reset in `GoogleWorkspacePanel.resetSimulation`, filing in
`FloorOpsApp.confirmGmailFiling`), since both route through the same `notify()`
singleton.
**Accept:** a toast-timeline test asserting the reset-success and filing-success
messages remain visible for their intended duration and are not replaced by the
subsequent info toast.
**Dedup:** not owned by any open packet; single-slot `notify` clobber, two surfaces.
New.
**Effort:** small. **Cost:** $0.

### FIX-16 · Truthful custom filing rules (P3 H-7; small)
**Disposition (owner-approved July 23): FOLDED INTO SET-06** — truthful presentation of
inert custom rules joins SET-06's truthful-labels charter; this draft records the scope
and acceptance it carried there.
**Why:** a custom filing rule added via the Rule modal is inert
(`getFilingRuleMatcher` returns `null` for any non-built-in name, so
`evaluateInboxFilingRules` never applies it), yet the rules table renders it with an
active green Suggest/Needs-review badge, its priority rank, and "Enabled" — implying
it drives inbox suggestions when it never does. Only a footnote discloses this.
**Do:** render custom (non-built-in) rules with an honest state — a "Saved — not yet
applied" / inert badge in the Action cell instead of the active-looking Suggest
badge, so the table stops implying behavior the matcher does not deliver. Keep the
review-first footnote. **Recommendation: fold into SET-06**, which already owns the
Inbox & file rules panel rework (per-rule Review-first pill) — a single coherent pass
over this panel is cleaner than a standalone FIX; carry as FIX-16 only if SET-06 does
not absorb it.
**Accept:** a test asserting a custom rule's Action cell renders the inert/"not
applied" state (not the active Suggest badge), and that suggestion chips remain
byte-identical before/after adding a custom rule (inertness preserved and honestly
shown).
**Dedup:** SET-06 owns rule-editing content + Review-first pill; the
inertness-vs-active-presentation honesty gap is adjacent and unowned. New;
coordinate/fold into SET-06.
**Effort:** small. **Cost:** $0.

### FIX-17 · Post-wave polish sweep (P3 bundle H-10 + H-9; small-medium)
**Why:** a cluster of independently-verified low-severity nits — some pre-existing,
some redesign-orphaned — collectively drag the polish level of the settings and
overview surfaces. Bundling them into one bounded sweep avoids a swarm of one-line
PRs while keeping each honest.
**Do:**
- **Orphaned old-stepper CSS (the substantive item):** delete `app/globals.css`
  L533–546, L606–639, L676–680, L728–734, L879; extend the globals guard in
  `workspace-setup-guidance.test.mjs` to assert `.workspace-setup-step*` /
  `.workspace-resource-*` absence so the dead block cannot regrow (mind the live
  neighbor `.workspace-resources-message`).
- **Inbox header stacking:** stop the two header actions wrapping vertically under
  the long subtitle (`globals.css:127 .title-actions`) — restore the horizontal
  action-row grammar used on Clients/Projects/Overview.
- **Projects schedule column:** widen the SCHEDULE & SITE column or `nowrap` the
  status so "Not scheduled" stops wrapping (`globals.css:123`).
- **Settings admin subtitle:** give the company-setup sections a subtitle that is not
  the personal-"My settings" string, or drop the per-section subtitle
  (`FloorOpsApp.tsx:1568`).
- **Sim calendar window filter:** filter `listSimulationCalendarEvents`
  (`workspace-simulation.ts:247–259`) to the advertised [now, now+7d] window so sim
  matches live.
- **Sim filing folder-id fabrication:** in the sim branch of
  `gmail/messages/[messageId]/file/route.ts` (L132–146), validate the managed
  sub-folders exist (or mirror the live `resolveManagedProjectFolderPath` check)
  rather than string-concatenating IDs, closing the sim-vs-live permissiveness gap.
- **Toast overlap** (readiness toast over intro/first row) and **brand-shrink**
  (DES-03 wordmark size/alignment): confirm whether each is a capture artifact / an
  accepted design call; fix or explicitly accept.
- **Test-guard hardening:** guard the `indexOf` source-slice helpers to fail loud on
  a missing anchor (pattern already exists at
  `sheet-mirror-status-labels.test.mjs:24–28`); revisit the docs-vs-docs tracking map
  tax (`task-tracking-docs.test.mjs:275–289`).
- **Note only (already routed):** Gmail-panel pill wrap is **RESOLVED (DES-05 /
  PR #149, merged)**; the empty layout-grid message is **DES-08d**-owned — do not
  re-pick-up either here.
**Accept:** the CSS-absence guard fails on a synthetic re-add of the dead tokens;
render tests for the inbox/projects/subtitle fixes; sim/live parity tests for the
calendar window and folder-existence validation; each accepted-as-is item recorded
with a one-line rationale.
**Dedup:** none of these are owned by an open packet in their filed form; the two
note-only items are explicitly routed to DES-05 and DES-08d and are listed for
visibility, not action. New.
**Effort:** small-medium. **Cost:** $0.

### FIX-18 · Stage-3 row status reconciliation (P2 H-1; small-medium)
> Beyond the orchestrator's enumerated FIX-13..17 set — proposed here because H-1 is
> a verified P2 (found by three lenses) with no existing owner and must have a
> disposition for triage. See Open Questions.

**Why:** Stage-3 "Create in order" rows can render a DONE chip, an "Unlocks after
Shared Drive." lock caption, and a disabled button simultaneously, because per-group
completeness and the gating dependency are derived independently and both apply their
classes/labels to the same row — the exact multi-source disagreement the banner
redesign existed to neutralize, resurfacing inside a stage row.
**Do:** make a row's complete and locked states mutually exclusive in
`WorkspaceDriveResourceActions.tsx` — a row that is DONE must not also render a lock
caption or a disabled action; a locked row must not render DONE. Reconcile the state
**chip** and the lock **caption** to name the same blocker (fix the "AFTER
FOLDERS" chip vs "Unlocks after Shared Drive." caption divergence on the same row).
Ensure the "N of 4 ready" counter does not count a group that sits behind an
unadopted drive.
**Accept:** a test over the seeded out-of-order state (children complete while Shared
Drive unadopted) asserting no row shows DONE + locked + disabled together, and that
chip and caption reference the same prerequisite; existing forward-flow gating tests
stay green.
**Dedup:** SET-32 (Stage 3) is merged/Complete; FIX-12 (route wrapper/re-scroll/dead
props) and SET-18 (reconcile/drift) do not cover per-group-completeness-vs-gating.
Not in the dedup index. New.
**Effort:** small-medium. **Cost:** $0.

### FIX-19 · Blueprint-editor mobile folder-key layout (P2 H-4; small)
> Beyond the enumerated FIX-13..17 set — proposed for the same reason as FIX-18: a
> verified P2 with no existing owner. See Open Questions.

**Why:** at 390px the read-only folder-key code chips break mid-word
(`company-admin` → `compan/y-/admin`, etc.) because the mobile grid pins the chip to
one column sharing the row with the + Subfolder button, squeezing the slug into a
character-by-character wrap on a deep mobile admin page.
**Do:** in the mobile layout for `.workspace-blueprint-folder-row`
(`globals.css:743–745`) give the code chip its own row or enough width that the key
slug does not wrap mid-word — e.g. drop the + Subfolder button to its own line at
390, or let the chip span before the action buttons. The editable "Folder name" input
already reads fine; the fix is purely the read-only key chip's column width.
**Accept:** a 390px render/layout test asserting no folder-key chip wraps mid-word
(single-line, or wrapping only at the `-` separators); desktop layout unchanged.
**Dedup:** no open packet owns `WorkspaceBlueprintEditor` mobile layout (SET GW-stage
packets cover other cards; DES-06/08d own the Overview layout editor). New.
**Effort:** small. **Cost:** $0.

---

## KNOWN appendix — notable already-owned items reviewers surfaced

Surfaced during the walk but owned by an open packet; listed for the owner's
awareness, not filed as new findings.

- **Chat notifier delivers only `lead.created`.** The notifier catalog exposes four
  configurable event routes (`lead.created`, `gmail.filing_review_needed`,
  `calendar.schedule_changed`, `project.warranty_follow_up_due`), toggleable in the
  SET-29..34 UI, but only `lead.created` is wired to `queueGoogleChatNotification`
  (`leads/route.ts`); the other three never fire. — **AI-07 / AI-T2-2.** The single
  item most worth attention before scaling notifications.
- **Registry-vs-saved sheet source label.** `getGoogleSheetMirrorStatus`'s default
  `source` param (`google-sheets.ts:448`) computes `'env'` whenever a sheet ID is set,
  which would mislabel an app-saved sheet as env; both production callers pass the
  correct `effectiveResources.clientDirectorySheet.source`, so the wrong default is
  never exercised. — **SET-05.**
- **Empty layout grid.** Hiding all Overview/Reports sections leaves a blank grid with
  no empty-state message (recoverable via the Edit button). — **DES-08d.**
- **Notification-preference all-or-nothing reset.** — **AI-07b.**
- **Dead props.** `DirectorySyncPanel onConfigure`, `TestingLaunchPanel
  onGoogleSetup`. — **FIX-12 / SET-34 residual.**
- **Meeting type lacks a phone-call option** in the MeetingModal select. — **AI-01 /
  AI-02c.**
- **Uploads UI unreachable.** The upload endpoint accepts multipart POST (201) but has
  zero UI affordance (0 file inputs; drawer lists indexed files as "Planned"). —
  planned; not a defect.
- **Overview/Reports honesty & affordance gaps reviewed as-is (pre-packet):**
  trend="Current" pills and missing interactive-vs-static chevron/hover grammar
  (DES-05/07); Reports KPI mapping (DES-07/08); nav compact badges + 44px toggle at
  the rail edge (DES-04); topbar Add-lead on Overview (DES-08b); Clients industry
  (DES-08a); Projects segmented tabs (DES-08); settings-nav per-section badges
  (SET-07). These surfaces will be rewritten by their packets, so today's read is
  provisional.
- **Enumerated route-census guards** (`bounded-api-bodies.test.mjs`,
  `access-boundaries.test.mjs`) list routes by hand though newer routes also call the
  shared helpers — becomes structural under **FIX-12** (`withOfficeRoute` wrapper).
- **FloorOpsApp source-slice test anchors** re-pointed per-PR under **AI-02**.
- **PostgreSQL adapters / v7-v8 precedence** reviewed by source-parity only. —
  **BE-07 / BE-14 / KPI-04.**

---

## Coverage statement (honest)

Folded from the R5 critic's coverage ledger. No new findings here; this documents
what the rounds actually touched, what they did not, and the residual risk from the
dedup-first approach.

**Covered, per round.** *R1 design walk* (4 lenses, 32 fresh captures) —
desktop-core walked all 9 core routes at 1280 + collapsed rail, tracing every
artifact to a selector/prop; desktop-settings walked the four-stage GW redesign + all
non-GW panels; mobile walked every -390 capture (slicing the 10,807px GW panel into 8
sections) + drawer + collapsed rail; baseline-diff diffed fresh vs the July-22
pre-DES baseline. *R2 + R2b functionality* (live Playwright, sim DB) — core-flows
drove Leads/Projects/Meetings end-to-end verifying each UI claim against the network
response AND a reload (zero console errors, zero non-2xx, no optimistic-over-failure
contradictions); settings-flows walked the full A2b surface (My Settings persistence
+ effect, deep-links, reset cleanup, folder rename, blueprint save/version, chat
routing, directory sync, page-layout reorder/hide/restore); gap-flows drove
Clients/Inbox/Filing-Rules/Uploads. *R3 code lenses* (4) — google-integration read
the full Google client + route surface (oauth 883 lines, drive 809, gmail 754,
sheets, calendar, chat-notifier, workspace-simulation) confirming BE-07 config
precedence, sim/live audit parity, lease/idempotency discipline, error-honesty;
state-persistence reviewed FloorOpsApp reconcile/fail-closed, page-layouts
widen-on-read/merge-on-write, settings/me PATCH, client-get-cache, project mutation
fan-out; duplication diffed all 538 globals.css selectors + git-blame; test-guard
enumerated 111 test files and verified no degenerate FloorOpsApp source-slice on
current main. *Adjunct* — a forms-only InfoHint audit (B2) proposed 12 recommended
hints (under the 20 budget) and independently surfaced the reminder-hours shared-state
hazard; the T0.1 dedup index mapped every surface to its open owning packet.

**Not covered, and why.**
- **e2e suite not executed by reviewers.** The 106-test Playwright corpus (workers:1,
  45s timeouts, single dev webServer) was inspected structurally in R3 but never run;
  live behavior came from ad-hoc Playwright drives, not the committed specs.
- **PostgreSQL adapters reviewed by source-parity only.** BE-07's PG mirror (v7/v8
  precedence) and the D1↔PG adapter family were read for parity; no PG instance stood
  up, no migration run, no semantic-drift test executed. — BE-07/BE-14/KPI-04 (KNOWN).
- **No live-Google behavior.** Everything ran in simulation. OAuth handshake, real
  Drive/Gmail/Sheets/Calendar API filtering, live label application, and bounce-link
  anchor hrefs were never exercised against real Workspace — exactly the sim-vs-live
  asymmetries the two R3 sim-fidelity P3s (calendar window filter, filing
  folder-existence validation) leave unverified.
- **Accessibility beyond existing axe specs not re-audited.** Focus-trap, keyboard
  nav, screen-reader behavior not re-audited; captures were static. — DES-09/Phase-4.
- **Uploads UI unreachable;** cross-project filing guard (`assertArchiveProject`)
  code-present but not runtime-proven (the R2b attempt hit the drive-workspace 409
  first).
- **People & Access admin page not walked** (OIDC People/Activity composition, B12
  hydration gate — owner-gated / no walked surface).
- **Performance / profiling not measured.** Two observations noted-not-filed:
  `/projects` list never reaches networkidle (continuous background polling); the GW
  panel is 10,807px tall.
- **Server crash truncated core-flows.** The port-3000 dev server crashed right after
  the Meeting POST and did not recover in ~8 min, so meeting re-render-after-reload
  was not visually confirmed (the POST did return a persisted 201).
- **DES-05/07/08 surfaces reviewed as-is (pre-packet)** and listed KNOWN; the packets
  will rewrite them, so today's read is provisional.

**Residual risk from the dedup-first approach.** The program filed against a ~90-packet
open backlog; every reviewer tagged matches KNOWN rather than filing. This is correct
for signal-to-noise but carries risk: **(a) mis-attribution** — a defect tagged KNOWN
under a packet whose recorded scope does not actually cover it would be silently
dropped (several findings were rescued exactly this way: Stage-3 done-and-locked is
NOT in SET-32/FIX-12 scope; reminder-hours dual-label is NOT in AI-07/08/BE-07/SET-05;
orphaned stepper CSS is NOT in the A8/Phase-3 track). **(b) packet-scope drift** —
packets are described by keywords, not diffs, so "owned" is a judgment call. **(c)
pre-existing masking** — three filed items (Gmail pill wrap, settings subtitle, brand
shrink) predate the July-22 baseline and could have been dismissed as "not this wave";
they were kept. **(d) breadth vs depth** — an owned surface with a SECOND unowned
defect gets less scrutiny. Net: misses are possible, concentrated in surfaces the
packets touch heavily (GW stages, Overview/Reports).

**What a future round should add.** Run the committed e2e suite (and the
retry-only-pass reporter) to completion; stand up PostgreSQL and run migrations +
parity tests live (the single largest source-parity-only gap); one live-Google smoke
pass to close the sim-vs-live P3 asymmetries; build/confirm the Uploads UI and
positively demonstrate the cross-project filing guard at runtime; walk People &
Access + the B12 hydration gate; a fresh axe pass over modal/drawer/search/error
states + keyboard focus-trap; re-review DES-05/07/08 surfaces AFTER their packets
land; and a dedup-integrity spot-check sampling KNOWN-tagged findings against the
named packet's merged diff.
