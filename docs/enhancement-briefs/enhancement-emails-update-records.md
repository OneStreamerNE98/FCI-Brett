# Enhancement request — inbound email should update existing records, not just create new ones

**Requested by:** Jason (owner), August 3, 2026
**Status:** requirements only — not a packet. Hand to Fable to plan.
**Verified against:** `origin/main` @ `301947d`, and the live site.

---

## 1. What I want, in plain terms

When an email comes in, I want it to **update the things I'm already tracking** — the
project, the lead, the client, whatever it relates to — not just create new records.

If a customer emails *"we've decided on the oak, and we'd like to push the install to the
22nd"*, that email contains two facts about a project I already have. Today I read it,
then go and type those facts in myself. I want the app to notice them and offer to apply
them.

---

## 2. What happens today — verified against source

The AI already reads every inbound email and classifies it into four intents
(`app/application/assistant/inbox-analysis.ts`). Here is what each one can actually do:

| Intent | What accepting it does today | Does it change record data? |
|---|---|---|
| **new-lead** | Opens the lead form pre-filled; you submit it | **Yes — creates a new lead** |
| **project-update** | `acceptProjectUpdate` (`app/inbox/components/InboxView.tsx:983-1001`) files the email into the project's Drive folder | **No** |
| **schedule** | Creates a task (`source: "email"`) | Creates a task, changes nothing else |
| **warranty** | Creates a task | Creates a task, changes nothing else |

**The gap, precisely stated:** inbound email can **create** records (leads, tasks) and
**attach** correspondence (filing into Drive with an audit trail). It can never
**update a field on a record that already exists.** The intent named "project-update"
does not update the project — it files the email *to* the project. That naming is
misleading and is probably why it feels like this should already work.

The AI already extracts structured fields — `company`, `contactName`, `contactEmail`,
`contactPhone`, `projectName`, `site`, `estimatedValue`
(`inbox-analysis.ts:97-105`). **Those extracted values are used only for new leads.** For
an email about an existing project they are computed and discarded.

---

## 3. The good news — the foundation is already built

This is not blocked. The record-editing series is **complete and merged**:

| Packet | What it shipped | PR |
|---|---|---|
| EDIT-03 | Optimistic concurrency (version guard, 409 on conflict) | #225 |
| EDIT-04 | Lead editing | #231 |
| EDIT-05 | Project editing | #228 |
| EDIT-06 | Client + contact editing | #249 |
| EDIT-07 | Task management | #248 |
| EDIT-08 | — | #265 |

Verified: `PATCH` endpoints exist for **projects, leads, clients and tasks**
(`app/api/v1/{projects,leads,clients,tasks}/[id]/route.ts`), and the project route
already returns **409 on a version conflict**.

**So there is a validated, audited, concurrency-guarded write path waiting.** An
AI-proposed update has somewhere safe to land. This work is "connect two things that both
exist", not "build a write path".

---

## 4. How it should work

**Propose a diff — never apply silently.** The whole app is review-first, and this is the
feature where that matters most. An email saying *"let's push to the 22nd"* must not
silently move a scheduled install. The pattern already proven by lead capture applies
directly:

1. Email arrives, AI classifies it and identifies the record it concerns
2. The review queue shows a **field-level diff** — *"Install date: 15 Mar → 22 Mar"*,
   *"Flooring: undecided → oak"* — with the sentence from the email that produced each one
3. You accept **per field**, not all-or-nothing. Some of the AI's reads will be right and
   some won't, and forcing a single accept/reject on a five-field diff means either
   accepting a wrong value or discarding four right ones
4. Accepting PATCHes through the existing endpoint, with the existing version guard and
   audit row
5. The email is filed to the record as evidence — which is what happens today, and should
   continue

**Confidence should gate presentation, not correctness.** A low-confidence extraction
should still be visible, just not pre-selected.

**Fields worth proposing, by record type:**
- **Projects:** status, scheduled/install date, flooring category, square feet, site
  address, estimated value, next action
- **Leads:** stage, next action, estimated value, contact details, site
- **Clients:** primary contact name/email/phone/role, industry
- **Tasks:** due date, status

**Never propose:** anything financial that is contractual (`contractValue`), and anything
already admin-gated by the owner decision of July 26 — money and project status are
Administrator-only. An AI proposal must not become a route around that.

---

## 5. The risk that must be designed for first

**There is an open, recorded weakness that becomes far more serious once email can write.**

`AI-R10` (`docs/ai-assistant-spec.md:364`, status **Open**): the exact project-number
matcher searches `from`, `subject` and `snippet` **without any sender-ownership check**.
A sender quoting another client's project number can pull that project's fields into an
AI context.

Today the blast radius is a reply draft — a read-only exposure, review-first, admin-only.
**Under this enhancement the same weakness becomes a write vector:** an email from anyone,
quoting a project number they saw once, could steer an update proposal at a project that
is not theirs. A distracted approver clicks accept and someone else's job data changes.

**This must be closed as part of this work, not after it.** Record matching for an update
proposal needs sender ownership — the sender's address must belong to the client on that
record, or the match must be presented as unverified and require explicit project
selection, exactly as filing already does.

**Other hard problems the plan must answer:**
- **Which record?** Matching is the hard half. Say what happens when confidence is low —
  my answer is: show the proposal but make the human pick the record.
- **Conflicting updates.** Two emails a day apart both change the install date. The 409
  version guard protects the database; it does not tell the operator which is newer.
- **Stale proposals.** A proposal generated Monday, accepted Friday, against a record
  edited Wednesday.
- **Audit.** Every accepted change needs to record that it came from an email, which
  email, and who approved it — the `activity_events` before→after pattern already exists
  on the lead PATCH path.

---

## 6. Constraints

- **Review-first is non-negotiable.** Auto-apply is `AI-T2-3`, gated on production
  acceptance plus calibration evidence plus a recorded owner decision. This enhancement
  must not become a back door to it.
- **The assistant tree cannot write.** `tests/ai-outbound-guard.test.mjs` forbids SQL write
  keywords in `app/application/assistant/**`. The classifier proposes; the accept handler
  calls the ordinary PATCH endpoint — the same separation AI-10 already uses.
- **Money and project status stay Administrator-only** per the July 26 owner decision.
- Likely takes the **`app/FloorOpsApp.tsx` queue slot** if the diff UI mounts near the
  Inbox review queue — check before scheduling against GI-04 and AI-12.
- **Sequence after AI-12.** AI-12 fixes the invisible-failure defect in the same route and
  component; building on top of it first avoids two packets editing the same files.

---

## 7. Open questions for me

1. **Per-field accept, or accept-the-whole-diff?** I want per-field; confirm the cost.
2. **Should a high-confidence, low-risk update ever apply without me?** My instinct is no,
   for anything. Worth asking whether e.g. a corrected phone number is different.
3. **What happens to an email that updates a record I then reject?** File it anyway, or
   leave it in the queue?
4. **Which fields do I actually care about?** The list in §4 is my starting guess — the
   plan should confirm rather than build all of them.
