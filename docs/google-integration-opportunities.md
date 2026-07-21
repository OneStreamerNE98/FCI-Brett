# Google integration opportunities for FCI Operations

Research date: July 20, 2026 · Adopted July 21, 2026 · Five-domain web-verified survey
(Workspace add-on surfaces, Drive/Docs depth, scheduling/intake, Maps/field ops,
identity/collaboration) mapped to the leads → site visits → proposals → installs →
closeout workflow, the one-connector-account model, and the repo's cost/approval
gates. Effort tiers assume the app's existing OAuth + API plumbing.

> **Owner budget (July 21, 2026):** up to $50/month for value-justified integration
> spend. The adopted set below is expected to cost **~$0–10/month actual** (Maps usage
> within free tiers at current volume); WS-15 sets a billing budget alert well under
> the ceiling. **Adopted build packets:** GI-01…GI-07 (Workstream E in the
> [agent execution plan](agent-plan-architecture-workspace-and-setup.md)) plus the
> WS-15/WS-16 owner rows and SET-17's Docs-merge amendment. Items marked "skip" below
> are recorded decisions, not open questions.

## Tier 1 — free, zero new OAuth scopes, small effort (do first)

| # | Integration | What it does weekly | Mechanism | Cost |
| --- | --- | --- | --- | --- |
| 1 | **Docs API template merge** | Client-ready proposals/estimates: copy an owner-maintained Google Doc template, `documents.batchUpdate` replaces `{{client_name}}`, `{{site_address}}`, `{{total}}`. Owner edits templates directly in Docs — better than the planned HTML-upload approach. | Docs API `batchUpdate` works under the **existing full `drive` scope** (verified); enable Docs API on the GCP project. Upgrades SET-17. | Free |
| 2 | **Client self-booking pages** | Clients book their own site-visit/measurement slots from a link in the estimate email; bookings land on the Client Appointments calendar the app already reads; app matches attendee email → lead record. | Calendar **appointment schedules** — owner configures in Calendar UI (no API exists to create them, verified); app ingestion = existing calendar reads. Business Standard+ for premium options. | Free |
| 3 | **Job-site map + navigate link on the project page** | See the site (satellite view for driveway/staging assessment) and one-tap crew navigation. | **Maps Embed API iframe — free with unlimited usage** (verified current pricing) + Google Maps URL deep links (no key at all). Same iframe pattern as the planned in-app Drive previews. | $0 |
| 4 | **Send-as `ops@` alias** | All app-sent client email (booking links, confirmations, follow-ups) goes out as `ops@` instead of the connector user's address; replies flow into the mailbox the app already files. | One-time Gmail UI alias setup by the owner; `messages.send` honors the verified alias under the existing `gmail.modify` scope. | Free |
| 5 | **Google Forms lead intake** | Public lead form (name, address, rooms, flooring type) → linked response Sheet → the app's existing Sheets polling turns rows into lead records. No webhook needed at 20-person volume. | Forms UI + existing `spreadsheets` scope. | Free |
| 6 | **Looker Studio KPI dashboard** | Owner/PM weekly ops review charted from the Client Directory Sheet mirror: pipeline by stage, jobs by status, crew load, closeout aging. Zero app changes. | Owner connects Looker Studio (free) to the mirror Sheet; extends the KPI-01 work. | Free |
| 7 | **PWA install + Chrome managed defaults** | FCI opens like a native app on every office machine — force-install/pin via Chrome Enterprise Core (free) using the manifest the app already ships. | Admin console configuration only. | Free |
| 8 | **Drive shortcuts in the blueprint** | "Field Schedule — This Week" folder of shortcuts to active projects for crews; master price-sheet shortcut inside every project folder. One canonical file, surfaced where crews look. | `files.create` shortcut mimeType, existing scope; small blueprint (SET-15/21) add-on. Caveat: shortcuts break if targets are deleted (engine never deletes — fine). | Free |
| 9 | **Chat webhooks for ops notifications** | Push to team Chat spaces on phones: new lead, filing review needed, schedule change, warranty follow-up due — with deep links back into FCI. | Incoming webhooks: **no OAuth at all**; per-space secret URLs, owner-provisioned; a feature-gated notifier module off by default (matches the repo's gated-push pattern). | Free |

GI-02 implements item 9 as a source-only, default-off boundary with simulation audit
logging, strict secret-name-only configuration, and no live send. See the
[Google Chat notification boundary](google-chat-notifications.md). Owner webhook
provisioning, hosted values, deployment, and any live test remain separately gated.

## Tier 2 — high value, needs an owner gate (scope, billing account, or edition)

| # | Integration | What it does | Gate | Cost |
| --- | --- | --- | --- | --- |
| 10 | **Drive Labels on filed documents** | Owner-defined taxonomy (Project / Doc Type / Status: draft-sent-approved-closed) applied to every file the app touches; one `files.list` label query answers "all unsigned proposals." No new scope (verified `files.modifyLabels` under `drive`); owner creates taxonomy in Admin console. | **Requires Business Standard+** (not Starter) — confirm edition | Free |
| 11 | **Address Validation + Places Autocomplete at lead entry** | Typo-proof, USPS-standardized job-site addresses with lat/lng stored at lead creation; type-ahead completion on the form. Autocomplete sessions ending in a validation call are currently free (verified). | Maps Platform = **API keys + a GCP billing account** (owner approval; no connector-account scopes). ~$0/month at a few hundred leads (5k free validations/mo) | ~$0 |
| 12 | **Drive changes polling → per-project activity feed** | Crew photo/measurement drops into project folders appear in the app and mirror Sheet without folder re-listing; powers a "recent activity" panel. | None — existing scope; serialized cursor polling exactly like the repo's chosen Gmail history pattern (no Pub/Sub) | Free |
| 13 | **FCI Workspace Add-on: Gmail panel + smart chips** (the flagship) | Opening a client email in Gmail shows FCI context (client, stage, install dates, folder) with one-click file-to-project — filing moves to where staff read mail, including their own mailboxes the connector can't see. FCI links pasted in Docs/Sheets unfurl as live smart chips. | New third consent surface (per-employee, single-open-message scopes — deliberately narrow); private Marketplace listing (unreviewed, free, org-internal); needs employee OIDC login live | Free |
| 14 | **Field checklists on Forms** | Phone-friendly site-visit checklist and closeout punch list with photo upload; photos land in Drive, app copies them into the project folder and marks the stage complete. | `forms.responses.readonly` scope (owner approval); file-upload forms must live in the org | Free |
| 15 | **Crew drive-time checks (Routes API)** | "Who can realistically get there by 2pm?" — route matrix from shop/crew positions to the job site rendered beside a proposed Field Schedule hold. (Distance Matrix API is legacy since March 2025 — use Routes.) | Maps billing account (same as #11) | ~$0–low |
| 16 | **Google Business Profile reviews** | See the review a just-closed project generated, reply from the app, KPI tie-in. (GBP chat/messages product is discontinued — reviews are what's real.) | `business.manage` scope on the connector account + the connector must be a manager of the GBP listing (owner approval) | Free |
| 17 | **Drive file approvals** | Formal proposal sign-off and closeout-packet approval: Drive-native notifications, due dates, comments, file locking on approval. Full management API GA April 2026 (verified). | Business Standard+; design: one active approval per file | Free |
| 18 | **Clients as domain shared contacts** | Client names/numbers/emails autocomplete in every employee's Gmail org-wide via a nightly reconcile from the app. | Legacy GData scope + delegated-admin grant — the heaviest gate here; do only if Gmail autocomplete pain is real | Free |
| 19 | **Calendar push (events.watch)** | Sub-minute booking/cancellation sync — build flag-off; enable only if self-booking's polling lag actually bites. | Feature-gated webhook route (existing pattern) | Free |
| 20 | **Meet links on consult events** | Optional virtual pre-qualification consults — a few lines (`conferenceData.createRequest`) in the existing hold-creation path. Niche for flooring; bundle, don't packet. | None | Free |

## Deliberately rejected (highlights)

Google Tasks API (only writes the authenticated user's own list — can't push to crews);
Groups automation via Admin SDK (5 near-static groups — keep manual); interactive Chat
app (duplicates the web app; webhooks cover notify); Calendar/Drive add-ons (no mobile
support where crews live); per-user contacts sync for true caller ID (needs per-employee
contacts scopes — disproportionate); Distance Matrix (legacy → Routes); GBP messages
(product discontinued); Route Optimization/Navigation SDK (fleet-scale, native-app);
Street View/Solar/Weather (wrong vertical); public Marketplace listing (private is
unreviewed, immediate, internal — correct for one org).

## Suggested sequencing

- **Bundle into the already-planned dashboard-setup workstream:** #1 (SET-17 upgrade),
  #3 + in-app Drive previews (SET-23), #8 (blueprint shortcuts).
- **Owner one-time UI actions (no code):** #2 booking page, #4 ops@ alias, #6 Looker
  Studio, #7 PWA rollout — these four are pure setup-checklist rows.
- **First new integration packets after the setup workstream:** #5 forms intake,
  #9 Chat notifications, #12 activity feed, #10 labels (edition check first),
  #11 address validation (with the Maps billing gate as a WS-15-style owner row).
- **The flagship, when employee login goes live:** #13 the FCI Workspace Add-on —
  the single tightest "meet them inside Google" integration on this list.
- **Later, by demonstrated need:** #14–#19.

Every scope addition, billing attachment, edition dependency, and Marketplace listing
above is owner-gated per the repo's rules; nothing here weakens the one-connector
model, review-first filing, or the fail-closed defaults.
