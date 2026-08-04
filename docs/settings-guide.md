# FCI Operations — Guide for Everyday Users and Administrators

> **Editors note — parts of this page are pinned by automated tests.** Several sentences in this
> guide are matched by exact pattern in the CI suite (see `tests/ai-outbound-guard.test.mjs`,
> `tests/set11-directory-sync.test.mjs`, `tests/set24-employee-login-readiness.test.mjs`), so an
> innocent rewording can fail the build with an error naming an unrelated feature. If a doc edit
> turns CI red, search those three files for a phrase from your change before assuming a code
> problem.

## Who this is for

This guide is for two kinds of reader, and it is split so you only need your half:

- **Part 1 — Using the app** is for everyone in the office and in the field. It covers signing in, moving around, and the day-to-day pages: Leads, Projects, Clients, Meetings, and the Inbox. No admin knowledge is needed.
- **Part 2 — Administering the app** is for the owner or office administrator who sets FCI Operations up and keeps it running. You do not need to be technical; where a step truly needs a developer, the guide says so and points you to "When to call the developer."

A short **Glossary** at the end defines the few special terms this guide uses (Shared Drive, blueprint, simulation, and others). Words in the glossary are written in plain language the first time they appear.

> **How current this guide is.** Describes the app as built in source on 2026-07-28; the installed company version may trail it. The copy your team can open right now is an early development build (private Sites development version 40). Everything newer than that build exists in the source code but has not been switched on yet. Screenshots are simulation captures (see the Glossary for what "simulation" means).

---

# Part 1 — Using the app (everyone)

This part is for everyone in the office and in the field. It explains how to open the app, move around it, and use the day-to-day pages: Leads, Projects, Clients, Meetings, and the Inbox. No admin knowledge is needed. If a step here mentions company setup (connecting Google, changing company rules), that lives in Part 2 and is handled by an administrator.

> **Where the app is today.** The version installed on the hosted site is an early development build (Sites development version 40). Everything newer than that build exists in the source code but is not yet deployed. The app also runs in **simulation mode** by default, which means Gmail, Calendar, and Drive actions use safe sample data and nothing is sent to a real Google account until an administrator connects one. Screenshots in this guide are simulation captures. When a page or button says it is in development, planned, or needs setup, that label is telling you the truth — see "What each badge means" below.

---

### Opening the app and installing it on a phone

You sign in the same way you sign in to your ChatGPT-Sites account today. (At full production launch, sign-in will switch to your Google Workspace account, but that change is not live yet.) You never link a personal ChatGPT or OpenAI account — the assistant features run on one company key that an administrator sets up.

Install the app so it opens like a normal app, with its own icon, instead of a browser tab:

- **On a computer (Chrome or Edge):** open the app, then use the browser's **Install app** command (usually an install icon in the address bar, or the browser menu).
- **On iPhone or iPad (Safari):** open the app, tap **Share**, then **Add to Home Screen**.
- **On Android (Chrome):** open the app, then choose **Install app** or **Add to Home screen**.

Once installed, tap or click the icon to open it full-screen. This is the fastest way to get the app on a phone for the field, and it does not require anything from an app store.

> [SCREENSHOT 1 — see Screenshot index]

---

### Finding your way

The left side of the screen is the main navigation. On a phone, tap the menu button in the top bar to open it. The current pages are:

- **Overview** — your home dashboard with the day's key numbers and shortcuts.
- **Leads** — potential jobs you are pursuing, organized by stage.
- **Clients** — the companies and people you work for.
- **Projects** — active and finished jobs, each managed on its own.
- **Schedule** — crews and field scheduling (a planned future page).
- **Inbox** — the Gmail project inbox for reviewing and filing emails.
- **AI Assistant** — review today's saved work, ask about one selected
  project's records, and review task proposals from a saved meeting.
- **Reports** — current totals and flooring performance numbers.
- **Settings** — your personal preferences, and (for admins) company setup.

At the top you also have **workspace search** (find a client, project, or contact — press Ctrl/Cmd + K to jump to it), a **notifications** bell, and your **profile** menu with sign-out. Administrators also see an extra **People & Access** link in the navigation; it is covered in Part 2.

#### What each badge means

Many pages and features carry a small status badge. These are honest labels about how finished a feature is. Hover over a badge to see its full description. The four badges and their exact meanings are:

- **Working** — *Available with durable saved records.* Use it normally; what you save is kept.
- **In development** — *Available for development and test-data validation.* You can use it, but treat the data as test data while the feature is still being finished.
- **Setup required** — *Available after the required connection or configuration is completed.* An administrator must connect or configure something first (usually Google Workspace).
- **Planned** — *Informational only; the workflow is not implemented yet.* It describes what is coming; there is nothing to use yet.

Today, **Overview** and **Reports** are Working. **Leads, Clients, Projects, Inbox, AI Assistant,** and **Settings** are In development. **Schedule** is Planned.

---

### Leads

A lead is a potential job you are chasing. The Leads page lists your active opportunities and lets you move each one forward through four stages, in order:

1. **New inquiry** — a fresh opportunity has come in.
2. **Site visit** — you are going to (or have gone to) look at the space.
3. **Proposal** — you have quoted the work.
4. **Decision** — the client is deciding.

(A lead whose stage doesn't match one of these appears under **Other stages**.)

**What Advance does.** Open a lead and use **Advance stage** (or the Advance action in the list) to push it to the next stage in the order above — New inquiry to Site visit, Site visit to Proposal, and so on. It only moves one step at a time, and only while the lead is still active and not already at the final stage. If you advance by mistake, an **Undo** button appears in the confirmation message. Advancing does not skip stages and does not mark a lead won or lost — those outcomes are set in **Edit lead**, below.

**Editing a lead.** Open a lead's drawer and use **Edit lead** to change its details — company, contact, project, site, source, stage, next action and its date, the lead owner, and the outcome (**Active**, **Converted**, **Lost**, or **Archived** — records are archived, never deleted). Only an administrator can change the **estimated value**; for everyone else it shows read-only. If someone else saved a change to the same lead while your form was open, saving shows a conflict with each **saved value** beside your entry so you can decide before applying yours over it. Every saved edit is recorded in the lead's history with what changed, from what, to what.

> [SCREENSHOT 2 — see Screenshot index]

---

### Projects

Each project is a single job for one client, managed independently from every other job. A project moves through these lifecycle statuses:

- **Planning** — being scoped and prepared.
- **Mobilizing** — getting ready to start on site.
- **Installation** — flooring is going in.
- **Closeout** — finishing up and wrapping the job.
- **Completed** — the job is done.
- **Cancelled** — the job will not go ahead.
- **Archived** — closed and filed away.

The Projects page can filter to **Active**, **Completed**, **Cancelled**, or **Archived**. "Active" means any job still in Planning, Mobilizing, Installation, or Closeout.

**The project drawer.** Click a project to open its drawer. It has two tabs:

- **Overview** — the site map, estimated and contract value, flooring category, square feet, installation dates, the post-installation callback result, the assigned project manager, and a link to the project's Google Drive folder. Fields that haven't been filled in yet read **Not yet captured**.
- **Meetings** — meeting notes for this project (see the next section).

**Editing a project.** In the drawer, **Edit project** changes the project's details — name, site, client, flooring category, square feet, and segment are open to everyone in the office. Three fields are **administrator-only**: the project **status** (moving a job Planning → Mobilizing → Installation → Closeout → Completed), the **estimated value**, and the **contract value** — they show read-only for everyone else. If a teammate saved a change to the same project while your form was open, saving shows a conflict with each **saved value** beside your entry so nothing is overwritten unseen. Every saved edit is recorded in the project's history with what changed, from what, to what.

**Recording installation dates and follow-ups.** In the Overview tab, under **Installation & follow-up**, an administrator can:

- **Record installation dates** — enter the installation start and completion dates. Completion must be on or after the start date. These dates feed the install-cycle and jobs-completed reporting.
- **Record follow-up result** — set the **Post-installation callback** to **Yes** or **No**, with an optional short note. This records whether the finished job had a callback.

If you are not an administrator, these two buttons are hidden and the section explains that only an administrator can record them. A blank callback still shows as "No," which may simply mean the result was never entered on an older job.

**Drive folder.** Use **Create Drive folder** (or **Open Drive folder** once it exists) to keep that project's permanent emails and documents together. In simulation mode this creates a test folder.

> [SCREENSHOT 3 — see Screenshot index]

---

### Clients

The Clients page is your directory of the companies you work for. Each client has an **industry**, a **status** (Active, Prospect, or Inactive), a primary contact, and its own Google Drive account folder.

Open a client to see its drawer: the account folder, the job-site map, and the list of that client's projects. From there you can start a **New project** for that client. Account-level documents you want to reuse across jobs live in the client folder; documents that belong to a single job stay in that project's own folder.

---

### Meetings and phone calls

Meeting notes live inside each project, on the project drawer's **Meetings** tab. Use **Add meeting** to capture one. You give it a title, a date and time, and a **type**:

- **Client meeting**
- **Site walk**
- **Internal huddle**
- **Pre-install meeting**
- **Closeout review**
- **Phone call**
- **Other**

Phone calls are captured the same way — add a meeting and choose **Phone
call**. Record who was on the call in the **Attendees** box, one name or email
per line.

**The Otter workflow.** The recommended way to capture a meeting is: copy the private Otter conversation link, paste in the **Summary** and **Action items**, and add the exported **Transcript** when you need the full searchable detail later. Paste the link into the **Otter conversation link** field. Note: the app only stores the link as a reference — it does not change who can see the recording in Otter, so keep the Otter link restricted to approved people.

**Action items.** Enter one follow-up per line in the **Action items** box. They are saved with the meeting and shown as a checklist, so decisions and next steps stay attached to the project.

---

### The Inbox

The Inbox is the **Gmail project inbox** — where you review emails and file the right ones into the right project. It is organized into mailbox buckets:

- **Inbox** — the regular company mailbox.
- **FCI/Intake** — messages waiting to be routed.
- **Needs review** — the app's stored, Administrator-only analysis queue. It
  is not a Gmail label filter.
- **FCI/Filed** — messages already copied into a project.

**Filing is review-first — nothing happens automatically.** Rules can *suggest* a destination, but you always choose the exact project and approve every copy yourself. To file an email, use **Review & copy**, pick the exact project, review the preview (nothing is copied at the preview step), then confirm. Only then is the email and its attachments copied into that project's Drive folder. Your Inbox is never emptied or archived — the original email stays put; filing adds a copy.

**Reply drafts are never sent for you.** Use **Draft reply** to write a response. Saving it stores an **unsent draft** in Gmail (or a local draft in simulation mode). Actually sending it is always a separate, deliberate action you take yourself.

Administrators with the company AI key configured may also see **Suggest with
AI** and **Draft with AI**:

- **Suggest with AI** reads only the loaded message summaries and proposes a
  project beside the ordinary filing-rule suggestion. **Accept** merely
  preselects the existing Review & copy window; the administrator still
  previews and confirms the filing.
- **Draft with AI** reads one message and limited saved project context, then
  places proposed text in the reply composer. It does not save or send
  anything. **Save draft** remains the separate human action.

In simulation these features read the local sample mailbox and never contact
Google. In live mode they require the approved Workspace Gmail connection.
Both modes still require `OPENAI_API_KEY`; if it is Missing, these AI controls
are absent or disabled while the ordinary Inbox and manual draft flows keep
working.

When the separate **Inbox analysis** switch is on, opening or refreshing the
Inbox starts one bounded background sweep for messages that do not yet have a
stored result. The app stores each result in its database so reloading does not
pay to analyze the same message again while the label catalog is unchanged.
The stored display snapshot includes the email **subject, sender, and received
date**. In other words, subjects and senders now persist in the app database;
turning the switch off stops future sweeps but does not erase results already
stored. Analysis never sends, files, labels, archives, drafts, or creates a
lead. The Inbox reports either **You're caught up** or **Older messages not yet
analyzed**; **Check older** continues another bounded batch. Opening **Needs
review** reads those stored rows and their total directly from the app
database. Rendering the stored rows makes zero per-row Gmail calls; the
separate bounded sweep may read newly encountered messages. **Mark reviewed**
dismisses one row from the queue without changing Gmail.

If a message exhausts all three analysis attempts, the review queue does not
pretend that the empty review list means every message was handled. It shows
**N messages could not be analysed — reason** beside the sweep result. This
count includes only exhausted failures for the current analysis catalog, not a
message that still has an automatic retry available or one paused by the daily
provider limit. An Administrator can use **Retry failed analyses** after the AI
provider recovers. That action resets the retry budget in one guarded database
update and then runs the ordinary bounded, review-first sweep. It can recover
provider, deadline, item-processing, and stored-state read failures. It
deliberately does not reset a `gmail_read_failed` row, because that code can
represent a permanently deleted Gmail message; daily-limit, aborted-request,
and review-retirement failures are also excluded. No retry sends, files,
labels, archives, drafts, or creates a lead.

> [SCREENSHOT 4 — see Screenshot index]

---

### My settings and page layouts

Open **Settings → My settings** to manage the preferences tied to your own signed-in account. These are yours alone and are separate from company setup. You can set:

- **My display timezone** — America/New_York, America/Chicago, America/Denver, or America/Los_Angeles. This drives the Overview greeting and the times you see.
- **Default reply signature** — added to the bottom of new Gmail reply drafts.
- **My notification preferences** — checkboxes saved for a future notification feature. These are marked **Planned**, so changing them does not change any alerts yet.

Click **Save my settings** to keep your changes.

If you are an office user rather than an administrator, **My settings** also shows a read-only **AI assistant** card. It displays the provider, whether the company API key is **Configured** or **Missing**, the model name, and whether each assistant feature is On or Off. It never displays the key itself. Administrators manage those company-wide switches in **Settings → AI assistant**.

**Reordering and hiding sections (page layouts).** On the **Overview** and **Reports** pages you can arrange the layout for yourself. Click the gear (**Edit layout**) button in the page header, then:

- **Move up** / **Move down** — or drag — to reorder sections.
- **Hide** — to remove a section from your view (this only changes what you see; it hides nothing for anyone else).
- **Reset to default** — to put everything back.
- **Done** — to save your arrangement.

Your layout is saved to your account, so it follows you between devices.

---

### What the numbers mean

**Overview metrics** (top of the Overview page):

- **Active pipeline** — the total estimated value of your open opportunities, with a note of how many open opportunities that covers.
- **Active projects** — how many projects are currently in progress (Planning, Mobilizing, Installation, or Closeout).
- **Project meetings** — how many meeting notes have been saved.
- **Filed emails** — how many emails have been filed into projects.

**Reports summary metrics** (top of the Reports page):

- **Pipeline value** — estimated value of active leads (visible to administrators; other users see that financial totals are restricted).
- **Active projects** — active project records out of your total project records.
- **Clients** — how many client accounts you have.
- **Project meetings** — how many meeting notes have been saved.

**Reports → Business KPIs** (flooring performance; some dollar figures are shown to administrators only). Each one is measured for the reporting month you pick, except where noted:

- **Win rate** — of ALL the leads ever decided, the share that were won, also broken out by lead source. *Not month-scoped — this covers your whole history, so it will not change when you switch months.*
- **Booked value per month** — the total contract value (or estimate, if no contract yet) of projects booked in the selected month.
- **Average job value** — the average booked value across ALL your projects that have a recorded contract value or estimate. *Not month-scoped.*
- **Sales cycle days** — the average number of days from a lead being created to being won, across ALL won leads. *Not month-scoped.*
- **Backlog** — how many active projects (Planning, Mobilizing, Installation, Closeout) are outstanding right now, with their estimated value. *A current snapshot — not month-scoped.*
- **Jobs completed per month** — how many projects were completed in the selected month.
- **Install cycle days** — the average number of days from installation start to installation completion for jobs finished in the selected month.
- **Callback rate** — of the jobs completed in the selected month, the share that had a post-installation callback recorded.
- **Product mix** — how the selected month's jobs break down across flooring categories (by count, and by value share for administrators).
- **Revenue per square foot** — the average booked value per square foot across the selected month's jobs that have square footage recorded.
- **Estimate accuracy** — the average ratio of contract value to the original estimate for the selected month's jobs; 100% means the contract matched the estimate.

**Also on Reports:** **Pipeline by stage** (your active leads grouped by stage) and **Projects by status** (your projects grouped by lifecycle status). Both are clickable and take you to the matching filtered list.

A dash (—) in any number means there is nothing to measure yet (for example, no jobs completed that month) — it is never an error. Some KPIs describe things the app is deliberately not tracking yet, such as gross margin, crew utilization, and customer review scores, because the underlying records do not exist.

---

# Part 2 — Administering the app

*This part is for the owner or office administrator who sets FCI Operations up and keeps it running. You do not need to be technical. Where a step really does need a developer, this guide says so plainly and points you to "When to call the developer" at the end.*

> **What you are looking at today.** The version of the app your team can open right now is a **development build** (private Sites development version 40). It is real and it works, but it is the practice-and-verify copy, not the final production system. Everything built after that version currently lives in the source code only and has not been switched on. Unless you have connected a live Google account, the app runs in **simulation mode** — it uses safe local sample data and never contacts Google. The screenshots below are simulation captures. This is on purpose: you can learn every screen without touching a client's real email or calendar.

---

## What Settings controls

Settings is where the company is configured. Think of it in two halves:

- **For you** — your own personal preferences, saved only to your sign-in. Nothing here affects anyone else.
- **Workspace & company setup** — the company-wide configuration: the Google connection, calendars, the email filing rules, the client directory mirror, office defaults, AI assistant controls, security, and the launch checklist. Only administrators see and change these.

Almost everything on the company side is either **working today** or clearly labeled as **planned** (saved now, switched on later). The app never pretends a planned feature is live. When you see a small badge — *Working*, *In development*, *Setup required*, or *Planned* — take it at face value.

> [SCREENSHOT 5 — see Screenshot index]

---

## Panel by panel

There are nine sections in the left navigation. Here is what each one is for.

### 1. My settings *(everyone — this is the "For you" section)*

Your personal defaults, tied to your own login. Two settings here are **working now**:

- **My display timezone** — used for your Overview greeting and the times you see.
- **Default reply signature** — added to the bottom of new Gmail reply drafts you create.

Below those is **My notification preferences**. Those checkboxes are **saved but planned** — they are stored for a future personal-alert feature. Ticking them does not change any alert today, because notifications currently run at the company level only. That is the honest state, and the panel says so.

Office users also see the company **AI assistant** card here in a read-only form. It shows only whether the key is **Configured** or **Missing**, the model name, and the five feature states, but no control for changing them. Administrators use the company sections below for organization-wide settings.

*My settings is the only Settings section a non-administrator sees.*

### 2. Google Workspace

The heart of company setup: connecting the one company Google account and creating the Shared Drive, folders, spreadsheets, and calendars the app uses. This is a four-stage flow and it has its own full walkthrough in the next section, "Connecting and verifying Google in plain words."

The Stage 1 **App-managed Workspace configuration** controls four values that used to require a hosted-setting edit: project-folder provisioning, the Gmail intake mailbox, the Client Directory spreadsheet ID, and the Google Forms response spreadsheet ID. The mailbox selector offers only addresses already present in the hosted `GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS` allowlist and using a hosted allowed domain; Settings cannot add an account or widen either allowlist. Saving a different authorized address takes effect without a redeploy. Because Gmail reads as `users/me`, the saved mailbox must match the account actually connected to Google. If they differ, readiness names the saved mailbox and the connected account — the connected one masked — and blocks Google operations. **Connect Google Workspace** stays available, but it repairs the mismatch only when you reconnect as the account that is *already connected*; the safe, non-destructive fix is to re-select that connected account in the mailbox selector. Connecting as a **different** Google account is refused on any tenant that already holds saved Workspace data — including a tenant whose only saved value is this mailbox — and returns a different-tenant error that can be cleared only by **Start fresh on a new tenant**, the destructive reset described under "Stage 2 — Connect" below. Moving the effective intake mailbox to a different Google account on an established tenant therefore means accepting that reset and everything it discards, not simply reconnecting. The two Sheet fields verify the exact ID against Google before adopting it. Each live-Workspace row names its effective source as **App-saved**, **Environment**, or **None**. App-saved values win; the matching environment values remain first-boot fallbacks. In local simulation, project-folder provisioning is fixed on for the safe sample-folder workflow: the row says **Simulation fixture (always enabled)**, its control is locked, and neither the UI nor the API can save a misleading future live-mode value. Hosted OAuth secrets and identity allowlists are still outside the app.

### 3. Calendar & appointments

The plan for the company's two shared calendars: one named **FCI • Client Appointments** (site visits, measurements, client meetings) and one named **FCI • Field Schedule** (crew and job assignments). You choose whether to create two new shared calendars or point at existing ones, set the timezone, and save the appointment-reminder default. Both Calendar ID fields and their **Verify calendar** actions stay visible in either setup mode, including the recommended default mode. Their status says whether runtime uses an app-saved value, an environment fallback, or no value.

The **Appointment reminder hours** field is marked **Planned**: it is saved for the upcoming reminder worker, but saving it does not send anything yet. Its value is separate from the client- and crew-reminder defaults under Workflow & notifications. The panel is also honest that FCI Operations stays authoritative — if someone later edits an app-created Google event, it gets flagged for review rather than silently overwritten.

### 4. Inbox & file rules

Where you review how incoming email is matched to projects and filed. The unbreakable rule across the whole app is **review-first**: no email is ever archived, labeled, or copied into a project without you selecting the exact project and confirming. Rules here help *suggest* a match; a person always approves the action.

The three built-in rules can drive those review suggestions. A custom rule is saved but does not have a live matcher yet, so its row shows **Review-first** and **Saved — not yet applied** instead of an active Action state. Its saved priority and Enabled/Paused state are configuration metadata; they do not change inbox suggestions until a supported matcher consumes the rule.

### 5. Client Directory

The **Client Directory & Project Register** — a one-way Google Sheets mirror of your clients and projects. The app is always the source of truth; the spreadsheet is a read-and-filter copy that updates after app changes and when an Administrator presses **Sync now**. **Refresh status** checks the latest recorded mirror state without running a sync, so any office viewer can re-read the status safely.

- **Client Directory** tab mirrors client code, contacts, project count, folder link, status, and last update.
- **Project Register** tab is rebuilt from your project records (client, status, site, value, manager, Drive link).
- Each card formats the recorded `lastSyncedAt` as a readable local date and time while showing `lastError` exactly as the mirror status returned it. The shared status labels translate the underlying state into **Checking sync**, **Syncing**, **Needs attention**, **Synced**, or **Not synced**. If a live sync is interrupted, an over-age **Syncing** state recovers to **Not synced** on the next status refresh instead of remaining frozen.

One column is deliberately yours to edit: **Account Notes**. Everything else on the generated Project Register will be overwritten on the next sync, so do not hand-edit it. Spreadsheet edits do not write back into the app.

If the mirror is not configured, the card links directly to **Google Workspace → Stage 3**. An Administrator can paste the existing workbook ID into Stage 1 and choose **Verify and adopt**; the verified ID is saved both as the app-managed resource and as the Client Directory saved tier. `GOOGLE_WORKSPACE_CLIENT_DIRECTORY_SHEET_ID` remains a bootstrap fallback.

**Updated July 25, 2026.** Administrators can use **First-run data import** below the mirror cards to review existing clients first and projects second, in batches of up to 10 rows. The preferred source is a blueprint spreadsheet with the clearly marked **Clients Import** and **Projects Import** tabs; a bounded CSV is the alternative. Previewing never creates records. The administrator must select each ready row (or use **Select all ready rows**) and confirm it. Client duplicates are reviewed by email, phone, or address; the readable client address is not saved, only a one-way duplicate-check fingerprint (an unsalted SHA-256 digest of the normalized address) for safe re-runs — it cannot be read back by inspection, but because street addresses are low-entropy it is a stable identifier, not a privacy guarantee. Every project must match one saved client by code, name, or email, and an unmatched project never creates a client for itself. Once records exist, the import tools collapse until an administrator explicitly reopens them. This source build remains development-only: every imported client or project name must begin with **FCI TEST — DO NOT USE**, and real client data stays blocked until the WS-11 acceptance gate and owner launch approval are complete.

Below the import card, **Google Forms responses** is a separate review-first queue.
An administrator presses **Check for new form responses** to read at most 25 rows
from the linked response Sheet. The app records a row scan cursor and check time,
using the row only as a circular read optimisation; a Timestamp-plus-content hash identifies
each submission even if rows are inserted or deleted. Repeating the action with no new
rows creates nothing and moves nothing, though it does still read a bounded window from the
Sheet. If someone edits a response after submitting it, the app sees a changed answer as a
new submission and queues it again — check for a near-identical pair before accepting.
While the test-data gate is closed, the response Name must begin with
**FCI TEST — DO NOT USE**. Possible duplicates use the same
matching rules as first-run import, malformed rows stay visible for correction, and
the estimated value stays blank until a person enters it. Submitting a completed row
uses the ordinary lead-creation route; only after that succeeds does the review leave
the queue. If the queue update fails, the created lead is named and the row remains
visible with a **Retry queue refresh** action that performs only the safe queue read,
so the administrator does not create it twice. Real-data
rows that otherwise validate do not advance the watermark while the WS-11/owner gate
is closed. Invalid non-test rows are redacted, queued with blank required lead fields,
and checkpointed so one malformed response cannot block later submissions.
The linked response workbook is selected in **Google Workspace → Stage 1** with its own
**Verify and adopt** field. `GOOGLE_WORKSPACE_LEAD_FORM_RESPONSE_SHEET_ID` is only the
bootstrap fallback after SET-40; the app-managed verified ID wins.

> [SCREENSHOT 6 — see Screenshot index]

### 6. Workflow & notifications

Simple office defaults — independent client- and crew-reminder hours, and an office notification email — plus Google Chat routing. All three defaults are marked **Planned**: they remain editable and persist separately, but the upcoming reminder worker does not send anything yet. An older saved appointment-reminder value remains the appointment default only; it is not copied into the newer client-reminder field.

- **Google Chat notification routing.** You can enable or disable the integration in the app, review which five event types are allowed to notify which approved Google Chat space, and switch each route on individually. The card identifies the enable source as **App-saved**, **Environment**, or **None**. App-saved wins and `GOOGLE_CHAT_NOTIFICATIONS_ENABLED` remains a bootstrap fallback. Webhook addresses are secrets that live in the hosting environment and never appear in the app or browser.

> [SCREENSHOT 7 — see Screenshot index]

### 7. AI assistant

The dedicated administrator section shows the provider (**OpenAI**), company API-key state (**Configured** or **Missing**), effective model name and source — never the key value. Administrators can type any provider model ID; there is deliberately no code allowlist. When the model field is intentionally changed, Save performs an OpenAI model lookup with the server-held key and rejects an unknown ID with the provider's bounded reason. A feature-only save does not validate or rewrite the model. Five switches control **Organization-wide answers**, **Inbox filing suggestions**, **Inbox analysis**, **Reply drafting**, and **Task extraction from meetings**. They default to on when the key is Configured, and all five have server consumers. The current card shows **In development** on organization-wide answers, Inbox suggestions, and Inbox analysis, and the older **Planned** badge on Reply drafting and Task extraction; those last two badges lag their shipped, review-first consumers and are recorded for a presentation follow-up. When the key is Missing, the switches are unavailable and the card says: “Add OPENAI_API_KEY to the hosting environment to enable AI features. Everything else keeps working without it.” See "The AI assistant setup" below.

The section also states what Inbox analysis saves: the email subject, sender, received date, and analysis result persist in the app database. That stored snapshot can include customer names and subject lines, and turning Inbox analysis off stops future sweeps without erasing results already saved.

### 8. Data & security

A plain-language summary of the safeguards already in place: review-first email filing, one administrator-approved Workspace connection (consumer Gmail accounts are rejected in live mode), isolated local simulation that never contacts Google, and the installable web app. It also includes phone-install guidance.

Administrators also see a read-only **Who has access** card. It shows the office-email, office-domain, and Administrator-email identifiers currently supplied by the hosting configuration — never secrets, keys, or tokens. If both office allowlists are empty, the card says **"Office access is not configured — the app denies everyone"**. This card describes the current development sign-in gate only: the lists are changed in hosting configuration, while live-login invitations and roles belong in **People & Access**. There is nothing to edit on this page.

> [SCREENSHOT 8 — see Screenshot index]

### 9. Testing & launch

**Updated July 25, 2026.** The **Test & launch checklist** separates two kinds of development evidence. **Verified from live status** rows read the existing Workspace connection, Calendar access, and Client Directory mirror endpoints; they show current status and never have a checkbox. **Administrator attestations** are the human acceptance steps. When an administrator checks one, the app saves the administrator's email and the time, and that attestation remains after reload. While those saved attestations are being checked—or if their read is unavailable—the rows show an honest checking/unavailable state rather than claiming they are not attested. The saved-checklist read model is safe and read-only for an office user, while the current company-setup navigation continues to keep this whole panel in the administrator audience. In the local development simulation those live rows read *Simulated* rather than *Verified*, and the summary reports a simulated environment, because there is no real Google connection to verify against.

This card covers the working development copy only. It links straight to Google Workspace setup, but it does not complete or replace production acceptance. The production gate remains the separately reviewed [Production acceptance checklist](task-checklists/05-acceptance-checklist.md).

Below the checklist, **Employee-login readiness** shows presence only for the separate authentication-only Google client. It lists the required configuration names, the open-invitation count from People & Access when that secure projection is available, and the owner activation gate. It never displays a client ID, redirect URI, hosted domain, secret, file path, or any other configured value. **Configuration ready** does not mean employee login is live: owner approval, production migration and grants, live OIDC configuration, and deployment remain separate gates.

Two read-only policy cards explain **What each role can do** and the fixed **Employee session limits**. The role card covers Administrator, Office Operations, Project Manager, and the future one-project Field link. The session card records the 30-minute idle limit and eight-hour absolute limit. These cards have no switches because the server policy is fixed for the first release; People & Access assigns one role rather than editing capabilities or session rules.

---

## Connecting and verifying Google in plain words

Open **Settings → Google Workspace**. At the top is a **status banner** and a **Check readiness** button. Press **Check readiness** any time you want the app to re-look at everything and tell you exactly where you stand — every status on this page comes from a live check, never a guess.

The banner shows one of a few plain messages, for example:

- **"Simulation ready"** — you are in safe practice mode; everything below runs locally.
- **"Not connected to Google yet"** or **"Ready to connect Google"** — time to connect.
- **"Connected as ab•••@yourcompany.com"** — you are live; the account is shown partly masked.
- **"Workspace setup is ready"** — all checks pass.

A small tag reads **SIMULATION** or **WORKSPACE**, and a **"Stage X of 4"** progress note tells you which stage needs attention.

> [SCREENSHOT 9 — see Screenshot index]

Below the banner are **four stages, done in order**. The app opens the stage you need next and blocks later stages until the earlier one is genuinely confirmed. Here is each stage as you will experience it.

### Stage 1 — "Prepare the tenant"
*On-screen subtitle: "One-time steps done in Google's consoles — usually your Workspace admin."*

This is the one-time groundwork in Google's own admin consoles — verifying your company domain, creating the one connection account, and enabling Gmail, Calendar, Drive, and Sheets for it. The app shows a checklist of what still needs to be true before you can connect. Much of this is Google-console work; if any of it is unfamiliar, this is a "call the developer" stage. The stage turns **DONE** when the connection prerequisites are all ready.

### Stage 2 — "Connect"
*On-screen subtitle: "Authorize the one company Google account."*

Press **Connect Google Workspace**, sign in as the company account selected for the Gmail intake mailbox, and approve the requested permissions. The hosted allowlist may contain more than one approved company address, but Gmail still runs as one connected `users/me` account at a time, so the selected mailbox and connected account must match. A personal `@gmail.com` account remains outside the authorized company allowlist. After you approve, the app returns to this page and refreshes readiness automatically.

If you are in simulation, this stage instead offers **Reset simulation data**, which restores the safe sample Gmail, Calendar, Drive, and Sheets data.

Two buttons you will meet here later:

- **Reconnect Google Workspace** — appears if Google ever needs you to re-approve permissions.
- **Disconnect Workspace** — severs this app's access immediately and asks Google to revoke
  the grant. Two things to know. The connection record is **kept, marked revoked**, so the
  history of who connected and when survives; the saved token itself is destroyed, so
  reconnecting always requires approving access again from scratch. And if Google cannot be
  reached to confirm the revocation, you get a warning rather than a success message: the app
  can no longer revoke it for you, so finish the job by removing **FCI Operations** under the
  connected Google account's security settings.

After a connection is disconnected, administrators can also choose **Start fresh on a new tenant**. Use this only for an intentional company Workspace move. The app requires you to type the stored connected account exactly before it proceeds; the configured environment account is not accepted as a substitute. The reset deletes the revoked connection tombstone and all saved Gmail, Drive, Calendar, Sheets, resource, blueprint, and sync identifiers for that tenant. Client and project business rows survive, but both their saved Drive folder IDs and Drive URLs are cleared. Gmail-derived tasks survive with their old message references cleared, and non-tenant Workspace settings remain.

This reset is destructive. In particular, it discards filed-email evidence: those rows point to Drive files in the old tenant, and the app will no longer be able to read those files after the move. Keeping the rows would preserve the appearance of an audit trail without usable evidence. The app records one administrator audit event naming the discarded stored account, but it cannot restore the removed evidence or identifiers. Connect and provision the new tenant only after the reset completes.

Administrators also get a small **Connection health** expander showing the connected account and, per service, whether it is *Enabled* in the app and *Granted* by Google. Note the honest caveat the app itself prints: this reflects the saved consent, not a live health check.

> [SCREENSHOT 10 — see Screenshot index]

### Stage 3 — "Define & create your workspace"
*On-screen subtitle: "Decide what exists, then create it — in order."*

Here you adopt the manually created **FCI Operations** Shared Drive and then create everything else from buttons in the Resources area, **in order**:

1. **Shared Drive** — adopt it, and let the app verify its sharing restrictions.
2. **Folder tree** — create the standard folders.
3. **Spreadsheets** — ensure the blueprint spreadsheets.
4. **Templates** — *Ensure templates* creates the Templates folder and the starter document templates.
5. **Calendars** — verify only; this row stays locked until step 4 finishes.

**Do not skip step 4.** Templates is one of the four items the stage counts toward "ready", and Calendars is gated on it — so if you stop after the spreadsheets, Stage 3 sits at *3 of 4 ready*, Calendars stays disabled, and Stage 4 stays **WAITING** with nothing on screen explaining why.

You do **not** hand-build the project folders; the app creates them from the saved blueprint so filing always lands in the right place. The client and project naming patterns and owner-managed folder lists apply to folders the next provisioning run **creates** — a client or project folder that already exists keeps the name it has, because provisioning finds it by its stored identity rather than by its name. To rename an existing client or project folder, rename it manually in Drive; the **Drift check** repairs root-tree folders and registered spreadsheets and templates, never generated entity folders. Registered-calendar drift is reported for you to see, but its repair stays owner-gated and is not offered as a one-click action. The system filing folders stay locked on purpose.

**Updated July 24, 2026.** Stage 3 keeps **Workspace creation** and **Blueprint** in separate disclosure rows. Their status stays visible while collapsed; the first row that still needs work opens automatically on initial load, and both stay collapsed when setup is complete. Expanding or collapsing either row changes presentation for the current session only.

### Stage 4 — "Verify & maintain"
*On-screen subtitle: "Prove each service works, then ongoing upkeep."*

This stage proves each service actually works, then stays available as your ongoing toolbox. It has three **first-run checks**, each of which is completely safe:

- **Gmail — labels & test email.** *Prepare FCI labels* creates the three FCI labels; *View inbox* lists real messages; *Send Workspace test* (or *Add sample email* in simulation) sends one test email **only to your own configured mailbox**. Nothing is ever sent to a client from here.
- **Calendar — appointments & test hold.** *View upcoming events* reads a seven-day window; *Create test hold* makes one private 30-minute hold with no guests and no notifications.
- **Sheets — mirror sync.** *Sync now* runs one sync of the Client Directory and Project Register and reports exactly what changed.

Each row reads **READY TO VERIFY**, then **VERIFIED** once it passes. The stage shows **READY** when all three are verified.

The **Drift check** under **Ongoing upkeep** compares the saved blueprint with the
registered Google folders, templates, spreadsheets, and calendars. The check itself
reads Google metadata only. A missing resource offers the matching existing setup
action; a renamed owner-managed folder offers either **Rename in Drive** or **Use Drive
name in blueprint**; a renamed system folder offers **Rename in Drive** only. Unmanaged
or removed resources stay visible as informational rows and are never deleted. Every
repair waits for an Administrator to click it.

**Operations health** is the database-only troubleshooting view in the same Ongoing
upkeep group. It lists stuck Drive leases, failed Gmail archives, and recent integration
activity for the current connection. It does not contact Google and it never repairs or
replays work automatically. Simulation results are labeled as local test operations.

> [SCREENSHOT 11 — see Screenshot index]

**A note on how email filing feels.** When you press **Review & copy** on a message, a window opens where you pick the exact project and press **Review destination**. The app shows you precisely where the email and attachments would go — the original email becomes an `.eml` in the project's *05_Correspondence / Email Archive* folder, and attachments go to *05_Correspondence / Email Attachments* — and **nothing is copied until you press Copy email to project**. Your Gmail Inbox is always left intact.

> [SCREENSHOT 12 — see Screenshot index]

---

## Routine maintenance

Most of the time, FCI Operations looks after itself. Here is what actually needs a human, and how often.

**Weekly-ish, or whenever something looks off:**
- Press **Check readiness** on the Google Workspace page and glance at the banner. Green-and-connected means nothing to do.
- Glance at the **Client Directory** panel. If the Client Directory or Project Register shows an old sync time or an error, press **Sync now**. A normal sync just rebuilds the mirror from the app.

**Use as needed, from Stage 4's "Ongoing upkeep" tools:**
- **Renames** — if you need to rename an app-managed folder, do it here, not directly in Drive. The app updates Drive and its own records together so filing keeps working. (This shows *AVAILABLE* once the Shared Drive is set up, otherwise *WAITING*.)
- **Notification routing** — opens the Google Chat routing page described earlier.
- **Drift check** — press **Check for drift** after changing the blueprint or whenever a
  managed Google resource looks out of place. Review each Missing or Renamed action
  before applying it. Unmanaged rows are informational and never trigger deletion.
- **Operations health** — refresh this when a Drive or Gmail action fails. A stuck lease
  needs its five-minute window to expire before you retry; a failed archive is retried
  from the original **Review & copy** action. The recent-activity table shows what the
  app recorded, not a live Google health check.

**Essentially never (leave it alone):**
- The system filing folder names — they are locked because filing depends on them.
- The generated spreadsheet columns — every **Project Register** column is cleared and rebuilt on each sync, so never edit that tab by hand. The one column that IS yours to edit lives on the **Client Directory** tab: **Account Notes** (column I), which the sync deliberately preserves.
- Anything in the hosting environment (keys, secrets, addresses). Those are developer territory.

---

## Users and access

**What actually controls sign-in today (development build).** App sign-in uses **Sign in with ChatGPT**. The app then checks an allowlist that lives in the hosting environment: only listed office emails (or a listed company domain) can open the app, and a separate short list marks who is an administrator. Anyone not on the list sees **"Access not authorized."** This allowlist is the real gate, and only the developer can change it — so today, adding or removing who can actually sign in is still a request to the developer.

**The in-app People & Access screen (In development).** There is an admin-only **People & Access** screen in the app. Administrators reach it from a **People & Access** link in the navigation (it carries an *In development* badge). It lets an administrator invite people and assign one of three roles — **Administrator**, **Office Operations**, or **Project Manager** — and disable or sign out a person. Because it is *In development*, treat its records as test data: this screen does **not yet** govern who can actually sign in, and it does not replace the hosting-environment allowlist described above. Use it to try the workflow, not to grant real access yet.

Keep this straight in your head: the **app login** (who may open the app) is deliberately separate from the **Google data connection** (the one company account that supplies Gmail, Calendar, Drive, and Sheets). Connecting Google does **not** change how people log in.

**How it will work at live login (planned).** The production plan replaces ChatGPT sign-in with **Sign in with your company Google account** and makes the **Administrator / Office Operations / Project Manager** roles — the same ones the People & Access screen already collects — enforced by the server, with project-level permissions so you can decide who sees which jobs. Field workers do not receive employee accounts in the first release; a future Field link is read-only, limited to one exact project, expiring, and revocable. Every employee session has a 30-minute idle limit and an eight-hour absolute limit.

Administrators can review the source readiness for that change under **Settings → Testing & launch → Employee-login readiness**. The card deliberately distinguishes three facts: whether the required configuration names are present, whether the secure People & Access projection can report a real open-invitation count, and whether the owner activation gate has been opened. A real zero invitations is shown as zero; an unavailable projection is shown as unavailable, never as zero. That server enforcement still needs the production environment and is a developer-and-owner rollout, not an in-app toggle. Until it is switched on, the People & Access screen stays in test-data mode and adding or removing a real user is a request to the developer.

---

## The AI assistant setup

**Do I need a ChatGPT account? No.** Nobody on your team ever links a personal ChatGPT or OpenAI account, and nobody logs into OpenAI. The assistant runs on **one company OpenAI API key** that the administrator (in practice, the developer) sets once in the hosting environment's settings — not in the app, not in the code, not in email. Every user simply shares that one company key behind the scenes.

Because it is a secret, the app never shows the key itself. The **AI assistant** Settings card shows only whether it is **Configured** or **Missing**, together with **OpenAI** as the provider and the effective model name/source. Administrators find the editable card in **Settings → AI assistant**; office users see the same information and feature states read-only in **My settings**. Normally the validated app-saved model is active. `OPENAI_MODEL` is the explicit exception to the other SET-40 precedence rules: when present, it is an emergency environment override. The card then shows the override as effective, shows the preserved app-saved fallback separately, and disables fallback editing until the hosted override is removed. Feature-only saves never copy the override into the saved fallback and never call model lookup. When the key is Missing, the feature controls are unavailable and the app says plainly to add the company key to the hosting environment — it never fakes a ready state.

The five company-wide feature switches are **Organization-wide answers**,
**Inbox filing suggestions**, **Inbox analysis**, **Reply drafting**, and
**Task extraction from meetings**. They are on by default when the key is
Configured. Here is the source-verified behavior:

- **Organization-wide answers** gates the project-ID-absent server API. When
  it is off—or the key is Missing—the API returns a bounded records-only
  result with the cause instead of calling OpenAI. The current **Ask** form
  always sends a selected project, so there is no first-party organization-
  wide Ask control yet.
- **Inbox filing suggestions** gates the Administrator-only **Suggest with
  AI** action. A Missing key removes the button; an off switch returns an
  honest denial. Accepting a suggestion opens the ordinary filing review.
- **Inbox analysis** gates both the Inbox's automatic bounded sweep and the
  server route that stores its results. Off means an Inbox load makes no
  analysis request and therefore no provider call or `mail_items` write.
  Simulation uses deterministic local fixture analyses and never calls
  OpenAI. Live results store a bounded subject, sender, and received date with
  the analysis so the review record remains readable without another Gmail
  request.
- **Reply drafting** gates the Administrator-only **Draft with AI** action. A
  Missing key disables it; an off switch returns an honest denial. Generated
  text stays in the composer until the human separately saves an unsent
  Gmail draft.
- **Task extraction from meetings** gates provider-generated proposals when
  the key exists. With a Missing key, the app deliberately offers literal
  saved action items as records-only proposals even if that stored switch is
  off. Nothing becomes a task until a person presses **Accept**.

The card's current **Planned** badges for Reply drafting and Task extraction
are stale presentation labels; the consumers above are implemented. That
mismatch is documented rather than pretending either the badge or the
behavior says something it does not.

The **AI Assistant** page opens on **Today**, a deterministic list of overdue
and due-today tasks, today's meetings, overdue lead follow-ups, closeout
follow-ups, and a link to the Inbox review bucket. It is computed from saved
records when opened, uses your display timezone, and never searches Gmail or
calls OpenAI. Completing a task is an explicit checkbox action.

The second tab is **Ask**. It currently requires one selected project. Its
**What you can ask** panel starts collapsed so it does not crowd the question
workspace. Expand it for five examples:

- **Which projects have open callbacks?**
- **What did we decide in the last Hendricks meeting?**
- **What tasks are overdue?**
- **Show installation dates for active commercial projects.**
- **Find the change order document for project 2026-014.**

The help currently says answers can use saved records and Drive files.
However, the current route has not composed the optional `drive_search`
service, so Ask answers use saved app records only. The change-order/Drive
example is approved end-state copy, not a working document-search promise
today. Phone calls are saved as meetings, and automated phone-provider intake
remains production-gated.

What the assistant does and does not do, so you can set expectations:
- It opens with a deterministic, provider-free **Today** view. **Ask** answers
  about one selected project, and every grounded answer shows its sources for
  you to open and check. The broader organization-wide route is wired behind
  its saved feature switch, but the page does not expose that Ask flow yet.
- It will tell you when evidence is missing rather than guess.
- It can propose Inbox filing destinations, reply text, and meeting tasks,
  but each proposal stays behind the existing human review/confirm surface.
- It never sends email or files a message. Saving an unsent Gmail draft,
  confirming a filing, or accepting a task is always a separate human action.

Simulation changes the Google side for triage and reply drafting: they read the
local sample mailbox and never contact Google. Inbox analysis goes further and
uses deterministic local analysis fixtures, so its sweep calls neither Google
nor OpenAI. Saved-record Q&A, Today, and task extraction use the same D1
records in both modes. When configured, those other click-driven features may
still call OpenAI; simulation is not generally a free or offline AI provider.

*(Aside on app identity: sign-in is ChatGPT-Sites login today and will become Google Workspace sign-in at production. That is separate from the OpenAI key, which is only about the assistant.)*

---

## Troubleshooting

The six issues you are most likely to hit, in plain words. Several of these are hosting-environment or Google-console matters — where that is the case, it is noted, and it belongs with the developer.

1. **"The web address doesn't match" (redirect URI mismatch).** Google is refusing because the callback address it was given does not exactly match what is registered. This is a Google-console detail — a stray character, `http` vs `https`, or a changed hostname. **Developer fix.** After they correct it, wait a few minutes before retrying.

2. **"This app is internal only" (org_internal).** The account you signed in with is outside the company's Google organization, or the wrong Google project is selected. Use the approved company account. If it persists, **developer**.

3. **"The account is unauthorized."** The account you connected is not on the approved list, or its domain is not allowed. The approved-accounts and allowed-domain settings live in the hosting environment, so correcting the list is a **developer** change; after they update it, disconnect and reconnect the exact approved account.

4. **"Reauthorization is required" for Gmail, Calendar, Drive, or Sheets.** The permissions changed or a service was not fully approved last time. Fix it yourself: **Disconnect Workspace**, then **Reconnect** the exact approved account and approve every listed service.

5. **"Shared Drive verification fails."** Almost always because the ID points at a normal My Drive folder instead of a Shared Drive, or the connection account is not a **Manager** of that Shared Drive, or two drives share the same name. Confirm the account is a Manager and, in Resources, pick the intended drive explicitly. Keep provisioning off until verification passes.

6. **"Employees can't sign in with Google."** This is **expected today**, not a fault. Company Google login is part of the planned production rollout (see "Users and access"). Staff open the current app the way they do now until that rollout is completed.

---

## When to call the developer

Handle these yourself: pressing **Check readiness**, connecting/reconnecting/disconnecting Google with the approved account, running the Stage 4 verification checks, syncing the Client Directory, filing email through Review & copy, and adjusting your own and the office default settings.

Call the developer for anything that touches the hosting environment, Google's admin/cloud consoles, or the production launch — specifically:

- Adding or removing who can actually sign in, or changing who is an administrator (the real gate is the hosting-environment allowlist, not the In-development People & Access screen).
- Any change to keys, secrets, or configured addresses in the hosting environment — including setting the **company OpenAI key**, rotating the token-encryption key, or a "web address doesn't match" error.
- A **Disconnect** that fails, or a connection stuck on "reauthorization required" that reconnecting does not clear.
- Creating or changing Google OAuth clients, the Cloud project, or Admin console access controls.
- Turning on real project-folder provisioning, or anything about the **production cutover** and switching staff to Google login.
- Anything where a screen tells you to change a value "in the hosting environment" — that is never done inside the app.

When you do escalate, note only the safe details: the screen you were on, the plain error message, and the time. Never copy a key, secret, token, or the full text of a Google error into an email or ticket.

---

# Glossary

- **Allowlist** — a short list, kept in the hosting environment, of the email addresses (or a company domain) that are permitted to open the app. A second allowlist marks who is an administrator. If your address is not on it, you cannot sign in.
- **Blueprint** — the app's fixed plan for how the Shared Drive should be built: the exact folder tree and the standard spreadsheets. Because the layout is fixed, filed emails and documents always land in the right place, and you never have to build folders by hand.
- **Development build** — the early, real-but-not-final copy of the app your team can open today (private Sites development version 40). It works, but it is for practice and verification, not the finished production system.
- **Hosting environment** — the private settings behind the app where secrets and keys live (the company OpenAI key, the allowlists, webhook addresses). These are never shown or changed inside the app; only the developer touches them.
- **KPI** — a "key performance indicator," meaning one of the flooring performance numbers on the Reports page (win rate, backlog, callback rate, and so on).
- **Mirror** — a one-way copy. The Client Directory & Project Register spreadsheet mirrors your app data: the app is always the source of truth, the spreadsheet is a read-and-filter copy, and edits in the spreadsheet do not flow back into the app.
- **PWA / "installing" the app** — installing the app puts its own icon on your computer or phone so it opens full-screen like a normal app instead of in a browser tab. Nothing comes from an app store.
- **Shared Drive** — a Google Drive that belongs to the company rather than to one person, so files stay with the business even if staff change. The app uses one company Shared Drive named **FCI Operations**. It is different from a personal "My Drive" folder.
- **Simulation (simulation mode)** — the safe practice mode the app runs in by default. Gmail, Calendar, Drive, and Sheets actions use local sample data, and nothing ever reaches a real Google account. You can learn every screen without touching a client's real email or calendar. Screenshots in this guide are simulation captures.
- **Tenant** — your company's own space inside Google Workspace (your verified domain and the accounts under it). "Prepare the tenant" is the one-time Google-console groundwork before the app can connect.
- **Webhook** — a private address that lets one system post a message to another. Google Chat notification addresses are webhooks; they are secrets kept in the hosting environment and never shown in the app.

---

# Screenshot index

Consolidated list of every screenshot placeholder, with whether an existing capture can serve or a fresh one is needed. Existing captures are the July-22 baseline set (`docs/design-baseline/2026-07-22/`, at `-1280.png` and `-390.png` widths) and the July-23 review set (`docs/design-evidence/2026-07-23/`, mostly shell/topbar redesign frames).

| # | Where | What to show | Existing capture? |
| - | ----- | ------------ | ----------------- |
| 1 | Part 1 · Install | Chrome address-bar install prompt on desktop, and the Safari Share sheet "Add to Home Screen" on a phone | **Needs fresh.** No baseline shows browser install chrome; capture on a real device/browser. |
| 2 | Part 1 · Leads | Leads page with a lead open in its side drawer, highlighting **Advance stage** and the stage chips | Partial: `leads-1280.png` / `leads-390.png` show the page. **Needs fresh** for the drawer-open + Advance highlight. |
| 3 | Part 1 · Projects | Project drawer Overview tab: value / square-feet / installation-date stats and the **Installation & follow-up** buttons | Partial: `projects-1280.png` shows the list. **Needs fresh** for the drawer-open Overview tab. |
| 4 | Part 1 · Inbox | Gmail project inbox: a message with its suggested-project chip, **Review & copy** and **Draft reply** buttons, and the mailbox-bucket selector | **Needs fresh.** AI-10 d+e changed the bucket selector copy and made **Needs review** an app-side queue, so `inbox-1280.png` / `inbox-390.png` no longer match. |
| 5 | Part 2 · Settings nav | Settings left navigation: the "For you" group with My settings, and the "Workspace & company setup" group listing the eight company sections | Partial: `settings-1280.png` shows Settings. **Needs fresh** if it does not show the admin nav with all sections. |
| 6 | Part 2 · Client Directory | Client Directory & Project Register panel: the two mirror cards with last-synced times and the **Sync now** button | **Needs fresh.** No baseline of this sub-panel. |
| 7 | Part 2 · Workflow & notifications + AI assistant | Reminder-hour fields, the office notification email, and Google Chat routing in Workflow; provider/key/model state, feature switches, and the data-at-rest disclosure in the dedicated AI assistant section | **Needs fresh.** No baseline of either sub-panel. |
| 8 | Part 2 · Data & security | The four safeguards listed with their icons | **Needs fresh.** No baseline of this sub-panel. |
| 9 | Part 2 · Google Workspace banner | Status banner reading "Simulation ready" with the SIMULATION tag and "Stage 1 of 4", above the four collapsible stage cards | **Needs fresh.** No baseline of the Google Workspace panel. |
| 10 | Part 2 · Stage 2 Connect | Stage 2 expanded: the "Company account authorization" card with **Connect Google Workspace** and the admin **Connection health** expander | **Needs fresh.** |
| 11 | Part 2 · Stage 4 Verify | Stage 4: Gmail, Calendar, and Sheets verification rows with their action buttons and VERIFIED / READY TO VERIFY states | **Needs fresh.** |
| 12 | Part 2 · Filing review | The "File to one project" review window: project selector, destination folders, attachment list, and the "Nothing has been copied yet" confirmation | **Needs fresh.** |

**Summary:** captures 4 (and possibly 5) can be reused from the July-22 baseline; captures 2, 3, and 5 have a matching page shot but need a fresh drawer/panel-open frame; captures 1, 6, 7, 8, 9, 10, 11, and 12 need fresh simulation captures. The July-23 review set (DES-02 / DES-03 shell and topbar frames) does not cover any Settings or record-drawer content, so it cannot substitute for the fresh captures above.
