# FCI Operations — Guide for Everyday Users and Administrators

## Who this is for

This guide is for two kinds of reader, and it is split so you only need your half:

- **Part 1 — Using the app** is for everyone in the office and in the field. It covers signing in, moving around, and the day-to-day pages: Leads, Projects, Clients, Meetings, and the Inbox. No admin knowledge is needed.
- **Part 2 — Administering the app** is for the owner or office administrator who sets FCI Operations up and keeps it running. You do not need to be technical; where a step truly needs a developer, the guide says so and points you to "When to call the developer."

A short **Glossary** at the end defines the few special terms this guide uses (Shared Drive, blueprint, simulation, and others). Words in the glossary are written in plain language the first time they appear.

> **How current this guide is.** Describes the app as built in source on 2026-07-23; the installed company version may trail it. The copy your team can open right now is an early development build (private Sites development version 40). Everything newer than that build exists in the source code but has not been switched on yet. Screenshots are simulation captures (see the Glossary for what "simulation" means).

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
- **AI Assistant** — ask questions about one selected project's saved records.
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

**What Advance does.** Open a lead and use **Advance stage** (or the Advance action in the list) to push it to the next stage in the order above — New inquiry to Site visit, Site visit to Proposal, and so on. It only moves one step at a time, and only while the lead is still active and not already at the final stage. If you advance by mistake, an **Undo** button appears in the confirmation message. Advancing does not skip stages and does not mark a lead won or lost — those outcomes are set elsewhere as the deal closes.

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
- **Other**

Phone calls are captured the same way — add a meeting and pick the closest type (there is no separate "phone call" choice in the meeting-type menu). Record who was on the call in the **Attendees** box, one name or email per line.

**The Otter workflow.** The recommended way to capture a meeting is: copy the private Otter conversation link, paste in the **Summary** and **Action items**, and add the exported **Transcript** when you need the full searchable detail later. Paste the link into the **Otter conversation link** field. Note: the app only stores the link as a reference — it does not change who can see the recording in Otter, so keep the Otter link restricted to approved people.

**Action items.** Enter one follow-up per line in the **Action items** box. They are saved with the meeting and shown as a checklist, so decisions and next steps stay attached to the project.

---

### The Inbox

The Inbox is the **Gmail project inbox** — where you review emails and file the right ones into the right project. It is organized into mailbox buckets:

- **Inbox** — the regular company mailbox.
- **FCI/Intake** — messages waiting to be routed.
- **FCI/Needs Review** — messages a rule flagged for you to check.
- **FCI/Filed** — messages already copied into a project.

**Filing is review-first — nothing happens automatically.** Rules can *suggest* a destination, but you always choose the exact project and approve every copy yourself. To file an email, use **Review & copy**, pick the exact project, review the preview (nothing is copied at the preview step), then confirm. Only then is the email and its attachments copied into that project's Drive folder. Your Inbox is never emptied or archived — the original email stays put; filing adds a copy.

**Reply drafts are never sent for you.** Use **Draft reply** to write a response. Saving it stores an **unsent draft** in Gmail (or a local draft in simulation mode). Actually sending it is always a separate, deliberate action you take yourself.

> [SCREENSHOT 4 — see Screenshot index]

---

### My settings and page layouts

Open **Settings → My settings** to manage the preferences tied to your own signed-in account. These are yours alone and are separate from company setup. You can set:

- **My display timezone** — America/New_York, America/Chicago, America/Denver, or America/Los_Angeles. This drives the Overview greeting and the times you see.
- **Default reply signature** — added to the bottom of new Gmail reply drafts.
- **My notification preferences** — checkboxes saved for a future notification feature. These are marked **Planned**, so changing them does not change any alerts yet.

Click **Save my settings** to keep your changes.

If you are an office user rather than an administrator, **My settings** also shows a read-only **AI assistant** card. It displays the provider, whether the company API key is **Configured** or **Missing**, the model name, and whether each assistant feature is On or Off. It never displays the key itself. Administrators manage those company-wide switches in **Settings → Workflow & notifications**.

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
- **Workspace & company setup** — the company-wide configuration: the Google connection, calendars, the email filing rules, the client directory mirror, office defaults, security, and the launch checklist. Only administrators see and change these.

Almost everything on the company side is either **working today** or clearly labeled as **planned** (saved now, switched on later). The app never pretends a planned feature is live. When you see a small badge — *Working*, *In development*, *Setup required*, or *Planned* — take it at face value.

> [SCREENSHOT 5 — see Screenshot index]

---

## Panel by panel

There are eight sections in the left navigation. Here is what each one is for.

### 1. My settings *(everyone — this is the "For you" section)*

Your personal defaults, tied to your own login. Two settings here are **working now**:

- **My display timezone** — used for your Overview greeting and the times you see.
- **Default reply signature** — added to the bottom of new Gmail reply drafts you create.

Below those is **My notification preferences**. Those checkboxes are **saved but planned** — they are stored for a future personal-alert feature. Ticking them does not change any alert today, because notifications currently run at the company level only. That is the honest state, and the panel says so.

Office users also see the company **AI assistant** card here in a read-only form. It shows only whether the key is **Configured** or **Missing**, the model name, and the four feature states, but no control for changing them. Administrators use the company sections below for organization-wide settings.

*My settings is the only Settings section a non-administrator sees.*

### 2. Google Workspace

The heart of company setup: connecting the one company Google account and creating the Shared Drive, folders, spreadsheets, and calendars the app uses. This is a four-stage flow and it has its own full walkthrough in the next section, "Connecting and verifying Google in plain words."

### 3. Calendar & appointments

The plan for the company's two shared calendars: one named **FCI • Client Appointments** (site visits, measurements, client meetings) and one named **FCI • Field Schedule** (crew and job assignments). You choose whether to create two new shared calendars or point at existing ones, set the timezone, and set reminder hours.

Be aware: the reminder-hours and calendar-setup fields here are **saved defaults for automation that is still being switched on**. Saving them does not yet send reminders. The panel is honest that FCI Operations stays authoritative — if someone later edits an app-created Google event, it gets flagged for review rather than silently overwritten.

### 4. Inbox & file rules

Where you review how incoming email is matched to projects and filed. The unbreakable rule across the whole app is **review-first**: no email is ever archived, labeled, or copied into a project without you selecting the exact project and confirming. Rules here help *suggest* a match; a person always approves the action.

### 5. Client Directory

The **Client Directory & Project Register** — a one-way Google Sheets mirror of your clients and projects. The app is always the source of truth; the spreadsheet is a read-and-filter copy that updates after app changes and when you press **Sync now**.

- **Client Directory** tab mirrors client code, contacts, project count, folder link, status, and last update.
- **Project Register** tab is rebuilt from your project records (client, status, site, value, manager, Drive link).

One column is deliberately yours to edit: **Account Notes**. Everything else on the generated Project Register will be overwritten on the next sync, so do not hand-edit it. Spreadsheet edits do not write back into the app.

> [SCREENSHOT 6 — see Screenshot index]

### 6. Workflow & notifications

Simple office defaults — client and crew reminder hours, and an office notification email — plus two things worth knowing:

- **Google Chat notification routing.** You can review which four event types are allowed to notify which approved Google Chat space, and switch each on individually. It is off by default. Webhook addresses are secrets that live in the hosting environment and never appear in the app or the browser.
- **The AI assistant card.** Administrators see the provider (**OpenAI**), the company API-key state (**Configured** or **Missing**), and the configured model name — never the key value. Four switches control **Organization-wide answers**, **Inbox filing suggestions**, **Reply drafting**, and **Task extraction from meetings**. They default to on when the key is Configured. Organization-wide answers are marked **In development** because the server gate is wired but the current Assistant screen still asks for one selected project; the other three switches are visibly **Planned** until their later AI consumers ship. When the key is Missing, the switches are unavailable and the card says: “Add OPENAI_API_KEY to the hosting environment to enable AI features. Everything else keeps working without it.” See "The AI assistant setup" below.

> [SCREENSHOT 7 — see Screenshot index]

### 7. Data & security

A plain-language summary of the safeguards already in place: review-first email filing, one administrator-approved Workspace connection (consumer Gmail accounts are rejected in live mode), isolated local simulation that never contacts Google, and the installable web app. It also includes phone-install guidance. There is nothing to configure here — it is a reassurance-and-status page.

> [SCREENSHOT 8 — see Screenshot index]

### 8. Testing & launch

The **Test & launch checklist** — the ordered list you work through to prove the development copy behaves before production is opened to staff: clients and projects, meetings, inbox filing, calendar, the AI assistant, and production readiness. Use it as your pre-launch confidence check. It links straight to the Google Workspace setup.

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

Press **Connect Google Workspace**, sign in as the **single approved company account**, and approve the requested permissions. That account must be the same address the app uses to read the intake mailbox — the app is deliberately built so it can only ever use one approved account, never a personal `@gmail.com`. After you approve, the app returns to this page and refreshes readiness automatically.

If you are in simulation, this stage instead offers **Reset simulation data**, which restores the safe sample Gmail, Calendar, Drive, and Sheets data.

Two buttons you will meet here later:
- **Reconnect Google Workspace** — appears if Google ever needs you to re-approve permissions.
- **Disconnect Workspace** — safely removes the saved connection and asks Google to revoke access.

Administrators also get a small **Connection health** expander showing the connected account and, per service, whether it is *Enabled* in the app and *Granted* by Google. Note the honest caveat the app itself prints: this reflects the saved consent, not a live health check.

> [SCREENSHOT 10 — see Screenshot index]

### Stage 3 — "Define & create your workspace"
*On-screen subtitle: "Decide what exists, then create it — in order."*

Here you adopt the manually created **FCI Operations** Shared Drive, let the app verify its sharing restrictions, create the standard folder tree, and ensure the blueprint spreadsheets — all from buttons in the Resources area, in order. You do **not** hand-build the project folders; the app creates them to a fixed blueprint so filing always lands in the right place. Owner-named folders can be renamed later from the same area; system filing folders stay locked on purpose.

### Stage 4 — "Verify & maintain"
*On-screen subtitle: "Prove each service works, then ongoing upkeep."*

This stage proves each service actually works, then stays available as your ongoing toolbox. It has three **first-run checks**, each of which is completely safe:

- **Gmail — labels & test email.** *Prepare FCI labels* creates the three FCI labels; *View inbox* lists real messages; *Send Workspace test* (or *Add sample email* in simulation) sends one test email **only to your own configured mailbox**. Nothing is ever sent to a client from here.
- **Calendar — appointments & test hold.** *View upcoming events* reads a seven-day window; *Create test hold* makes one private 30-minute hold with no guests and no notifications.
- **Sheets — mirror sync.** *Sync now* runs one sync of the Client Directory and Project Register and reports exactly what changed.

Each row reads **READY TO VERIFY**, then **VERIFIED** once it passes. The stage shows **READY** when all three are verified.

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
- **Drift check** — labeled **PLANNED** (packet SET-18). There is no reconcile action yet; it is shown so you know it is coming.

**Essentially never (leave it alone):**
- The system filing folder names — they are locked because filing depends on them.
- The generated spreadsheet columns — every **Project Register** column is cleared and rebuilt on each sync, so never edit that tab by hand. The one column that IS yours to edit lives on the **Client Directory** tab: **Account Notes** (column I), which the sync deliberately preserves.
- Anything in the hosting environment (keys, secrets, addresses). Those are developer territory.

---

## Users and access

**What actually controls sign-in today (development build).** App sign-in uses **Sign in with ChatGPT**. The app then checks an allowlist that lives in the hosting environment: only listed office emails (or a listed company domain) can open the app, and a separate short list marks who is an administrator. Anyone not on the list sees **"Access not authorized."** This allowlist is the real gate, and only the developer can change it — so today, adding or removing who can actually sign in is still a request to the developer.

**The in-app People & Access screen (In development).** There is an admin-only **People & Access** screen in the app. Administrators reach it from a **People & Access** link in the navigation (it carries an *In development* badge). It lets an administrator invite people and assign one of three roles — **Administrator**, **Office Operations**, or **Project Manager** — and disable or sign out a person. Because it is *In development*, treat its records as test data: this screen does **not yet** govern who can actually sign in, and it does not replace the hosting-environment allowlist described above. Use it to try the workflow, not to grant real access yet.

Keep this straight in your head: the **app login** (who may open the app) is deliberately separate from the **Google data connection** (the one company account that supplies Gmail, Calendar, Drive, and Sheets). Connecting Google does **not** change how people log in.

**How it will work at live login (planned).** The production plan replaces ChatGPT sign-in with **Sign in with your company Google account** and makes the **Administrator / Office Operations / Project Manager** roles — the same ones the People & Access screen already collects — enforced by the server, with project-level permissions so you can decide who sees which jobs. That server enforcement needs the production environment and is a developer-and-owner rollout, not an in-app toggle. Until it is switched on, the People & Access screen stays in test-data mode and adding or removing a real user is a request to the developer.

---

## The AI assistant setup

**Do I need a ChatGPT account? No.** Nobody on your team ever links a personal ChatGPT or OpenAI account, and nobody logs into OpenAI. The assistant runs on **one company OpenAI API key** that the administrator (in practice, the developer) sets once in the hosting environment's settings — not in the app, not in the code, not in email. Every user simply shares that one company key behind the scenes.

Because it is a secret, the app never shows the key itself. The **AI assistant** Settings card shows only whether it is **Configured** or **Missing**, together with **OpenAI** as the provider and the model name. Administrators find the editable card in **Settings → Workflow & notifications**; office users see the same information and feature states read-only in **My settings**. When the key is Missing, the feature controls are unavailable and the app says plainly to add the company key to the hosting environment — it never fakes a ready state.

The four company-wide feature switches are **Organization-wide answers**, **Inbox filing suggestions**, **Reply drafting**, and **Task extraction from meetings**. They are on by default when the key is Configured. The organization-wide server gate works now, but its row stays **In development** until the Assistant page exposes the broader Ask flow. The later Inbox, drafting, and task-extraction packets consume their saved switches, so those three rows stay marked **Planned**; storing a switch does not make an unfinished feature operational.

On the **AI Assistant** page, **What you can ask** starts collapsed so it does not crowd the question workspace. Expand it for five examples:

- **Which projects have open callbacks?**
- **What did we decide in the last Hendricks meeting?**
- **What tasks are overdue?**
- **Show installation dates for active commercial projects.**
- **Find the change order document for project 2026-014.**

The help also explains that answers come only from saved records and Drive files, every answer cites its sources, and the assistant never sends anything. Email bodies become searchable only after they are filed as Drive copies; phone calls are saved as meetings.

What the assistant does and does not do, so you can set expectations:
- It is **read-only**. The current screen answers about one selected project, and every grounded answer shows its sources for you to open and check. The broader organization-wide route is wired behind its saved feature switch, but the page does not expose that Ask flow yet.
- It will tell you when evidence is missing rather than guess.
- It never sends email, changes records, or takes any action on its own.

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
| 4 | Part 1 · Inbox | Gmail project inbox: a message with its suggested-project chip, **Review & copy** and **Draft reply** buttons, and the mailbox-bucket selector | `inbox-1280.png` / `inbox-390.png` can likely serve; confirm the suggested-project chip is visible, else **fresh**. |
| 5 | Part 2 · Settings nav | Settings left navigation: the "For you" group with My settings, and the "Workspace & company setup" group listing the seven company sections | Partial: `settings-1280.png` shows Settings. **Needs fresh** if it does not show the admin nav with all sections. |
| 6 | Part 2 · Client Directory | Client Directory & Project Register panel: the two mirror cards with last-synced times and the **Sync now** button | **Needs fresh.** No baseline of this sub-panel. |
| 7 | Part 2 · Workflow & notifications | Reminder-hour fields, the office notification email, the AI assistant status and feature switches, and the Google Chat notification-routing card | **Needs fresh.** No baseline of this sub-panel. |
| 8 | Part 2 · Data & security | The four safeguards listed with their icons | **Needs fresh.** No baseline of this sub-panel. |
| 9 | Part 2 · Google Workspace banner | Status banner reading "Simulation ready" with the SIMULATION tag and "Stage 1 of 4", above the four collapsible stage cards | **Needs fresh.** No baseline of the Google Workspace panel. |
| 10 | Part 2 · Stage 2 Connect | Stage 2 expanded: the "Company account authorization" card with **Connect Google Workspace** and the admin **Connection health** expander | **Needs fresh.** |
| 11 | Part 2 · Stage 4 Verify | Stage 4: Gmail, Calendar, and Sheets verification rows with their action buttons and VERIFIED / READY TO VERIFY states | **Needs fresh.** |
| 12 | Part 2 · Filing review | The "File to one project" review window: project selector, destination folders, attachment list, and the "Nothing has been copied yet" confirmation | **Needs fresh.** |

**Summary:** captures 4 (and possibly 5) can be reused from the July-22 baseline; captures 2, 3, and 5 have a matching page shot but need a fresh drawer/panel-open frame; captures 1, 6, 7, 8, 9, 10, 11, and 12 need fresh simulation captures. The July-23 review set (DES-02 / DES-03 shell and topbar frames) does not cover any Settings or record-drawer content, so it cannot substitute for the fresh captures above.
