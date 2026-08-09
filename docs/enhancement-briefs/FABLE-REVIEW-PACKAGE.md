# Fable review package — FCI Operations, August 3, 2026

**From:** Claude (outgoing orchestrator)
**For:** Fable — **incoming orchestrator**

**Role handover.** From here: **Fable orchestrates** (sequencing, dispatch, packet
authorship, and the dispatch-law bookkeeping); **Codex writes the code**; **Fable reviews
Codex’s code**; **Jason merges and deploys.** This document is the state of the world at
handover — not a set of instructions to follow, and not a plan you are bound by. If your
sequencing differs from mine, yours wins; you own it now.
**Baseline:** `origin/main` @ `301947d`; live site deployed at `590940d`
**What this is:** everything produced or changed in one working session, consolidated so you
can review it as a whole rather than as ten fragments.

**How to read it:** treat every finding here as UNVERIFIED. I made three errors today that I
caught (§0) and there are probably others I did not. I am specifically asking you to play
devil’s advocate against my conclusions rather than build on them — particularly the
recommendations, which are the least evidenced part of this document. Where I say “verified”
I mean I read the source; where I say “recommend” I mean I reasoned about it, and that is
exactly where I would expect to be wrong.

---

## 0. Read this first — three corrections I made to my own work

You are reviewing a session in which I got things wrong and caught them. These matter more
than the successes because they show where this repo's evidence is untrustworthy.

**1. A design review I reported was measured against dead code.** I ran a layout scan
against a dev checkout that was **303 commits behind main** and reported five defects. Three
had already been fixed by **NFIX-06 (PR #267, July 31)**, which ships 45 lines of CSS plus a
dedicated e2e spec. I re-ran against real `main` and against the live site; the honest
result is in §3.

**2. A stale status line hid that fix.** NFIX-06 still read `In progress` although its
branch merged July 31, so the packet looked unstarted and nothing contradicted my false
finding. **My earlier sweep only checked one of the five guarded ledgers** — NFIX packets
live in `docs/ledger/nightly-review-2026-07-findings.md`. Fixed in **PR #282**; all five ledgers
are now verified clean.

**3. I called People & Access "broken in production." It is not.** It renders an honest
development-boundary message and behaves exactly as BE-09 documents. I built that claim on
a network 404 instead of looking at the page.

**The pattern worth carrying into your review:** in this repo, a finding is not real until
it has been checked against *current* `main` or the live site. Stale packets, stale
checkouts and stale status lines have each produced a false conclusion in a single day.

---

## 1. Owner decisions recorded today

These are settled. Do not re-open them; plan against them.

| # | Decision | Consequence |
|---|---|---|
| 1 | **All mailboxes will be shared company addresses.** No personal staff mailboxes attached. | Removes the per-user identity blocker entirely — WS-20 becomes fully buildable. Removes the employee-monitoring/policy/legal track. |
| 2 | **Staff may work the shared inboxes.** | All six Gmail routes are Administrator-only today; opening them is a route-guard change, not a UI change. |
| 3 | **Access level is view + file.** Sending and replying stay Administrator-only. | Filing is leased, idempotent, audited and never deletes — safe to delegate. Route-by-route split is in the multi-mailbox plan. |
| 4 | **Per-person inbox access is assigned in the Settings UI.** | Must NOT be built on the existing capability constants — see §5. |
| 5 | **Owner wants configuration defined in the front end "as much as possible."** | **Audited and decided — see §6.** Env keeps the allowlists; the UI gets the selection. |

---

## 2. What shipped today

Merged, in this order, verified to compose cleanly with ten guard suites green on the
merged result:

| PR | Packet | Note |
|---|---|---|
| #280 | GI-01a | Cloud Run Forms boundary + dismissal coverage. Review clean. |
| #279 | SET-05 | Calendar authority. **Five review findings, three fixed on-branch.** |
| #277 | AI-11(b) | Dedicated AI assistant Settings section. Review clean + one fix from me. |
| #278 | — | Staging rehearsal record, **WS-19** and **WS-20** filed. |
| #281 | — | Post-merge ledger flip; five stale `In progress` lines corrected. |
| #282 | — | NFIX-06 flip (see §0). |
| #283 | — | **AI-12** and **EDIT-09** filed; FloorOpsApp queue claim list repaired. |

**The SET-05 finding worth your attention:** the packet's goal is *"saved calendar IDs
become runtime-authoritative"*, but its verify action wrote a `workspace_resources` row that
**outranks** the saved value — the opposite of the packet's purpose — and the panel still
labelled that state "In use (saved setting)". The resolver maps both states to
`source: "app"`, so the UI was structurally incapable of telling the truth. Fixed by
returning the resolved `externalId` and naming the calendar actually in force.

---

## 3. The honest design review

Run against the **live public site** through an authenticated same-origin iframe — 51
page-views, 17 routes, three widths, zero infrastructure failures. This method worked first
time after the local headless approach failed three times; it is the recommended method
going forward.

**Three defects, and everything else is clean:**

| Where | What | Widths |
|---|---|---|
| Settings → Google Workspace | Rename/Open overlap the Operations health controls (212–853px²) | **all three** |
| Settings → Client Directory | **"Check for new form responses" clipped 49px** | 834 |
| Settings → Calendar | "Google connection" clipped 15px | 834 |

Overview, Leads, Clients, Projects, Schedule, Inbox, Assistant, Reports, My settings, Inbox
rules, Workflow, Data & security and Testing & launch are **clean at 390, 834 and 1280**.

**Interaction pass:** 36 clicks across five routes — no click-stealing overlaps, no broken
dialogs, no stranded buttons, no console errors.

---

## 4. Defects found in live use

**AI-12 — a failed inbox analysis is invisible, and an outage reads as "You're caught up."**
Observed by the owner with a real test email. A `failed` row is never listed (the queue
reads only `needs-review`), stops being retryable after 3 attempts, and therefore stops
counting as backlog — so the sweep reports caught-up. **The affected email is permanently
unrecoverable; restoring the provider does not bring it back.** Filed in PR #283.

**EDIT-09 — the contact editor re-renders mid-edit and lands a value in the wrong field.**
CI stored `primary_contact_name` as `"Updated Contact555-0196"` while the phone kept its old
value. Surfaced as a flaky spec, but a `fill()` can only land in an already-filled input if
the editor re-rendered while one held focus — **a real user typing at speed hits the same
window.** The packet requires removing the re-render rather than hardening the spec.

**iPhone info buttons do not display when pressed.** Owner-reported. I verified the touch
handling is correct and the tooltip is positioned on-screen and unclipped at 390px, but
**could not confirm whether it paints** — off-screen iframes and background tabs do not
advance CSS transitions, so my measurement is unreliable. Hypothesis: the tooltip
transitions `visibility`, which is fragile and most likely to stick on iOS Safari. **Needs
a real device.** Not yet filed.

---

## 5. The trap that recurs — do not build permissions on the capability system

`canCreate` (`app/application/creation-authorization.ts:32-34`) checks a capability set that
every route **hard-codes before checking it**. It is always true by construction, and its
nine call sites enforce nothing on the running transport. The cause is identity:
`requireOfficeUser` returns only `{ email, isAdmin }`.

**This has now blocked or distorted three separate features** (EDIT-01, per-user Gmail, and
now inbox access control). Any plan that says "check the user's capability" is planning
against something that does not work.

**What does work:** the signed-in **email**, and `isAdmin`. The recommended inbox access
design keys on exactly that — a per-mailbox email allowlist, enforced server-side in the
Gmail routes, described honestly in the guide as an access list rather than an identity
system. Proportionate because the owner has stated these inboxes hold nothing sensitive.

---

## 6. Configuration in the front end — AUDITED AND DECIDED

A six-agent audit traced every configuration value to where it is read and what it gates.
**Its answer corrects the recommendation I gave earlier in this session — see "where I was
wrong" below.**

### The answer in three lines

**MOVE** (extend the shipped SET-13 resolver, no new guard): the five Google resource IDs
(shared drive, client-directory sheet, lead-form response sheet, and both calendar IDs),
`GOOGLE_WORKSPACE_DRIVE_PROVISIONING_ENABLED`, `GOOGLE_CHAT_NOTIFICATIONS_ENABLED`,
`OPENAI_MODEL`.

**MOVE WITH GUARD:** `GOOGLE_WORKSPACE_INTAKE_MAILBOX` (the UI *selects from* an env-held
allowlist, it does not *define* it), `GOOGLE_WORKSPACE_ENABLED_SERVICES`,
`FCI_OFFICE_EMAILS` (additive union with env, domain-bounded, never confers admin).

**KEEP IN ENV, permanently:** `GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS`,
`GOOGLE_WORKSPACE_ALLOWED_DOMAINS`, `FCI_ADMIN_EMAILS`, `FCI_OFFICE_DOMAINS`,
`GOOGLE_INTEGRATION_MODE`, the OAuth client ID and redirect URI, every secret, every Chat
webhook URL, the rate limits, the acknowledgments, and the build stamps.

### The fact that settles the mailbox question

**Every Gmail call goes to `users/me`** — `app/lib/google-gmail.ts:9`, one use site at
`:661`. There is no delegation, no impersonation, no `users/{address}` path anywhere.

So **`INTAKE_MAILBOX` is not a read target.** The mailbox the app reads *is* whichever
account holds the OAuth token. The env var only (a) declares which account the operator
intends to connect, (b) supplies a default recipient, and (c) drives the "does the connected
account match what you declared" indicator.

**Therefore the one-account invariant is true, not arbitrary — and it survives.** A design
that lets the panel claim it reads `info@` while `users/me` reads something else is a lie
surface, and it would destroy the only honest signal the panel has.

### Where I was wrong

Earlier in this session I recommended **Option 3 — remove `AUTHORIZED_ACCOUNTS` entirely,
on the grounds that the OAuth flow is itself the authorization.** That is wrong, for a
reason I had not traced: `googleAccountIsAllowed` (`app/lib/google-oauth.ts:673-678`) uses
that list to decide whether a *stored connection is usable at all*, and both OAuth callback
sites honour the resolver-aware config. **If a compromised administrator session could add
an identity to the allowlist and then connect as it, the app would validate the attacker's
identity against a list the attacker had just written.**

The audit's answer is better than any of my three options: **env keeps the allowlist, the UI
gets the selection.** The owner lists `info@`, `sales@`, `service@` in env once at deploy
time, and switches which is in force from Settings with no redeploy. The request is granted;
the boundary stays where he cannot accidentally widen it.

Concretely, replace the singleton clause at `google-oauth.ts:422` with **membership**: the
effective intake mailbox must be *a member of* `AUTHORIZED_ACCOUNTS` and its domain must be
in `ALLOWED_DOMAINS`. Do not preserve the singleton form — if exactly one address is allowed,
a UI field that can only be set to that address is a typo-catcher, not a control.

### Packet 0 — the prerequisite nobody would guess

**Before any new UI control ships**, migrate the 16 raw `getGoogleRuntimeConfig()` call sites
to the effective-config accessors. Four are harmless (`connectionKey` only); the rest read
resolved values or readiness — most importantly
`app/api/v1/integrations/google/connection/route.ts:14,35`, the route the Settings panel's
own status column reads.

**Never ship a UI control for a value whose consumer still reads the raw config** — the panel
would display the saved value while the app obeys env, which is worse than no control.

### Migration order

1. Lead-form response sheet (the only genuinely unstarted resource)
2. Fix the dead `clientDirectorySheetId` saved tier — **the adapters never write that column**
3. Show the calendar ID inputs regardless of `calendarSetupMode` — today an owner on the
   default mode never sees a field that already works
4. `OPENAI_MODEL` behind a closed allowlist; collapse the two independent `"gpt-5.4"` defaults
5. The two boolean flags
6. **The mailbox packet** (requires Packet 0)
7. `ENABLED_SERVICES` — after the mailbox, because the mailbox entries are conditional on it
8. `FCI_OFFICE_EMAILS` roster — last, and separately reviewed

### The lockout, and four other ordering traps

- **The mailbox entries must block `oauthReady` but NOT `connectReady`.** `connectReady`
  gates the authorize route. If the mailbox blocks it, the admin cannot start OAuth, the
  panel cannot self-heal, and the only remaining fix is the hosting console. **This one line
  is the difference between a working migration and a locked-out live app.**
- **The gate must be re-derived before any mailbox can be saved.** The pairing entry's
  `envVar` is a composite display string, and the filter only clears the four resource specs
  — so today a saved mailbox *cannot* be cleared, leaving `oauthReady` false forever.
- **Never remove a value from env until the panel shows its source as app/saved.** Resolution
  is app > env > none; removing env first takes the value to absent, which drops
  `oauthReady` on a live app.
- **`requireOfficeUser` must never fail-closed on a database error.** If the roster ships, a
  D1 fault must degrade to env-only — never to empty, never to open. Twenty people lose a
  live app otherwise.
- **The Cherry Hill cutover trap, which is not obvious and will bite.** App-saved values
  outrank env, and the registry is keyed by `connectionKey` — the constant
  `"google-workspace"` in *both* tenants. **So changing env at the cutover will not take
  effect** while stale grass.wedding rows exist: the app keeps pointing at the old tenant's
  Drive, sheets and calendars while the environment says otherwise. Build the domain re-check
  at *resolve* time, not only at write time, so a stale saved mailbox surfaces as invalid at
  cutover instead of silently outliving its tenant. **This compounds WS-19 and should be
  planned with it.**

### The honest framing

For roughly a third of the list, the answer is **"shown in the front end, set in the
environment."** That is not a refusal — the panel already does exactly this, correctly, for
the AI key and the Chat spaces: it receives `configured: boolean` plus the env-var *name*,
never the value. That pattern is what makes it safe to grant the request everywhere else.

A Settings screen that can redirect the app at another tenant, or promote an account to
administrator, is worse than editing an environment variable — because editing an
environment variable requires reaching the hosting console and leaves a deployment record.

### One loose end for a separate packet

`broadScopeAcknowledged` is hard-coded `const broadScopeAcknowledged = true`
(`app/lib/google-oauth.ts:407`, returned at `:463`). It reads like a live acknowledgment gate
and can never be false — apparently a vestige of a removed env value. Do not model any new
control on it; delete it or restore it to a real gate.

---

## 7. The briefs to review

Five documents accompany this package. Each is verified against source with file:line
citations, and each ends with open questions for the owner.

1. **`plan-multi-mailbox-and-google-integration.md`** — mailbox architecture, best
   practices, the shared-vs-personal analysis, the access-control addendum, and the
   zero-code Google integration wins. **Most decided of the five.**
2. **`enhancement-grid-views-and-filtering.md`** — dense list/grid views with filtering.
   Contains the **iOS design conflict**: "grid view" and "match iOS" pull in opposite
   directions, and that must be resolved before anything is built.
3. **`enhancement-emails-update-records.md`** — inbound email updating existing records.
   The record-editing foundation is already complete and merged; the gap is narrow.
   **Contains a security prerequisite: `AI-R10`.**
4. **`enhancement-agent-write-actions.md`** — typed natural-language actions with a
   permission check and confirm-diff prompt. **Blocked on the §5 problem.**
5. **`enhancements-sync-buttons-nav-and-ios-bug.md`** — six UI items: auto-sync, button
   bulk, rearrangeable menu, collapsed-rail border, the brand mark, and the iPhone bug.

---

## 8. The remaining build — 39 open packets, and where they live

**Dispatch law:** a packet is open if and only if it has **no `**Status:**` line directly
under its heading. That is the only authority — prose lists of "unclaimed packets" have gone
stale repeatedly in this repo. All 39 below were enumerated mechanically against
`origin/main` @ `301947d`.

**A correction that matters for orchestration:** an earlier assessment I ran covered **28
packets by scanning only `docs/ledger/agent-plan-architecture-workspace-and-setup.md`.** The open
work is spread across **four** ledgers, and it missed eleven. Anything that surveys "what is
left" must read all four:

| Ledger | Open packets |
|---|---|
| `docs/ledger/agent-plan-architecture-workspace-and-setup.md` | AI, DES, GI, SET, WS (28) |
| `docs/ledger/full-review-2026-07-21-findings.md` | F-14…F-18, FIX-09/11/12/14/16/20 (11) |
| `docs/ledger/nightly-review-2026-07-findings.md` | NFIX — none open |
| `docs/ledger/full-review-2026-07-24-findings.md` | none open |

### Owner packets — not agent work (13)

`WS-01, WS-02, WS-05, WS-06, WS-07, WS-08, WS-09, WS-11, WS-14, WS-15, WS-16` are the
owner's own console clicks. **Important context:** WS-01…WS-08 have been rehearsed
end-to-end on the `grass.wedding` staging tenant (recorded in the Workstream B preamble),
so they are not "never started" — they are done once, on the wrong tenant. **WS-16 is the
highest value-per-effort item on any list here**: seven zero-code Google integration wins,
every box unchecked.

The one genuine gap: **WS-08's second half — Gmail filing — has never run outside
simulation.** Zero filing events on the live tenant, ever. It is the single thing this app
does that Gmail cannot.

### Agent packets by workstream (26)

- **WS (2):** WS-19 tenant cutover, WS-20 shared mailboxes. **Both filed today.** They share
  a central blocker (`connection_key` is a mode constant with a UNIQUE index) and must be
  built in that order or the same ~191 references get rewritten twice.
- **SET (8):** SET-07, 09, 12, 20, 21, 23, 26, 27.
- **GI (4):** GI-04, 05, 06, 07.
- **AI (1):** AI-11 — sub-scopes **(c)** label catalog editor and **(d)** activity view only;
  (a) and (b) are complete. **The packet deliberately carries no status line**; read its body,
  not the absent line.
- **DES (2):** DES-09 closure, DES-10 brand mark.
- **F / FIX (11):** F-14…F-18 and FIX-09/11/12/14/16/20 — mostly production-gated hardening
  and residual sweeps. **These were absent from my earlier assessment entirely.**

### What the earlier assessment concluded (28 of the 39)

Its verdicts are worth carrying forward, but **treat them as covering only the architecture
ledger**:

- **Fix first:** the FloorOpsApp queue claim list (done today, PR #283) → **AI-12** →
  scanner fixes → the three live layout defects → **SET-21** → **EDIT-09**.
- **SET-21 is more urgent than its packet suggests:** four Settings controls the owner can
  edit today are silently ignored by provisioning. The app is lying to him on a live tenant.
- **Build order:** WS-19 → AI-11(d) in parallel → **SET-23 + SET-26 merged into one packet**
  → GI-04 → SET-07 → AI-11(c).
- **Six packets have FALSE premises** and would have an agent rebuild shipped work:
  **SET-12 should be retired outright** (its session-revocation card would print a false
  claim — "Sign out everywhere" is already built); **DES-09's sub-items are delivered
  twice over**; SET-21's Why line, SET-23's wiring, GI-05's precedent and GI-07's stated
  foundation are all factually wrong against source.
- **GI-07 should not be scheduled at all** — its stated Cloud Run foundation does not exist.

### The scheduling constraint that dominates everything

**`app/FloorOpsApp.tsx` is a single-file queue slot — one packet at a time.** The claim list
was repaired today (PR #283) after five open packets were found needing it with none listed.
Current recommended claim order:

**AI-12 → GI-04 → GI-05 (if approved) → WS-20 (if approved) → DES-10 (variants a/b only).**

**Four of the owner's seven new requests also want that slot** — grid views, agent write
actions, rearrangeable menu, and presentation mode. **They serialise against the packets
above and against each other.** Sequencing them is the single most valuable orchestration
decision in this package.

Four packets *could* take the slot and must not — each should state its no-FloorOpsApp path
in its own PR: SET-23/26 (mount in `ProjectFilesPanel`), SET-07 (nav fetches its own state),
AI-11(c) (nest in `AiAssistantSettingsCard`), GI-06 (filter stays in its controller).

---

## 9. What I most want reviewed

1. **The §5 permission problem.** Three features now depend on authorization that does not
   exist. Is the email-allowlist answer right, or is it time to build durable identity?
2. **`AI-R10` as a write vector.** Today the project-number matcher has no sender-ownership
   check and the blast radius is a reply draft. Under brief 3 it becomes a way to steer an
   update at someone else's job. I believe it must be closed *as part of* that work.
3. **The queue-slot contention.** Four of the owner's six requests want
   `app/FloorOpsApp.tsx`. They serialise. Sequencing them is a planning problem, not an
   engineering one.
4. **The iOS-vs-grid conflict in brief 2.** My recommendation is a dense iOS-native list,
   not a spreadsheet. If you disagree, say so before the owner is asked to choose.
5. **Whether AI-11(d) really should precede (c).** An earlier assessment recommended
   inverting the packet's stated order. Worth a second opinion.
6. **The whole of §8, re-run across all four ledgers.** My assessment covered 28 of 39
   packets and I did not notice until assembling this document. The eleven F/FIX packets
   have never been assessed for staleness, and given six of the twenty-eight had false
   premises, assume some of the eleven do too.

---

## 10. What you are being asked to orchestrate

The owner's ask is *"review everything and work out the best way forward."* Concretely
that means reconciling three streams that currently compete:

1. **39 open packets**, of which 13 are the owner's own clicks and 26 are agent work — with
   six known-false premises and eleven never assessed.
2. **Seven new enhancement requests** from today (the five briefs), four of which want the
   same exclusive file.
3. **Three defects found in live use** (AI-12, EDIT-09, the iPhone tooltip), one of which
   silently loses customer email.

**My recommended frame, for you to accept or reject:** the owner has a working, deployed
system with real Google Workspace data in it. That changes the sort order from "finish the
build" to "stop it lying, then make it faster to use, then extend it." On that frame:

- **AI-12 outranks everything**, because it is the only open item where a real customer
  enquiry disappears with no trace.
- **SET-21 is second**, because editable-but-ignored settings undermine trust in every other
  setting.
- **WS-19 before any Cherry Hill work**, because the cost of not having it grows with every
  week of real data.
- **The enhancement briefs are genuinely valuable but none are urgent** — with the possible
  exception of the grid views, which is the owner's day-to-day friction rather than a
  feature request.

**The retirements matter as much as the build order.** SET-12 and GI-07 should come off the
list entirely, and DES-09 should be struck down to its residue. A plan that schedules work
already shipped is worse than a plan that schedules nothing.

---

## 11. Loose observations — noticed, not filed

None of these has a packet. Several probably deserve one; a few are deliberately left alone.
Judge them yourself rather than trusting my triage.

### Things that are wrong and unfiled

- **`broadScopeAcknowledged` is hard-coded `true`** (`app/lib/google-oauth.ts:407`, returned
  at `:463`). It reads like a live acknowledgment gate and can never be false. Either a
  vestige of a removed env value, or a gate someone disabled. **Nothing should be modelled
  on it until that is settled.**
- **`clientDirectorySheetId`'s saved tier is dead code.** The column exists (`db/schema.ts:187`),
  is read by both adapters, and is on the port — **and no adapter ever writes it.** The D1
  upsert hard-codes it NULL and omits it from `DO UPDATE SET`. So a "saved" value can never
  exist, and any UI built on it would silently do nothing.
- **The calendar ID inputs are hidden on the default setup mode**
  (`WorkspaceDefaultsPanel.tsx:254` gates on `calendarSetupMode`). An owner on the default
  `create-shared` mode never sees fields that already work. This is probably why the calendar
  IDs looked env-only.
- **`/api/v1/admin/access` 404s on every Settings page load.** Harmless — the page degrades
  correctly — but it is console noise on every load and it fooled me into filing a false
  finding earlier today. Worth a cheap guard.
- **The `edit06` contact-editor flake** is filed as EDIT-09, but the same re-render race may
  exist in the other record editors. Nobody has checked.

### Process and tooling problems, which I think matter more than they look

- **The status-line grammar has no legal form for owner-completed work.** Every "done" form
  requires a PR number. So an owner packet like WS-01 can *never* be marked complete — which
  is exactly why WS-01…WS-08 read as "never started" when they had all been rehearsed. I
  worked around it with a preamble paragraph. **The grammar should probably gain an owner
  form**, and that is a guard-test change, so it needs doing deliberately.
- **A test pinned a transient status line.** `doc06-deployment-runbook.test.mjs` asserted
  `In progress — codex/doc06-deployment-runbook` literally, so the only way to keep CI green
  after that branch merged was to leave a merged packet marked in-progress — **the test was
  preventing its own packet from ever completing.** Fixed today, but nothing stops the next
  packet doing the same. A lint or convention would.
- **There is no single view of open work.** Packets live across five guarded ledgers. I
  swept one and reported 28 open; the real number is 39. Any orchestration that starts from
  "what's left" needs to read all five, and there is no tooling that does.
- **The seeded dev server cannot survive a full scan.** It died three times today under
  sustained page loads, losing the tail of every run — which silently produces partial
  coverage that looks complete. **Scanning the deployed site through an authenticated
  same-origin iframe worked first time**, 51 page-views, zero failures. That should become
  the documented method.
- **The nightly scanner has two proven false-signal classes** — clipped-by-scrollable-ancestor
  counted as overlaps, and no auth-wall detection (it once reported a clean all-clear across
  102 page-views of a login page). Both fixed in my working copy, **neither committed**. This
  is NFIX-07 and I never filed it.

### Data hygiene on the live tenant

- **No existing record carries the test marker.** Clients are `Client 2`, `FMA`,
  `New Client ABC`; projects include `Test Project` and `New Proj`. The app's own banner asks
  for names beginning `FCI TEST — DO NOT USE`, and the Forms real-data gate will *block* on
  anything without it. Harmless today, confusing at the launch gate.
- **Gmail filing has never run on the live tenant.** Zero filing events, ever. It is the
  app's single genuine differentiator over Gmail and it is unproven in production.

### Open owner decisions nobody is tracking

- **Duplicate-on-edit in Forms intake.** The submission key hashes the content columns, so
  editing a submitted response queues it a second time. I mitigated it for the new form by
  setting `setAllowResponseEdits(false)`, but the underlying behaviour is unchanged and an
  admin editing the Sheet directly still triggers it.
- **DES-11(B) `aria-pressed`** reports the *requested* span while the card renders the
  *resolved* one. Deliberately not fixed — the obvious change breaks toggle semantics. Still
  open.
- **SET-05's two deferred residuals:** calendar adoption takes no setup lease and emits no
  audit event, and save/verify remounts the whole settings form. Both recorded in the packet
  body rather than dropped.

---

## 12. The operating rules you inherit

These are not suggestions — they are mechanically enforced, and breaking one turns CI red or
causes two agents to collide.

**Dispatch law.** A packet is available **if and only if it has no `**Status:**` line
directly under its heading.** Prose lists of "unclaimed packets" have gone stale repeatedly;
the status lines are the only authority. Packets claim themselves in their own PR.

**Status-line grammar** is enforced by `tests/task-tracking-docs.test.mjs` across **five**
ledgers. Only six forms are legal, and the failure message does not name them:
`Complete — PR #N( + PR #M)*` · `In review — PR #N` · ``In progress — `codex|claude/...` `` ·
`Blocked — .+` · `Resolved in PR #N` · `Superseded — absorbed into XX-NN`.
**There is no legal form for owner-completed work** — see §11.

**`app/FloorOpsApp.tsx` is a single-file queue slot.** One packet at a time, and the queue
appendix in the architecture ledger is the claim list. A packet touching that file must add
itself to the appendix **in the same PR**. I repaired that list today after finding five
open packets needing the slot with none listed — assume it drifts again.

**Golden hashes** at `tests/e2e/page-layouts.spec.ts:8-9` byte-pin the Overview and Reports
markup. Only two named packets may regenerate them. Nothing currently queued should.

**`npm test` does not run Playwright.** CI has three gates: Node 22 lint/build/test, a
Chromium e2e job over the `tests/e2e/` suite, and Terraform validation. An agent reporting
"tests pass" from `npm test` alone has not run the e2e suite.

**Documentation prose is CI-pinned.** 33 markdown files are read by the test suite, some at
line-wrap granularity. A reworded sentence can turn CI red — and conversely, a doc edit that
makes a pinned claim *untrue* is a defect even when CI is green. I hit both today.

**Merging is not deploying.** Everything merges source-only; Jason deploys on demand from
GitHub and records it in issue #258. Never write a commit SHA or a "what is live" claim into
a repo file.

**Codex's constraints, from working with it today:** its container runs Node 20 while the
repo requires ≥22, so **it cannot run `npm test` or Playwright** — its work is lint- and
unit-verified only, and CI is the first real check. It also occasionally leaves work
unpushed; confirm the branch is on origin before assuming anything exists.

**Review latency.** The Codex bot's PR review replies land 60–85 minutes after being
summoned, not 15–20. The working process is: review, fix on-branch, merge on green, then
sweep merged PRs for late replies and handle findings as follow-up PRs.

---

## 13. Architectural review — deliberately bounded

**The owner does not want a whole-app review.** It costs more than it returns at this stage,
and most of the app is fine. He wants you to escalate **only** when something is
architectural or would force significant rework later.

### The escalation test

Escalate if **any** of these is true. Otherwise note it in one line and move on.

- Fixing it later would touch **more than ~50 files**, or require a **data migration**, or
  force **every user to reconnect or re-authenticate**.
- **Building the next few packets on top of it makes it harder to change**, rather than
  neutral. (This is the one that matters most — it is how a cheap fix becomes an expensive
  one without anyone deciding.)
- It is a **boundary** — auth, tenancy, identity, or data partitioning — where being wrong
  is not recoverable by editing code later.

If it is a defect but bounded, it is a packet, not an architecture question. File it and
carry on.

### Do not sweep — these are the candidates already identified

Check these seven cheaply and tell the owner which genuinely warrant deeper work. If you
find an eighth, say so; but this list is where I would spend the budget.

1. **`connection_key` is a mode constant with a UNIQUE index.** The single highest-leverage
   item in the codebase. It blocks multi-mailbox *and* clean tenant switching, and it is why
   WS-19 and WS-20 must be built together. Rewriting it later touches ~191 references, four
   UNIQUE indexes, and the AES-GCM AAD binding — which forces every connection to reconnect.
   **Meets the test on all three counts.**
2. **There is no durable user identity.** `requireOfficeUser` returns `{ email, isAdmin }`;
   roles live only in the undeployed Cloud Run path; the capability system is decorative.
   This has now blocked or distorted **three** features (EDIT-01, per-user Gmail, inbox
   access). The question for you is whether the cheap email-allowlist answer is right, or
   whether the compounding cost says build it properly now.
3. **App-saved config outranks env, keyed by a constant connection key.** So changing the
   environment at the Cherry Hill cutover **will not take effect** while stale rows exist.
   Architectural in effect even though each piece looks like configuration.
4. **The application read path bypasses the ports architecture.** Five `app/application`
   read services import concrete `adapters/d1` and run inline SQL (recorded as **N6-1**, a
   verified nightly finding, disposition "owner-gated architecture proposal"). The
   PostgreSQL suite cannot back reads without rewriting each one. Pure migration tax —
   costless today, expensive at the platform move.
5. **The no-scheduler law** (`tests/ai-outbound-guard.test.mjs:388-391`, Worker is
   fetch-only). It shapes every sync and background feature the owner has asked for. Not
   wrong — but it is a constraint he should re-affirm deliberately rather than keep
   discovering.
6. **Golden hashes byte-pin the Overview and Reports markup.** Fine today; worth knowing
   before any redesign is scoped, because they make one class of UI work much more expensive.
7. **`users/me` pins Gmail to the connected account.** The config audit concluded this is
   *correct* and the one-account invariant should survive — but it is the assumption every
   multi-mailbox design rests on, so it is worth a second opinion rather than inheritance.

### What I would not spend budget on

The record CRUD, the Drive filing path, the AI assistant boundary, and the settings
persistence layer have all been through adversarial review recently and came out clean. The
filing path in particular is the most carefully built thing in the repo — leased, idempotent,
content-addressed, dual-audited. Reviewing it again is unlikely to repay the cost.
