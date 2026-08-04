# Enhancement request — type an action into the AI agent to update records, with a permission check and a confirm-diff prompt

**Requested by:** Jason (owner), August 3, 2026
**Status:** requirements only — not a packet. Hand to Fable to plan.
**Verified against:** `origin/main` @ `301947d`.

---

## 1. What I want, in plain terms

I want to **type an action** into the AI agent and have it update records for me —
*"mark the Kresson Road install as complete"*, *"move Dana Whitfield to proposal"*,
*"set the Haddonfield basement to 22 March"*.

Three parts, all required:

1. **Type an action** into the agent tool, in plain language, and have it understood.
2. **Check whether I'm allowed** to modify that record, and say so if I'm not — the
   record prompts the user based on their access.
3. **Show me exactly what will change** before anything happens — a prompt listing the
   modifications, with **Submit** and **Cancel**.

Nothing is written until I press Submit.

---

## 2. What exists today

**The AI agent is read-only, structurally and deliberately.** It exposes ten tools
(`app/application/assistant/tools.ts:495-505`), every one a read: `searchRecords`,
`projectEvidence`, `clientEvidence`, `meetingSearch`, `tasks`, `leads`, `filedEmail`,
`dashboardMetrics`, `today`, and optionally `drive_search`.

**This is enforced by test, not convention.** `tests/ai-outbound-guard.test.mjs:280`
rejects `INSERT|UPDATE|DELETE|CREATE|ALTER|DROP` anywhere in
`app/application/assistant/**` and every `route.ts` under `app/api/v1/assistant/`. The
provider is called with `tools: []` on the paths that must not act.

**That guard should not be weakened, and does not need to be.** The repo already has the
right pattern, used twice: the assistant **proposes**, and an ordinary non-assistant
endpoint **executes**. AI-07 does exactly this — the assistant route proposes a task and
creation happens through `POST /api/v1/tasks`. The same split works here: the agent
produces a structured intent; a separate route applies it through the existing PATCH
endpoints.

**The write path is ready.** `PATCH` exists for projects, leads, clients and tasks with
optimistic concurrency and audit rows (EDIT-03…EDIT-08, all merged). See the companion
brief on email-driven updates — both enhancements land on the same endpoints and should
share one confirm-diff component.

---

## 3. The blocker you need to know about — requirement 2 cannot be built today

**"Prompt the user if they have access to modify the record" requires an authorization
system that does not work.**

Verified: `canCreate` (`app/application/creation-authorization.ts:32-34`) returns
`context.capabilities.has(capability)` — and every route **hard-codes the capability array
it then checks**, so the check is always true by construction. Nine capability call sites
across six routes (`recordsRead`, `leadsCreate`, `leadsUpdate`, `tasksUpdate`,
`meetingsUpdate`, `createClient`, `createProject`) enforce nothing on the transport this
app actually runs on.

The root cause is identity: `requireOfficeUser` returns only `{ email, isAdmin }`
(`app/lib/workspace-auth.ts:4-7`), and the role-mapped policy in
`authorization-policy.ts` is consumed only by the Cloud Run employee path, which is not
deployed. **The only authorization primitive that genuinely works today is `isAdmin`.**

This is already recorded as a known gap with a stated blocker — it is not a new discovery,
and it is the same foundation the per-user Gmail work waits on.

**What this means for the plan — pick one, deliberately:**

- **Option A (recommended for v1): build against `isAdmin`, and say so.** Two tiers:
  administrators may change money and project status (already the recorded owner decision
  of July 26); any office user may change descriptive fields. Honest, enforceable today,
  and no false security.
- **Option B: wait for durable identity.** Correct, but blocks this enhancement behind a
  foundation with no packet and no date.
- **Do NOT do Option C:** wire the existing capability constants and present the result as
  a permission check. It would look like authorization and enforce nothing — worse than
  having no check, because the prompt would tell me I'm permitted by a system that always
  says yes.

---

## 4. How it should work

1. I type an action in the agent.
2. The agent resolves it to a **structured intent**: record type, record id, and the
   specific field changes. It does not write.
3. The app checks whether I may modify that record — with the honest primitive from §3 —
   and if I may not, it says so plainly and stops. No partial application.
4. A **confirmation prompt** shows the record, and a **field-level before → after diff**.
   Ambiguity is resolved *here*, not guessed at: if my instruction could match three
   projects, the prompt asks which.
5. **Submit** applies through the existing PATCH endpoint, with the version guard and an
   audit row recording that the change came from an agent action and who approved it.
   **Cancel** discards everything.
6. A 409 version conflict surfaces as a conflict, not a silent overwrite — the record
   changed while I was reading the prompt.

**Design notes:**
- **Reuse one confirm-diff component** across this and the email-driven updates. Two
  confirmation dialogs that behave differently would be a defect in itself.
- **Never batch across records without naming every one.** "Mark all the Cherry Hill jobs
  complete" must list each affected project in the prompt.
- **No destructive verbs.** Archive-only is a recorded owner decision; there is no delete
  endpoint anywhere and the agent must not be the thing that introduces one.

---

## 5. Security — this is the highest-risk surface in the app

**Giving a language model a write path means untrusted text can now influence writes.**
The agent reads record fields, filed email content and Drive text — none of which the
company authors. Today that content can only affect what is *displayed*. With this
enhancement it can influence what is *proposed*.

Requirements:

- **The human confirmation is the security boundary, so it must be honest.** The prompt
  must show the resolved field changes and the record — not a natural-language restatement
  of what the agent thinks it is doing. If the diff and the write can ever disagree, the
  boundary is decorative.
- **The applying route validates independently.** It must re-check the actor, the record,
  the field allowlist and the value bounds server-side. It must never trust a payload
  because the agent produced it.
- **Fence and bound the typed instruction** the same way the existing prompts fence
  untrusted data. Note `answer-question.ts:312` is recorded as the weakest fencing in the
  codebase (raw template interpolation, no `UNTRUSTED` label) — that is the pattern **not**
  to copy.
- **Field allowlist, server-side.** `contractValue` and project `status` stay
  Administrator-only per the July 26 decision. The agent must not be a route around a
  gate that exists elsewhere.
- **Audit every applied change** with the actor, the typed instruction, and the resolved
  diff. If someone later asks why a project moved to complete, the answer must be
  reconstructable.

---

## 6. Constraints

- **The outbound guard stays green, unmodified.** Propose in the assistant tree; apply
  outside it. A packet that edits `tests/ai-outbound-guard.test.mjs` to make this fit is
  doing it wrong.
- **Likely needs the `app/FloorOpsApp.tsx` queue slot** if the confirm prompt mounts as a
  modal there — check before scheduling against GI-04, AI-12 and the grid-view work.
- **Sequence after AI-12** and after the email-driven update work, so the shared
  confirm-diff component is built once.
- Provider cost rises: every typed action is a model call with record context.

---

## 7. Open questions for me

1. **Option A or B in §3?** I lean A — `isAdmin` now, honestly labelled — but I want to
   know what it costs to wait for real roles.
2. **How ambiguous is too ambiguous?** If my instruction matches three records, does the
   agent ask, or refuse?
3. **Should the agent ever chain actions** ("mark complete and schedule the walkthrough"),
   or one action per confirmation in v1?
4. **Undo?** A recently-applied agent change is the most likely thing I'll want to reverse.
   Archive-only means no delete, but a revert-to-previous is a different question.
