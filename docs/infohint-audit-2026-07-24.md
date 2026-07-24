# InfoHint Copy Audit — Final Owner Review (Task B2)

**Executive summary (5 lines)**
1. Recommended-now = **9** (ship immediately) + **3** sequenced after AI-08 = **12 total recommended** — well under the 20 budget. BUDGET CHECK: PASS (12 ≤ 20).
2. Optional = **5** (defensible either way, low urgency). Rejected-as-noise = **8** (kept visible below). Label fixes for the review = **2** (moved out of hint tiers).
3. Every proposed text was verified against the live field's label, options, and behavior; nothing contradicts source, and all copy is ≤25 words.
4. Portability: the tooltip anchors bottom-right (`right:0`, `globals.css:718`) and extends left/up, so left-column and full-width controls clip — **7 of 12** recommended rows need HINT-01 anchoring before shipping; 5 are OK-now.
5. Two truthfulness flags carried to open questions: the AI-08 reminder fields must never promise sending, and "Appointment reminder hours" / "Client reminder hours" write the SAME stored value.

Primitive: `WorkspaceInfoHint` (`app/settings/components/workspace-setup-shell/WorkspaceInfoHint.tsx`, props `{label,text}`). Rules applied: ≤25 words, plain flooring-business language, no env/secrets, truthful planned-vs-working.

Portability rule used: tooltip's right edge pins to the trigger and the box grows leftward. A field in the **right column** of a `.form-row`/grid keeps the box inside the container (**OK-now**); a **left-column or full-width** field puts the icon near the container's left edge, so the box clips (**needs-HINT-01-anchoring**). Verified column positions in source.

---

## Tier 1 — Recommended NOW (9; ship in HINT batch)

| Surface (component) | Field | Proposed hint text | Portability | Accuracy check vs source |
|---|---|---|---|---|
| Pipeline → LeadModal (`app/FloorOpsApp.tsx:1590`) | Estimated value | Your rough estimate of the job's size before it's quoted. Feeds pipeline totals; it is not a committed contract amount. | needs-HINT-01-anchoring (left col of form-row) | Lead has no contract field; `pipelineValue` sums `estimatedValue` (`:1157`). Accurate. |
| Clients → ClientModal (`:1596`) | Client status | Active is a current working account, Prospect is not yet won, Inactive is dormant or closed. | OK-now (right col of form-row) | Options Active/Prospect/Inactive (`:1596`). Accurate. |
| Projects → NewProjectModal (`:1603`) | Status | Planning is pre-work, Mobilizing is readying crews and materials, Installation is the active install, Closeout is punch list and wrap-up. | needs-HINT-01-anchoring (left col of form-row) | Options Planning/Mobilizing/Installation/Closeout (`:1603`). Accurate. |
| Projects → NewProjectModal (`:1603`) | Flooring category | The main material for this job. Use Specialty for niche products and Mixed when no single category dominates. | needs-HINT-01-anchoring (left col of form-row) | `FLOORING_CATEGORIES` includes `specialty` and `mixed` (`app/domain/project-creation.ts:2`). Accurate. |
| Projects → NewProjectModal (`:1603`) | Estimated value | Expected job value before booking. If a contract value is later recorded, reporting prefers that figure. | OK-now (right col of form-row) | `contractValue` field exists in same modal (`:1603`). Accurate. |
| Settings → Inbox rules → RuleModal (`InboxRulesPanel.tsx:38`) | When this matches | Describe the email in plain words. This is saved as a review-first note; automatic matching is not applied yet. | needs-HINT-01-anchoring (full-width, short label) | Footnote confirms rules "saved as review-first policies until a supported matcher is added" (`:31`). Truthful. |
| Settings → Inbox rules → RuleModal (`InboxRulesPanel.tsx:38`) | Action | Suggest proposes a project, Send to review holds it for a person, Ignore skips it. Filing always needs approval. | OK-now (right col of form-row) | Options Suggest a project / Send to review / Ignore (`:38`); review-first enforced. Accurate. |
| Settings → Google Workspace → WorkspaceBlueprintEditor (`:269`) | Client folder pattern | A naming template. The tokens listed below are replaced with real client values when the folder is later created. | needs-HINT-01-anchoring (left col of field grid) | Adds substitution-timing meaning WITHOUT repeating the token legend below (`:274`). Closes spec 4.1. Accurate. |
| Settings → Google Workspace → WorkspaceBlueprintEditor (`:270`) | Project folder pattern | A naming template. The required tokens below are replaced with real project values when setup later creates the folder. | OK-now (right col of field grid) | Does not duplicate the required/optional token legend (`:275-276`). Closes spec 4.1. Accurate. |

---

## Tier 1b — Recommended but SEQUENCED after AI-08 (3)

AI-08 adds a card to WorkspaceDefaultsPanel; hold these until it lands so anchors and layout are final. Per SET-06 these fields are inert-planned — copy must not promise reminders.

| Surface (component) | Field | Proposed hint text | Portability | Accuracy check vs source |
|---|---|---|---|---|
| Settings → Calendar & appointments → WorkspaceDefaultsPanel (`:146`) | Appointment reminder hours | How many hours ahead a reminder is planned to go out. Saved now; reminder sending is not built yet. | needs-HINT-01-anchoring (left col of form-row) | Field is inert (`appointmentReminderHours`, no sender). Does not promise behavior. Truthful. |
| Settings → Workflow & notifications → WorkspaceDefaultsPanel (`:170`) | Client reminder hours | Hours before a client appointment a reminder is planned to send. Saved as a default; sending is not built yet. | needs-HINT-01-anchoring (left col of form-row) | Truthful. NOTE: binds to the SAME `appointmentReminderHours` state as the field above (see open questions). |
| Settings → Workflow & notifications → WorkspaceDefaultsPanel (`:171`) | Crew reminder hours | Hours before a scheduled field day a crew reminder is planned to send. Saved as a default; sending is not built yet. | OK-now (right col of form-row) | Binds to `crewReminderHours`; inert. Does not promise behavior. Truthful. |

---

## Tier 2 — Optional (5; defensible either way)

| Surface (component) | Field | Proposed hint text | Portability | Why optional |
|---|---|---|---|---|
| Projects → NewProjectModal (`:1603`) | Square feet | Total finished floor area for this project. Whole numbers only. | OK-now (right col of form-row) | Label is largely self-evident; only mild value. |
| Settings → Inbox rules → RuleModal (`InboxRulesPanel.tsx:38`) | Default Drive destination | The Drive subfolder a matched email would be filed into once you approve it. | needs-HINT-01-anchoring (full-width, short label) | Default value already hints at intent. |
| Settings → Google Workspace → WorkspaceBlueprintEditor (`:320`) | Default event minutes | The default length for a new event on this calendar. You can still change any single event. | needs-HINT-01-anchoring (short label near left) | "Minutes" is clear; mild benefit. |
| Settings → Google Workspace → WorkspaceBlueprintEditor (`:112`) | Folder name (folder tree) | Rename freely. The fixed code beside it keeps setup recognizing the folder after a rename. | needs-HINT-01-anchoring (label at left, lock badge right) | Name/key split already reinforced by section copy. |
| Settings → Workflow & notifications → WorkspaceDefaultsPanel (`:173`) | Office notification email | Where office alerts are planned to go. Saved as a default; automated notifications are not built yet. | needs-HINT-01-anchoring (full-width, short label) | Recipient purpose non-obvious but lower priority than reminder rows; **also after AI-08**. |

---

## Tier 3 — Rejected as noise (kept visible)

| Surface (component) | Field | Why rejected (adjacent copy / options already cover it) |
|---|---|---|
| Pipeline → LeadModal (`:1590`) | Lead source | Label + four named options (Website, Referral, Bid invite, Repeat client) fully define it. |
| Pipeline → LeadModal (`:1590`) | Next action | Placeholder "What needs to happen next?" already says it. |
| Clients → ClientModal (`:1596`) | Industry | Descriptive option list (General contractor, Healthcare, Retail, …) is self-explanatory. |
| Projects → NewProjectModal (`:1603`) | Contract value | Already carries a `.form-help` line (`id="contract-value-help"`) explaining the admin-only financial figure. |
| Project drawer → MeetingModal (`:1807`) | Meeting type | Each option is a full descriptive label; no taxonomy ambiguity. |
| Settings → Google Workspace → WorkspaceBlueprintEditor (`:306`) | Spreadsheet role | **Downgraded from recommended.** The `<legend>`/intro at `:301` already states verbatim: import sheets prepare entity tabs, reference sheets stay read-only, mirror is locked. A hint would duplicate it. |
| Settings → Google Workspace → WorkspaceBlueprintEditor (templates fieldset) | Template name / Kind / Target folder | Fieldset description ("starter Docs or Sheets and the folder that will receive each one") covers all three. |
| Settings → Calendar & appointments → WorkspaceDefaultsPanel (`:134`) | Calendar setup | Adjacent "Recommended setup" static row (`:131`) explains create-shared vs use-existing. |

---

## Label fixes for the review (a better label beats a hint — NOT hint work)

Moved out of the hint tiers entirely. Each is a one-word/short relabel that carries the meaning in the control itself, so no tooltip is needed.

| Surface (component) | Current label | Proposed label change | Rationale |
|---|---|---|---|
| Settings → Inbox rules → RuleModal (`InboxRulesPanel.tsx:38`) | Priority | **Priority (lower number runs first)** | Sort is ascending (`app/lib/google-workspace.ts:142`, lower runs first). The ordering direction fits in the label; a hint is overkill. |
| Project drawer → FollowUpResultModal (`FloorOpsApp.tsx:1734`) | Post-installation callback | **Did the client report a problem after install?** (keep Yes/No) | "Callback" is ambiguous jargon; the yes/no meaning belongs in the label. Feeds the callback-rate metric — relabeling the form field does not touch the metric name. |

---

## Notes / accuracy flags carried forward

- **Shared-state hazard (data model, not copy):** "Appointment reminder hours" (`:146`, calendar panel) and "Client reminder hours" (`:170`, workflow panel) BOTH bind to `settings.appointmentReminderHours`. Editing one silently changes the other. Any hint (or label) implying they are independent would contradict behavior. Flagged for owner — likely a field-wiring bug, resolve before hinting either.
- All three reminder-hours hints and the office-email hint deliberately say "planned"/"not built yet" to honor SET-06 (inert-planned) and the FeatureStateBadge "Planned" meaning ("Informational only; the workflow is not implemented yet").
- Blueprint folder-pattern hints were rewritten from the B1 draft to REMOVE token-list duplication (the token legend at `:272-276` already lists required/optional tokens); they now carry only the non-obvious substitution-timing meaning.
