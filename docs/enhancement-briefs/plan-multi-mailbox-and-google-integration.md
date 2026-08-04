# Plan — multiple mailboxes for email analysis, and deepening the Google integration

**Requested by:** Jason (owner), August 3, 2026 — *"I'll need help with this plan; I'm not
sure of best practices or what's most efficient and effective."*
**Verified against:** `origin/main` @ `301947d`, and the live site.

---

> ## OWNER DECISION — August 3, 2026
> **Every mailbox will be a shared company address. No individual staff mailboxes will be
> attached.**
>
> This is a significant simplification and it removes three separate problem classes:
> - **The identity blocker is gone.** Per-user OAuth was the one part of this genuinely
>   blocked on durable identity. Attaching a shared mailbox needs none of it, because you
>   sign in to the mailbox yourself and consent is inherent in the mechanism. **WS-20 is
>   now fully buildable.**
> - **The employee-monitoring question is gone**, and with it the staff privacy policy and
>   the legal review that §3 said had the longest lead time. Nothing in this design can
>   read a person's own mailbox, and it cannot be turned into that by configuration drift.
> - **The `gmail.modify` scope concern shrinks.** It still grants send and delete on every
>   attached mailbox, but on company role addresses that is an ordinary operational grant
>   rather than a serious over-reach. Worth knowing; no longer worth blocking on.
>
> §3 below is retained for the record and no longer applies to the planned build.
> **The only remaining architectural choice is Pattern A vs Pattern B in §1** — how many
> real mailboxes — and the only remaining open question is #3 (may staff see an inbox at
> all).

## The short version

1. **Addresses are free. Mailboxes are not.** Decide how many *real* mailboxes you need,
   not how many addresses. They are different numbers and conflating them is the expensive
   mistake here.
2. **The app can hold exactly one Google connection today.** Multi-mailbox is filed as
   **WS-20** and shares its central blocker with **WS-19**, so those two get built together
   or not at all.
3. **Shared vs personal mailboxes is not an engineering distinction — it is a legal one.**
   Mechanically they attach identically. Only one of them is employee monitoring.
4. **Seven zero-code integration wins are already documented and none are done.** Do those
   before building anything.

---

## 1. The decision that actually matters — how many real mailboxes?

An **address** (`sales@`, `service@`, `warranty@`) is free and unlimited — a Google Group
or an alias. A **mailbox** is a licensed Workspace account, and in this app it is also an
OAuth connection, a stored refresh token, and a row in every integration table.

**Best practice: one real mailbox per genuine trust boundary, not one per address.**
A trust boundary is a place where the answer to *"who may read this, and does it retain
differently?"* changes. For a 20-person flooring company that is usually two or three, not
seven.

**Three patterns, and when each is right:**

**Pattern A — many addresses, one mailbox.** `sales@`, `service@`, `warranty@` are Groups
or aliases all delivering into one connected mailbox; Gmail filters label on arrival.
- **Cheapest by far:** one license, one connection, unlimited addresses.
- **Blocked today, and this is a verified constraint, not an opinion:** the app supports
  exactly four buckets — `inbox`, `intake`, `needs-review`, `filed`
  (`app/lib/operations-routes.ts:58`), each mapped to a fixed `FCI/...` label
  (`app/lib/google-gmail.ts:170-175`). **There is no arbitrary-label filtering**, so you
  could not view "just the sales mail". Making Pattern A useful needs app work — a
  per-label view — which is *smaller* than multi-connection work but is not nothing.
- **Also:** one mailbox means one permission boundary. Everyone who can see the inbox sees
  all of it.

**Pattern B — a small number of role mailboxes.** Real Workspace accounts (`intake@`,
`service@`) whose credentials **you** hold, each attached to the app by signing in.
- This is exactly what **WS-20** describes, and it needs no identity work: consent is
  inherent because you sign in to the mailbox yourself.
- Costs a license each and one connection each.
- **My recommendation for you**, at two or three mailboxes maximum.

**Pattern C — individual staff mailboxes.** Brett's own mailbox attached to the app.
- Mechanically identical to B — someone signs in and consent is granted.
- **Materially different in every other way.** See §3.

---

## 2. What the app supports today, verified

- **Exactly one Google connection can exist.** `connection_key` is a mode constant
  (`app/lib/google-oauth.ts:439`) and `google_connections.connection_key` is `UNIQUE`
  (`db/schema.ts:302`). Connecting a second mailbox would overwrite the first.
- **Readiness is a global single-account boolean.** `app/lib/google-oauth.ts:420-427`
  invalidates the config unless `AUTHORIZED_ACCOUNTS` holds exactly one entry equal to
  `INTAKE_MAILBOX`. **Listing several mailboxes there does not enable multi-mailbox — it
  disables Gmail entirely.** This is the single most likely way to break your live setup
  while experimenting, so do not try it.
- **All six Gmail routes are Administrator-only.** No staff member can see any inbox today.
- **`users/me` is not a blocker** — each connection carries its own token, so it resolves
  to that connection's mailbox. It only obstructs impersonation, which this design avoids.
- **WS-20 is filed and available**, sequenced after **WS-19** because both rewrite what
  `connection_key` means and doing them separately rewrites the same ~191 references twice.

**So the build order is forced: WS-19 → WS-20 → (optional) per-label views.**

---

## 3. Shared vs personal — the line that matters

You said *"maybe not all will be shared."* That distinction barely changes the code and
changes almost everything else.

**A shared or role mailbox** (`sales@`, `intake@`) is company correspondence in a company
container. Attaching it is an ordinary operational decision.

**An individual's mailbox** is that person's working life, including things they
reasonably assume are between them and a customer. Attaching it to a system that
classifies, stores snapshots, and surfaces content to administrators **is employee
monitoring**, whatever the intent.

What I'd want in place before any personal mailbox is attached:
- **A written, acknowledged policy.** Employer access to work email at a US company is
  generally lawful, but every source agrees defensibility comes from *notice*, not from
  owning the mail system. New Jersey case law (*Stengart*, 2010) makes the written policy
  and advance notice the deciding factor in whether an employee retains a reasonable
  expectation of privacy. **The repo has no staff-facing privacy, monitoring or
  acceptable-use document at all.**
- **Confirm with counsel.** I am not giving legal advice, and sources genuinely conflict on
  whether NJ has a monitoring-notice statute — reputable trackers list CT, DE, NY and TX
  but not NJ, while low-quality sites assert an uncorroborated 30-day rule. Do not rely on
  my read.
- **Know what the scope grants.** The app's only Gmail scope is `gmail.modify`. **Attaching
  a mailbox confers send and delete on it**, not read-only visibility. For a personal
  mailbox that is a much bigger grant than you probably intend, and narrowing it forces a
  disconnect/reconnect for every existing connection.

**Recommendation: forward, don't attach.** Your original instinct was right — have staff
*forward* what should be analysed into a shared intake mailbox. You get the analysis, they
keep their mailbox, the policy question mostly evaporates, and it costs one connection
instead of twenty.

---

## 4. Do these first — zero code, already documented, none done

`docs/task-checklists/11-google-quick-wins.md` (packet **WS-16**) lists owner-only clicks
requiring no code, no new scopes and no cost beyond your existing licenses. **Every box is
unchecked.** These are the highest value-per-effort items available:

- **Client self-booking page** — a Calendar appointment schedule for site visits and
  measurements. Booked slots appear as events the app already reads.
- **`ops@` send-as alias** — verified in Gmail, so app-sent mail uses a professional From
  address with no scope change.
- **Looker Studio dashboard** (free tier) over the `FCI Operations Directory` spreadsheet —
  lead pipeline by stage, jobs by status, closeout aging. Share view-only with the office.
- **PWA install** for office browsers via Chrome Enterprise Core (free) — the app already
  ships the manifest.
- **`FCI Holidays` calendar** — company closure days as config-as-calendar.
- **Confirm the Workspace edition** — gates Drive Labels (GI-06).
- **Review Shared Drive external-sharing** — verify-only.

**Do this batch before any multi-mailbox build.** It is an evening of clicking and it
deepens the integration more than the next month of code.

---

## 5. What else can deepen the integration

Ranked by value now, with honest blockers:

| Item | Value | Blocked on |
|---|---|---|
| **WS-16 quick wins** (above) | High | Nothing — your clicks |
| **Forms intake finish** (GI-01) | High | The env var; form is built |
| **Gmail filing** (WS-08 second half) | High | Nothing — file one email |
| **GI-04** address validation + autocomplete | High | WS-15 (Maps billing) for *live* calls only; buildable now |
| **GI-06** Drive Labels status taxonomy | Medium | Workspace edition confirmation + you hand-build the taxonomy |
| **GI-05** per-project Drive activity feed | Medium | An owner decision on the scheduling model |
| **GI-07** Gmail add-on — filing inside Gmail | Highest ceiling | **Do not schedule.** Its stated foundation does not exist; blocked on the entire production migration |

**The one I would highlight:** *Gmail filing has never run outside simulation.* Zero
filing events on the live tenant, ever. It is the one thing this app does that Gmail
cannot, and proving it takes two minutes.

---

## 6. Recommended sequence

1. **Tonight:** the WS-16 quick wins, plus set the Forms Sheet ID, plus file one email to a
   project. Zero code, and it closes three open packets.
2. **Decide:** how many real mailboxes, using the trust-boundary test in §1. Write the
   answer down — it determines everything after this.
3. **If personal mailboxes are in scope:** get the written policy and the legal check
   started now; it has a longer lead time than the code.
4. **Build WS-19** (tenant cutover). Independently valuable, protects the Cherry Hill move,
   and unblocks WS-20.
5. **Build WS-20** (multi-mailbox attach) — with the mailbox picker, per-mailbox readiness,
   and filing that records which mailbox a message came from.
6. **Then, only if Pattern A won:** per-label views, so one mailbox can present several
   logical inboxes.

## Open questions for you

1. **How many real mailboxes, and what is each one's boundary?** Name them. This is now
   the only architectural decision left — Pattern A (one mailbox, many addresses, plus
   per-label views) or Pattern B (two or three role mailboxes, no extra app work).
2. ~~Are any of them individual staff mailboxes?~~ **ANSWERED August 3, 2026: no. All
   shared company addresses.**
3. **Should staff be able to see any inbox at all?** All six Gmail routes are
   Administrator-only today. **"Shared inbox" strongly implies staff should**, and that is
   a *separate* change from attaching mailboxes — different work, different risk, and it
   is the question most likely to be assumed rather than decided. If office users are to
   work these inboxes, say so now: it changes the route guards, not just the connection
   model.
4. ~~Read-only or full access?~~ **Effectively answered by decision above.** `gmail.modify`
   grants send and delete, which on shared company addresses is an ordinary operational
   grant. Recorded rather than blocking. Revisit only if a mailbox ever holds something
   more sensitive than company correspondence.

---

# ADDENDUM — staff working the inboxes, with per-person access set in Settings

**Owner decision, August 3, 2026:** staff should be able to work these shared inboxes, and
the owner wants to assign individual access rights **from the Settings UI**. The owner has
also stated **the inboxes will not contain sensitive information**, which is the input that
decides the right design.

## The trap to avoid first

**Do not build this on the existing capability constants.** `canCreate`
(`app/application/creation-authorization.ts:32-34`) checks a capability set that every
route hard-codes before checking it — it is always true by construction, and its nine call
sites enforce nothing on the running transport. Wiring inbox access through it would
produce a Settings screen that *looks* like it assigns rights and grants everyone
everything. That is worse than no control, because the screen would lie.

## What the app can actually rely on today

**Every route already receives `{ email, isAdmin }`** (`app/lib/workspace-auth.ts:4-7`,
resolved at `:50`). Office membership comes from `FCI_OFFICE_EMAILS` / `FCI_OFFICE_DOMAINS`
and admin status from `FCI_ADMIN_EMAILS` (`:31-39`).

So the app has **one reliable identity fact — the signed-in email** — and no roles. The
easiest correct design keys on exactly that, and nothing else.

## Recommended design — a per-mailbox access list, keyed on email

**In Settings:** each connected mailbox gets an access list. An administrator adds office
users to it. Administrators always have access and cannot be removed from their own view.

**Server-side, in every Gmail route:** replace the current `requireOfficeUser(request,
{ admin: true })` with *"administrator, **or** listed for this mailbox."* This is the real
work — all six Gmail routes are Administrator-only today, so opening them to staff is a
route-guard change, not a UI change. It must be enforced per request; the Settings screen
is presentation only.

**Storage:** the access list is small, so `workspace_settings` (BE-15 atomic merge) is
adequate. **One caveat to record:** BE-15's own residual notes that same-key sub-writes are
last-write-wins, so two administrators editing two different mailboxes' lists in the same
minute could lose one edit. Acceptable at this size; if the lists ever grow or churn, move
to a row-per-grant table.

**Pick from known office users — never free-text email entry.** A typo in a free-text field
silently grants nothing (or, worse, grants a future hire who gets that address).

**Audit every grant and revoke** with actor and timestamp, using the existing
`activity_events` pattern.

## What staff can do — DECIDED

> **OWNER DECISION, August 3, 2026: view + file.**
> An assigned office user may read the inbox and the AI review queue, and may file an email
> to a project. **Sending and replying stay Administrator-only.**

Concretely, that means the access list opens these routes to assigned office users:
- `GET .../gmail/messages` — read the mailbox
- `GET/POST .../gmail/messages/[messageId]/file` — preview and perform a filing
- `GET /api/v1/inbox-analysis` — the AI review queue
- `PATCH /api/v1/inbox-analysis` — retire a reviewed row

And these stay Administrator-only:
- `POST .../gmail/send-test` and any reply/send path — sending as a shared address is a
  separate decision from inbox access
- `POST .../gmail/labels/prepare` — setup, not daily work
- `POST /api/v1/inbox-analysis` — triggering an analysis sweep spends provider budget

**Why filing is safe to delegate:** it is leased, idempotent and content-addressed; it
copies into Drive and adds a label; **it never deletes and never modifies the original**.
Every filing writes dual audit rows. A staff member cannot lose a message by filing it —
the worst case is a copy in the wrong project folder, which is visible and correctable.

**Accepting an AI-proposed lead** is a record *creation*, not an inbox action. It runs
through `POST /api/v1/leads`, which is already office-accessible, so an assigned user
working the queue can complete that flow without any further grant. Worth stating
explicitly so nobody adds a redundant gate.

## Why this is proportionate, stated honestly

This is an **access list, not an identity system.** It depends on the hosting-supplied
email header, which is the same basis the entire app already uses to decide who is an
administrator. It will keep honest people out of inboxes they are not assigned to; it is
not a defence against a compromised platform header.

**Given the owner's statement that these inboxes hold no sensitive information, that is the
right level of control** — proportionate, cheap, and buildable now with no identity
foundation, no new OAuth scopes, and no Directory API. It should be described in the
settings guide in exactly those terms, so nobody later mistakes it for something stronger.

If sensitive content ever lands in one of these inboxes, this design should be revisited
against real durable identity — and that decision should be recorded, not assumed.

## Scope note for WS-20

This makes **WS-20 bigger than "attach more mailboxes."** It now carries: per-mailbox
access lists, the Settings surface to manage them, and opening six Administrator-only
routes to assigned office users. That is a meaningful scope increase and should be planned
as such — possibly split, with attach-and-picker first and access control second, so the
route-guard change lands on its own and can be reviewed properly.
