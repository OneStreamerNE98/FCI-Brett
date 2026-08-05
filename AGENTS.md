# FCI Operations repository guidance

These instructions apply to the entire repository and are intended to give every AI agent (Codex, Claude) and human contributor the same operating context.

## Read first

Start with [`docs/README.md`](docs/README.md), the audience-grouped index of every document (added July 24, 2026). Then, before changing code, read:

1. `docs/codex-to-codex-handoff.md`
2. `docs/architecture-decision-production-platform.md`
3. `docs/architecture-decision-workspace-first-cost-controlled-rollout.md`
4. `docs/20-user-product-and-architecture-review.md`
5. `docs/agent-plan-architecture-workspace-and-setup.md`
6. `docs/complete-product-and-google-cloud-architecture-audit.md`
7. `docs/google-cloud-runtime-foundation.md`
8. `docs/ui-and-product-readiness-review.md`
9. `docs/google-workspace-rollout-guide.md`
10. `docs/task-checklists/README.md`
11. `docs/collaboration-and-sharing.md`
12. `docs/nightly-reviews/README.md` (the standing nightly review program; added July 24, 2026)

## Current product boundary

- The Sites/Workers/D1/R2 deployment is the controlled, single-user development environment and uses test data only.
- Production will use a small regional Cloud Run/Cloud SQL modular monolith, Secret Manager, Google Workspace OIDC, and application-owned authorization and audit controls. Cloud Tasks, Cloud Scheduler, Gmail Pub/Sub, Calendar HTTPS webhooks, Cloud Storage quarantine/scanning, SMS, and `pgvector` are feature-gated capabilities, not day-one provisioning requirements.
- Follow the [Workspace-first, cost-controlled rollout](docs/architecture-decision-workspace-first-cost-controlled-rollout.md): reuse existing Workspace services, keep Sites as development, keep staging on demand, define both standalone and HA Cloud SQL profiles, and leave optional infrastructure modules disabled and unapplied until approved.
- Preserve the current development deployment, Google Workspace test connector, and existing data unless the owner explicitly approves a migration or destructive change.
- Do not add scheduling, messaging, or AI document indexing before the production platform and authorization foundation is accepted.
- Do not admit a second user or store real client data until users, sessions, roles, project permissions, backup restoration, and audit controls pass acceptance.

## Required workflow

1. Start from an up-to-date, clean `main` branch.
2. Create an agent-prefixed branch: `codex/<short-feature-name>` for Codex, `claude/<short-feature-name>` for Claude, `kimi/<short-feature-name>` for Kimi.
3. Keep changes scoped and preserve unrelated user work.
4. Run the relevant tests during development and run `npm test` before handoff.
5. Open a pull request with a concise summary, verification evidence, and data/security impact note.
6. Do not deploy, change hosted configuration, migrate data, or merge to production without owner approval.

## Deploying the Sites app — record every deployment

The owner deploys the private ChatGPT Sites app from GitHub on demand. **There is no
GitHub Actions deployment** — `.github/workflows/cloud-run-image.yml` publishes an image on
manual dispatch and states outright that it does not deploy. So merging is **not** deploying:
merged code sits inert in `main` until the owner deploys.

**If you perform a deployment, you must do both of the following.**

**1. Set the build-stamp variables in the build environment — both, or neither.**
`FCI_BUILD_COMMIT_SHA` (short SHA) and `FCI_BUILD_TIMESTAMP` (ISO-8601 UTC) are read at
**build** time by `build/build-information.mjs` and baked into the bundle by `vite.config.ts`.
`build-information.mjs` **throws if exactly one is supplied**, and the Settings → Data &
security card renders `Build identifier unavailable` when both are absent. Nothing in this
repo sets them; the deploy step must.

**2. Append an entry to the canonical deployment log — GitHub issue #258**,
<https://github.com/OneStreamerNE98/FCI-Brett/issues/258> ("ChatGPT Sites deployment log
(canonical)"), as a **new comment**, carrying:

- deployment timestamp in **Eastern and UTC**;
- the exact GitHub **source branch and commit SHA**;
- the **ChatGPT Sites version** and the deployment **result**;
- the **live URL**;
- whether **source files, hosted configuration, migrations, or live data** changed.

**Why this rule exists.** This file previously carried a deployment baseline that went
**eleven days stale**; an agent quoted it as current fact and produced two different wrong
counts of unshipped work before the owner pointed out he could see that day's merges running.
Issue #258 is the record; the build stamp makes it visible in the app; this rule is what makes
both happen. **Never write a commit SHA, version number, or "what is live" claim into a repo
file** — read the newest #258 entry instead. That is the mistake this rule replaces.

## Multi-agent coordination

Multiple AI agents work this repository from separate clones. Each agent is its own
"machine"; GitHub is the source of truth. The rules that keep them from colliding:

- **Pull first, every session.** Fetch and start from current `main` before any work,
  and pull again after the owner merges anything. Never build on a stale clone — a
  stale-based PR conflicts with everything.
- **One branch per agent per task, always agent-prefixed** (`codex/*`, `claude/*`,
  `kimi/*`). Never commit directly to `main`. The PR history doubles as the attribution
  log of which agent did what — keep the prefixes honest.
- **Pull requests are the only merge point.** The owner (Jason) reviews and merges;
  agents never merge their own or another agent's PR unless the owner explicitly
  delegates it for a named PR.
- **Never two agents in the same files at the same time.** Work is divided by packet:
  the status lines in the [agent execution plan](docs/agent-plan-architecture-workspace-and-setup.md)
  are the claim mechanism. A packet that is `In progress` or `In review` is owned —
  do not take it, and do not edit the files its branch touches. The
  `app/FloorOpsApp.tsx` single-file queue rule is the canonical example, and its queue
  order appendix is the claim list — a packet that adds a `FloorOpsApp.tsx` change must
  add itself there in the same PR.
- **A packet is available if and only if it has no status line.** Prose lists of
  "unclaimed packets" are historical narrative and have gone stale repeatedly; the status
  lines are the only dispatch authority. (The ledger guard also enforces heading grammar
  and rejects stale merged-PR references, but nothing makes prose availability lists true —
  which is exactly why they must not be dispatched from.)
- **Owner decisions have exactly one home.** AI-workstream decisions live in
  `docs/ai-assistant-spec.md` §12; operating-model and record-editing decisions live in
  `docs/task-checklists/06-20-user-operating-model-and-access.md`. Every other surface
  (ledger preambles, plan files, packet bodies) **points, never copies** — and on any
  conflict, the home wins. Copies drift; this session proved it twice.
- **The status-line grammar is mechanically enforced** by `tests/task-tracking-docs.test.mjs`
  across five packet ledgers — the marker is bold `**Status:**`, it sits on the line directly
  below the heading, and only seven forms are legal. An invalid line fails CI with a message
  that does not name the legal forms, so copy the table in the plan's "Task tracking and doc
  reconciliation" section rather than guessing.
- **If your work unexpectedly needs a file another agent's open PR touches**, stop and
  flag it to the owner instead of racing the other agent to a conflict.
- **After any sibling PR merges**, re-check your open branch's mergeability against
  `main` and resolve documentation-ledger conflicts by keeping main's newer status
  wording while preserving your branch's content additions.
- **Standing review surfaces (added July 24, 2026).** A themed nightly review program
  runs on the owner's kickoff; its index is
  [`docs/nightly-reviews/README.md`](docs/nightly-reviews/README.md) and its findings
  ledger is [`docs/nightly-review-2026-07-findings.md`](docs/nightly-review-2026-07-findings.md).
  Separately, an automated review comments on every pull request; each
  review-and-merge cycle addresses every automated comment on-thread with an
  agree/disagree reason and whether it was fixed.

### Roles (owner-confirmed, July 21, 2026)

- **Claude (Fable) — orchestrator:** plans the work, authors and sequences the packets
  and ledgers, reviews every code PR before merge, and delivers the final review
  verdict. Reviews run as multi-lens agent fleets with adversarial verification;
  security-critical surfaces (authorization boundaries, OIDC/session/CSRF/consent
  code) are additionally read line-by-line by the orchestrator itself.
- **Codex — implementer:** builds the packets exactly as written in the plan ledger
  (why/do/accept), one packet per draft PR, and runs the complete post-merge ledger
  flip after each of its merges. If a build disproves a packet premise, the
  implementer does NOT rewrite the packet's Why/Do/Accept: the original text stays,
  and the correction lands as a dated amendment banner (orchestrator-authored, or
  proposed in the PR body for the orchestrator to place). A PR never edits the
  criteria it is graded against (rule recorded August 4, 2026, after EDIT-09).
- **Kimi — implementer, senior track (added August 4, 2026; role revised the same day
  after adversarial design review):** a third build agent under every implementer law —
  packets exactly as written, one packet per draft PR, `kimi/*` branches, its own clone,
  the post-merge ledger flip duty, and the prohibition on editing the criteria it is
  graded against. Two tracks, separately gated:
  - **Senior-implementer track** — eligibility for large/complex packets. Gate: three
    completed packets, at least one with a >300-line diff or touching a pinned/golden
    surface, judged on PROCESS FACTS: zero pushes after the recorded approval head, zero
    edits to graded criteria, zero pushes into another agent's active fix window. Until
    the gate passes, packet size is the orchestrator's discretion.
  - **Advisory-reviewer track** — **ACTIVATED EARLY by owner decision, August 5, 2026**
    ("more reviewing, not the orchestrator yet") — the senior-implementer gate is NOT a
    prerequisite for it, because reviewing is itself the training: every finding forces
    reasoning about the laws rather than mere compliance with them. It runs dry-run first (findings delivered to the orchestrator privately and scored for
    precision before any PR comment is posted; the reviewer receives that scorecard —
    real findings, noise, and what the orchestrator's fleet caught that it missed — and
    the channel goes live on PRs after ONE scored dry-run unless precision is poor —
    shortened from two by owner decision, August 5, 2026: the BUILD layer already spans
    three model families (Claude, OpenAI/Codex, Moonshot/Kimi), but the REVIEW layer is
    entirely Claude — the orchestrator and every fleet agent — so an independent reviewer
    from another family covers a blind spot nothing else in the process covers, and that
    outweighs a longer probation).
    Every agent joining the review layer reads
    [`docs/agent-reviewer-briefing.md`](docs/agent-reviewer-briefing.md) first. When live: findings post as PR comments
    prefixed with the literal token `KIMI-ADVISORY:`; such comments are EXCLUDED from
    the address-every-automated-comment rule; findings count only if posted before the
    orchestrator's verdict comment — later findings become new packets, never PR
    reopeners; no step of any merge sequence waits on or names an advisory reviewer;
    advisory findings about another agent's work are never an input to packet routing;
    an advisory reviewer never pushes to another agent's branch and never opens a PR
    touching files under another agent's open claim.
  Assignment is by dispatch: an implementer claims only packets the orchestrator's
  dispatch (relayed by the owner) names for it — the branch prefix on the claim line is
  the assignment record. Precedence everywhere: owner > orchestrator verdict > CI >
  advisory comments.
- **Owner (Jason) — merge authority and gates:** merges PRs (may delegate a named PR),
  and holds every owner gate: new scopes, API keys, billing, live resources,
  deployment, second user, real data.
- **The approval head is frozen (recorded August 4, 2026, after the WS-19 rewrite).**
  The orchestrator's review verdict names the approved head SHA (`APPROVED-HEAD: <sha>`
  in the verdict comment). ANY push to that branch past the approved head — by any
  agent, for any reason — voids the approval and requires re-review of the delta before
  merge. History rewrites of a branch under review are never acceptable; a rewrite that
  orphans a reviewed commit is treated as unreviewed work in its entirety.
- **Head movement during fix work stops the work (stop-verify-resume).** Any agent
  applying fixes to a branch verifies the remote head before starting and before
  pushing; if the head moved, it STOPS, adjudicates the movement with
  `git range-diff` (all reviewed commits byte-identical + finding surfaces untouched →
  benign, re-point and continue; anything else → escalate to the orchestrator), and
  never force-pushes over another agent's commits. Fast-forward pushes only during fix
  work.
- **Per-agent git identity.** Each agent's clone sets its own `git config user.name`
  (e.g. "Codex (agent)", "Kimi (agent)") so commit attribution matches the branch
  prefix. A commit on an agent-prefixed branch whose committer identity names a
  different agent is a review-blocking finding.
- No agent merges another agent's PR without the owner explicitly delegating
  that PR by number. Review findings are addressed by the branch's owning agent.

## Useful commands

```powershell
npm.cmd ci
npm.cmd run lint
npm.cmd test
npm.cmd run test:e2e
```

**`npm test` is not the whole gate.** It runs the production build, the Cloud Run build, and the Node test suite (`tests/*.test.mjs`) — it does **not** run Playwright. CI requires three separate jobs on every pull request, and a branch that only passed `npm test` can still fail two of them:

| CI job | What runs it | What it covers |
|---|---|---|
| `Node 22 lint, build, and tests` | `npm run lint` then `npm test` | ESLint, both builds, the Node suite — run against a live `postgres:16` service with `TEST_POSTGRES_URL` set, so real-PostgreSQL tests that self-skip locally **do** run in CI |
| `Chromium rendered regression tests` | `npm run test:e2e` | the Playwright specs in `tests/e2e/`, including the two golden-hash digests in `tests/e2e/page-layouts.spec.ts` |
| `Terraform source validation` | `terraform fmt -check -recursive`, `validate`, `test` | everything under `infrastructure/google-cloud`, plus an expected-failure activation-lock test |

Packet Acceptance lines frequently require e2e evidence ("simulation e2e", "prove it in the Office e2e journey"); `npm run test:e2e` is how you produce it. Run `npm run e2e:db:prepare` first if the local D1 fixture is stale.

If a command cannot run, record the exact blocker rather than treating unverified work as complete. Known environment blocker: `npm test` requires Node ≥ 22.13.0 (`vinext` uses `node:fs/promises.glob`); on Node 20 it fails during the build, which is a toolchain problem, not a code failure.

**Golden hashes.** The definition lives in the plan ledger's Global guardrail 7b — read that, not a summary. Short form: two SHA-256 digests in `tests/e2e/page-layouts.spec.ts` freeze the Overview and Reports markup; `npm run test:e2e` evaluates them against the live DOM, **and three Node suites additionally pin the digest constants byte-for-byte** (`ai04-today-view`, `fix15-toast-and-folds`, `nfix04-phone-polish`), so editing a digest also fails `npm test`. A mismatch is a signal, not a chore. Regeneration is a sanctioned event available to ANY packet whose PR includes owner-approved before/after screenshots of both pinned pages at 1280 (with the change rationale) and updates the three additional pinning suites in the same commit. The named-packet restriction was lifted August 3, 2026 by owner decision under the standing law-lift rule (checklist 06); scope of the lift: the authority model only — the hashes, the pinned selectors, and the three-suite requirement are unchanged. Never paste a new digest in to make a suite pass.

## Security and data rules

- Never commit `.env`, `.env.local`, OAuth JSON credentials, client secrets, encryption keys, API keys, access/refresh tokens, production exports, or local databases.
- Use `.env.example` only for variable names and safe placeholders.
- Use records named `FCI TEST — DO NOT USE` for development verification.
- Keep employee login separate from the one company Google Workspace data connector.
- Enforce authorization on the server and inside data queries; hidden UI controls are not authorization.
- Treat Google `sub` as the stable external user identity and verify the signed Workspace `hd` claim for production login.
- Never weaken review-first Gmail filing or automatically send messages.

## Current implementation order

Use the status lines and dependency order in [`docs/agent-plan-architecture-workspace-and-setup.md`](docs/agent-plan-architecture-workspace-and-setup.md) for active backend, Workspace, and Settings work. Use the design-critique ledger for UI remediation and the task checklists for owner setup and acceptance. Pull requests and issues may mirror those ledgers, but they do not define a separate task sequence.

Staging execution, infrastructure or migration apply, live Workspace identity, production deployment, a second user, real data, scheduling, messaging, and AI document indexing remain behind their recorded approval and acceptance gates.

## Handoff requirements

At the end of a task, report:

- Branch and commit identifiers
- Files changed and the user-visible outcome
- Tests/build/lint run and their results — name each of the three CI gates
  (`npm run lint`, `npm test`, `npm run test:e2e`) and its outcome, or the exact blocker
  if one could not run. "Tests pass" without naming which suites ran is not a report.
- Data, security, configuration, and migration impact
- Remaining blockers or owner actions
- Whether deployment or external configuration was intentionally left unchanged
