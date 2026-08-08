# InfoHint Copy Audit — Final Owner Review (Task B2)

**Status:** Closure proposed by HINT-03 on July 31, 2026; this reconciliation
becomes source truth when the PR merges. The tables remain the copy authority
for the shipped forms-audit initiative.

**Executive summary (5 lines)**
1. Shipped = **9** originally recommended-now + **3** sequenced after AI-08 = **12 total forms-audit hints** — within the 20 budget. BUDGET CHECK: PASS (12 ≤ 20).
2. Optional = **5** (defensible either way, low urgency). Rejected-as-noise = **8** (kept visible below). Label fixes for the review = **2** (moved out of hint tiers).
3. All 12 shipped texts remain byte-identical to the approved copy and are mutation-pinned; the optional, rejected, and label-fix rows remain outside the initiative.
4. Portability is closed: HINT-01 supplied left/right/auto anchoring, and all 12 shipped rows use their audited placement-specific anchor.
5. SET-06 resolved the shared-state hazard before adoption: appointment, client, and crew reminder hours now persist independently, while all three remain honestly planned-only.

Primitive: `WorkspaceInfoHint` (`app/components/WorkspaceInfoHint.tsx`, props `{label,text,anchor?}`). Rules applied: ≤25 words, plain flooring-business language, no env/secrets, truthful planned-vs-working.

Budget accounting is code-backed: HINT-02-A ships 7 rows and HINT-02-B ships 5,
for **12/20**. The **21** Google Workspace setup-flow hints that predated this
forms audit are grandfathered and excluded. The later WS-10 Operations health hint is
also outside this forms-only audit; it neither consumes nor expands the 12/20 budget.

Historical portability rule used for the approved anchors: the legacy tooltip's right
edge pinned to the trigger and grew leftward. HINT-01 added the left/right/auto choices
that the shipped rows now use, so the former clipping prerequisite is resolved.

---

## Tier 1 — Shipped recommended rows (9)

| Surface (component) | Field | Proposed hint text | Portability | Accuracy check vs source |
|---|---|---|---|---|
| Pipeline → LeadModal (`app/FloorOpsApp.tsx`) | Estimated value | Your rough estimate of the job's size before it's quoted. Feeds pipeline totals; it is not a committed contract amount. | auto (resolves left) | Lead has no contract field; pipeline totals use `estimatedValue`. Accurate. |
| Clients → ClientModal (`app/FloorOpsApp.tsx`) | Client status | Active is a current working account, Prospect is not yet won, Inactive is dormant or closed. | right | The create control now also offers Archived as EDIT-06's record-preserving transition; this shipped copy truthfully defines the three working-account states without claiming the list is exhaustive. |
| Projects → NewProjectModal (`app/FloorOpsApp.tsx`) | Status | Planning is pre-work, Mobilizing is readying crews and materials, Installation is the active install, Closeout is punch list and wrap-up. | auto (resolves left) | Options remain Planning/Mobilizing/Installation/Closeout. Accurate. |
| Projects → NewProjectModal (`app/FloorOpsApp.tsx`) | Flooring category | The main material for this job. Use Specialty for niche products and Mixed when no single category dominates. | auto (resolves left) | `FLOORING_CATEGORIES` includes `specialty` and `mixed`. Accurate. |
| Projects → NewProjectModal (`app/FloorOpsApp.tsx`) | Estimated value | Expected job value before booking. If a contract value is later recorded, reporting prefers that figure. | right | `contractValue` remains a separate field in the same modal. Accurate. |
| Settings → Inbox rules → RuleModal (`app/settings/components/InboxRulesPanel.tsx`) | When this matches | Describe the email in plain words. This is saved as a review-first note; automatic matching is not applied yet. | auto | Rules remain review-first policies until a supported matcher exists. Truthful. |
| Settings → Inbox rules → RuleModal (`app/settings/components/InboxRulesPanel.tsx`) | Action | Suggest proposes a project, Send to review holds it for a person, Ignore skips it. Filing always needs approval. | right | Options remain Suggest a project / Send to review / Ignore; review-first is enforced. Accurate. |
| Settings → Google Workspace → WorkspaceBlueprintEditor (`app/settings/components/WorkspaceBlueprintEditor.tsx`) | Client folder pattern | A naming template. The tokens listed below are replaced with real client values when the folder is later created. | auto | Adds substitution-timing meaning without repeating the adjacent token legend. Accurate. |
| Settings → Google Workspace → WorkspaceBlueprintEditor (`app/settings/components/WorkspaceBlueprintEditor.tsx`) | Project folder pattern | A naming template. The required tokens below are replaced with real project values when setup later creates the folder. | right | Does not duplicate the required/optional token legend. Accurate. |

---

## Tier 1b — Shipped after AI-08 (3)

AI-08 landed before adoption, so anchors and layout were final when these shipped. Per
SET-06 the three fields persist independently and remain inert-planned — the copy does
not promise reminder delivery.

| Surface (component) | Field | Proposed hint text | Portability | Accuracy check vs source |
|---|---|---|---|---|
| Settings → Calendar & appointments → WorkspaceDefaultsPanel (`app/settings/components/WorkspaceDefaultsPanel.tsx`) | Appointment reminder hours | How many hours ahead a reminder is planned to go out. Saved now; reminder sending is not built yet. | auto | Binds only to `appointmentReminderHours`; no sender exists. Truthful. |
| Settings → Workflow & notifications → WorkspaceDefaultsPanel (`app/settings/components/WorkspaceDefaultsPanel.tsx`) | Client reminder hours | Hours before a client appointment a reminder is planned to send. Saved as a default; sending is not built yet. | auto | Binds independently to `clientReminderHours`; no sender exists. Truthful. |
| Settings → Workflow & notifications → WorkspaceDefaultsPanel (`app/settings/components/WorkspaceDefaultsPanel.tsx`) | Crew reminder hours | Hours before a scheduled field day a crew reminder is planned to send. Saved as a default; sending is not built yet. | right | Binds only to `crewReminderHours`; no sender exists. Truthful. |

---

## Tier 2 — Optional (5; defensible either way)

| Surface (component) | Field | Proposed hint text | Portability | Why optional |
|---|---|---|---|---|
| Projects → NewProjectModal (`app/FloorOpsApp.tsx`) | Square feet | Total finished floor area for this project. Whole numbers only. | Not applicable (not shipped) | Label is largely self-evident; only mild value. Not shipped. |
| Settings → Inbox rules → RuleModal (`app/settings/components/InboxRulesPanel.tsx`) | Default Drive destination | The Drive subfolder a matched email would be filed into once you approve it. | Not applicable (not shipped) | Default value already hints at intent. Not shipped. |
| Settings → Google Workspace → WorkspaceBlueprintEditor (`app/settings/components/WorkspaceBlueprintEditor.tsx`) | Default event minutes | The default length for a new event on this calendar. You can still change any single event. | Not applicable (not shipped) | "Minutes" is clear; mild benefit. Not shipped. |
| Settings → Google Workspace → WorkspaceBlueprintEditor (`app/settings/components/WorkspaceBlueprintEditor.tsx`) | Folder name (folder tree) | Rename freely. The fixed code beside it keeps setup recognizing the folder after a rename. | Not applicable (not shipped) | Name/key split is already reinforced by section copy. Not shipped. |
| Settings → Workflow & notifications → WorkspaceDefaultsPanel (`app/settings/components/WorkspaceDefaultsPanel.tsx`) | Office notification email | Where office alerts are planned to go. Saved as a default; automated notifications are not built yet. | Not applicable (not shipped) | Recipient purpose is non-obvious but lower priority than reminder rows. Not shipped. |

---

## Tier 3 — Rejected as noise (kept visible)

| Surface (component) | Field | Why rejected (adjacent copy / options already cover it) |
|---|---|---|
| Pipeline → LeadModal (`app/FloorOpsApp.tsx`) | Lead source | Label + four named options (Website, Referral, Bid invite, Repeat client) fully define it. |
| Pipeline → LeadModal (`app/FloorOpsApp.tsx`) | Next action | Placeholder "What needs to happen next?" already says it. |
| Clients → ClientModal (`app/FloorOpsApp.tsx`) | Industry | Descriptive option list (General contractor, Healthcare, Retail, …) is self-explanatory. |
| Projects → NewProjectModal (`app/FloorOpsApp.tsx`) | Contract value | Already carries a `.form-help` line (`id="contract-value-help"`) explaining the admin-only financial figure. |
| Project drawer → MeetingModal (`app/FloorOpsApp.tsx`) | Meeting type | Each option is a full descriptive label; no taxonomy ambiguity. |
| Settings → Google Workspace → WorkspaceBlueprintEditor (`app/settings/components/WorkspaceBlueprintEditor.tsx`) | Spreadsheet role | **Downgraded from recommended.** The adjacent legend already states that import sheets prepare entity tabs, reference sheets stay read-only, and mirror is locked. A hint would duplicate it. |
| Settings → Google Workspace → WorkspaceBlueprintEditor (templates fieldset) | Template name / Kind / Target folder | Fieldset description ("starter Docs or Sheets and the folder that will receive each one") covers all three. |
| Settings → Calendar & appointments → WorkspaceDefaultsPanel (`app/settings/components/WorkspaceDefaultsPanel.tsx`) | Calendar setup | Adjacent "Recommended setup" static row explains create-shared vs use-existing. |

---

## Label fixes for the review (a better label beats a hint — NOT hint work)

Moved out of the hint tiers entirely. Each is a one-word/short relabel that carries the meaning in the control itself, so no tooltip is needed.

| Surface (component) | Current source label | Proposed label change | Reconciled status |
|---|---|---|---|
| Settings → Inbox rules → RuleModal (`app/settings/components/InboxRulesPanel.tsx`) | Priority | **Priority (lower number runs first)** | Still routed and not shipped. Lower numbers run first; the ordering direction belongs in the label, so no hint was added. |
| Project drawer → FollowUpResultModal (`app/FloorOpsApp.tsx`) | Post-installation callback | **Did the client report a problem after install?** (keep Yes/No) | Still routed and not shipped. The yes/no meaning belongs in the label, so no hint was added. |

---

## Closure reconciliation

- SET-06 resolved the former shared-state hazard: appointment, client, and crew
  reminder hours bind to three independent fields. Their shipped hints still say
  "planned"/"not built yet" because no reminder sender exists.
- HINT-02-A and HINT-02-B ship exactly the 12 recommended rows above. Their
  source tests pin every approved string and anchor mutation-sensitively; HINT-03
  adds one representative accessible-description assertion for each of the four
  surface families.
- The five optional rows remain absent pending a fresh owner opt-in. The eight
  rejected rows remain absent. The two label fixes remain routed but unshipped;
  neither was converted into a tooltip.
- Blueprint folder-pattern hints intentionally omit the adjacent token list and
  carry only the non-obvious substitution-timing meaning.
