# FCI Operations repository guidance

These instructions apply to the entire repository and are intended to give every AI agent (Codex, Claude) and human contributor the same operating context.

## Read first

Start with [`docs/README.md`](docs/README.md), the audience-grouped index of every document (added July 24, 2026). Then, before changing code, read:

1. `docs/BOARD.md` (the generated packet board — always current, CI-enforced)
2. `docs/guides/codex-to-codex-handoff.md`
3. `docs/specs/architecture-decision-production-platform.md`
4. `docs/specs/architecture-decision-workspace-first-cost-controlled-rollout.md`
5. `docs/reviews/20-user-product-and-architecture-review.md`
6. `docs/ledger/agent-plan-architecture-workspace-and-setup.md`
7. `docs/reviews/complete-product-and-google-cloud-architecture-audit.md`
8. `docs/specs/google-cloud-runtime-foundation.md`
9. `docs/guides/google-workspace-rollout-guide.md`
10. `docs/task-checklists/README.md`
11. `docs/specs/collaboration-and-sharing.md`
12. `docs/nightly-reviews/README.md` (the standing nightly review program; added July 24, 2026)

(Historical UI audit detail lives in `docs/archive/ui-and-product-readiness-review.md` —
archived August 2026; read it for history, not for current status.)

## Current product boundary

- The Sites/Workers/D1/R2 deployment is the controlled, single-user development environment and uses test data only.
- Production will use a small regional Cloud Run/Cloud SQL modular monolith, Secret Manager, Google Workspace OIDC, and application-owned authorization and audit controls. Cloud Tasks, Cloud Scheduler, Gmail Pub/Sub, Calendar HTTPS webhooks, Cloud Storage quarantine/scanning, SMS, and `pgvector` are feature-gated capabilities, not day-one provisioning requirements.
- Follow the [Workspace-first, cost-controlled rollout](docs/specs/architecture-decision-workspace-first-cost-controlled-rollout.md): reuse existing Workspace services, keep Sites as development, keep staging on demand, define both standalone and HA Cloud SQL profiles, and leave optional infrastructure modules disabled and unapplied until approved.
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
- **Verification is a CI run id, not a number you typed (the verification block,
  recorded August 5, 2026, after FIX-20 reported four failures on a `main` whose own
  run had one).** This is what item 5's "verification evidence" means; the Handoff
  requirements test bullet is satisfied by quoting this block in the handoff report,
  never by omitting it there. Every pull request body carries:

  ```
  ### Verification
  - **Run:** `<run-id>` <conclusion> — tests <n> / pass <n> / fail <n> / cancelled <n> / skipped <n> / todo <n>
  - **Main:** `<run-id>` <success|failure> — fail <n>
  - **Not mine:** each failure in Run that Main also shows, named; or `none`
  - **Coverage:** output of `git diff --stat <APPROVED-HEAD>..HEAD -- tests/`, or `no approved head yet`
  ```

  **Run** is this branch's own CI run; **Main** is `main`'s newest run whose conclusion
  is `success` or `failure`, because a `cancelled` run adjudicated nothing. Read both
  with `gh run view <id> --log | grep -E "# (tests|pass|fail|cancelled|skipped|todo) "`
  — six buckets, not three. Every number in the block therefore comes from CI and a
  reviewer re-derives it with one command; **no local test count is ever load-bearing**,
  which is what makes a degraded local environment harmless instead of persuasive.
  **Never write "pre-existing" in a PR body.** A failure may sit on **Not mine** only if
  it appears verbatim in
  `gh run view <main-run-id> --log-failed | grep -E "not ok [0-9]"`:
  cite it and you are believed, argue it and you are not. **Reporting a
  genuinely red `main` is never held against the PR that reports it** — FIX-20's DES-13
  catch was correct and saved a triage cycle across four pull requests. A **Coverage**
  diff that removes an assertion names the assertion that replaced it and shows the
  replacement still fails for the original defect, because green CI cannot detect a
  change that deletes its own detector. Any line that cannot be produced reads
  `blocked: <exact blocker>`, under the standing rule in `## Useful commands` that a
  command which cannot run is recorded rather than assumed; a missing line is a claim
  nobody made and is a review-blocking finding. The block describes exactly one head —
  the one `gh run view <id> --json headSha` prints for its **Run**. An agent pushing to
  a pull request it does not own, including a fix agent under stop-verify-resume,
  **appends a new block and leaves the author's block unedited**; a block naming a
  superseded head is stale rather than false, which is a finding against the pusher who
  failed to append and never against the branch owner. Nothing in this law authorizes
  editing another agent's pull request body.
- **The reviewed head must still be an ancestor (containment, recorded August 5, 2026,
  after `codex/set42-swr-doctrine` was rebuilt, dropped `a863e41`, and put a P1 back on
  an all-green pull request).** The approval-head law above says what an orphaned commit
  is worth; this says how anyone sees it. Run
  `git merge-base --is-ancestor <APPROVED-HEAD> <current head>` before merge and at the
  start of any review: exit 0 means the reviewed work is still there. A non-zero exit is
  the approval-head law firing — the branch is unreviewed work in its entirety, disclosed
  or not; this law adds a duty and never a cure. Before any verdict exists, the anchor is
  the head named by the newest verification block's **Run** id.
  **Fast-forward pushes stay legal and are expected**: one agent applying review fixes to
  another agent's branch preserves containment by construction, owes no disclosure, and is
  the mechanism that recovers from this incident — the target here is a head that no longer
  contains reviewed work, never collaboration. Whoever moved a head past containment posts,
  in the same working minute, a pull request comment carrying the before and after SHAs and
  the complete output of
  `git range-diff --no-patch origin/main..<before> origin/main..<after>` — **the whole
  table, not a grep for `< -:`**, because a rebuild that preserves a commit's subject
  reports as `!` and carries the same damage. If the before SHA cannot be fetched, that
  comment reads `blocked: <exact blocker>`, names every SHA that is still known, and goes
  to the owner the same minute. **Green CI is not evidence that nothing was lost:** the
  SET-42 rebuild also cut `tests/e2e/set42-swr-doctrine.spec.ts` from 328 lines to 187 and
  dropped both `/settings?section=google-workspace` visits, leaving an assertion that is
  vacuously true on the pages the spec still opens.

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
  `kimi/*`, `deepseek/*`). Never commit directly to `main`. The PR history doubles as the
  attribution log of which agent did what — keep the prefixes honest. All four prefixes
  carry the same server-side branch protection: force-push and branch deletion are
  blocked, no bypass, enforced even for the owner (recorded August 8, 2026, after a
  session continuing a `kimi/*` branch committed under an unconfigured identity and
  three different stories about who built what diverged — see the PR #340 disposition).
  A session picking up work on another agent's branch either pushes to its own
  agent-prefixed branch instead, or explicitly sets that agent's identity and says so in
  the PR body — never commit there under a default identity.
- **Pull requests are the only merge point.** The owner (Jason) reviews and merges;
  agents never merge their own or another agent's PR unless the owner explicitly
  delegates it for a named PR.
- **Never two agents in the same files at the same time.** Work is divided by packet:
  the status lines in the [agent execution plan](docs/ledger/agent-plan-architecture-workspace-and-setup.md)
  are the claim mechanism. A packet that is `In progress` or `In review` is owned —
  do not take it, and do not edit the files its branch touches. The
  `app/FloorOpsApp.tsx` single-file queue rule is the canonical example, and its queue
  order appendix is the claim list — a packet that adds a `FloorOpsApp.tsx` change must
  add itself there in the same PR. That slot scopes only what remains in the file: the
  app shell and navigation, Overview, Reports, Settings dispatch, and the record
  controller/data-fetch functions until a later extraction moves them. Modal/drawer
  overlays and all extracted record surfaces (`LeadsView`, `ClientsView`, `ProjectsView`,
  and `ScheduleView`) exit the queue permanently; work confined to those modules does not
  claim the `app/FloorOpsApp.tsx` slot.
- **A packet is available if and only if it has no status line.** Prose lists of
  "unclaimed packets" are historical narrative and have gone stale repeatedly; the status
  lines are the only dispatch authority. (The ledger guard also enforces heading grammar
  and rejects stale merged-PR references, but nothing makes prose availability lists true —
  which is exactly why they must not be dispatched from.)
- **Owner decisions have exactly one home.** AI-workstream decisions live in
  `docs/specs/ai-assistant-spec.md` §12; operating-model and record-editing decisions live in
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
  ledger is [`docs/ledger/nightly-review-2026-07-findings.md`](docs/ledger/nightly-review-2026-07-findings.md).
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
- **DeepSeek — implementer (added August 8, 2026):** a fourth build agent under every
  implementer law that governs Codex — packets exactly as written, one packet per draft
  PR, `deepseek/*` branches, its own clone, the post-merge ledger flip duty, and the
  prohibition on editing the criteria it is graded against. No senior or advisory track
  (that structure is Kimi-specific); DeepSeek claims only packets the orchestrator's
  dispatch names for it, same as Codex. Standing communication channel:
  [GitHub issue #345](https://github.com/OneStreamerNE98/FCI-Brett/issues/345) — the
  orchestrator posts instructions there as `@DeepSeek`-tagged comments for anything not
  tied to one open PR; PR-specific feedback stays on that PR's thread.
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
    [`docs/briefs/agent-reviewer-briefing.md`](docs/briefs/agent-reviewer-briefing.md) first. When live: findings post as PR comments
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
  (e.g. "Codex (agent)", "Kimi (agent)", "DeepSeek (agent)") so commit attribution
  matches the branch prefix. A commit on an agent-prefixed branch whose committer
  identity names a different agent is a review-blocking finding.
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

**Golden hashes.** The definition lives in the plan ledger's Global guardrail 7b — read that, not a summary. Short form: two SHA-256 digests in `tests/e2e/page-layouts.spec.ts` freeze the Overview and Reports markup; `npm run test:e2e` evaluates them against the live DOM, **and four Node suites additionally pin the digest constants byte-for-byte** (`ai04-today-view`, `fix15-toast-and-folds`, `nfix04-phone-polish`, `nfix06-tablet-band`), so editing a digest also fails `npm test`. A mismatch is a signal, not a chore. Regeneration is a sanctioned event available to ANY packet whose PR includes owner-approved before/after screenshots of both pinned pages at 1280 (with the change rationale) and updates the four additional pinning suites in the same commit. The named-packet restriction was lifted August 3, 2026 by owner decision under the standing law-lift rule (checklist 06); scope of the lift: the authority model only — the hashes, the pinned selectors, and the four-suite requirement are unchanged. Never paste a new digest in to make a suite pass.

## Environment traps that have each cost real work

These are not style notes. Each one has produced a wrong conclusion or destroyed work in this
repo, and each is invisible until it bites.

- **A failure you did not reproduce in a healthy environment is not a failure.** Before believing
  any test result, confirm the environment: `ls node_modules | wc -l` in the tree you are running
  from (a near-empty result invalidates the run). A degraded environment produces a cluster of
  unrelated-looking failures — `Cannot find module .../node_modules/@playwright/test/cli.js`,
  Playwright `webServer` timeouts, `ENOENT dist/.openai/drizzle` — and, worst of all, it
  reproduces the SAME wrong answer when you run it against `main`, so the check agrees with
  itself and is still wrong. That is why the verification block above requires a CI run id and
  why no local test count is load-bearing.
- **Never `npm ci` in a worktree, and never delete or follow a `node_modules` junction.** Scratch
  worktrees junction `node_modules` to the root clone; `npm ci` deletes the directory and
  `git worktree remove --force` (or `rm -rf`) follows the junction. This has emptied the root
  clone's `node_modules` four separate times, including during a READ-ONLY review. Use
  `npm install`. To remove a worktree: `cmd //c rmdir <worktree>
ode_modules` first (rmdir
  unlinks a junction without recursing), then `git worktree remove`. No `rm -rf` fallback, ever.
- **Exit-code masking — bitten three times.** `npm test | tail` and `&&`-chained greps return the
  LAST command's status, so a failing suite reads as exit 0. The dangerous shape is
  `node --test ... | grep -E "pass|fail" && git commit && git push` — the grep SUCCEEDS on a
  failing run because it matched the word "fail", and the push proceeds with a red suite. Never
  chain a commit or push behind a test command. Run tests, capture the status, check it, then
  commit as a separate step.
- **A PostgreSQL migration checksum lives in THREE places and they move together:** the registry
  entry in `app/platform/postgres/production-schema-migrations.ts`, the literal pin in
  `tests/production-schema-migrations.test.mjs`, and the reviewed duplicate in
  `app/platform/google-cloud/database-readiness.ts`. The third is caught only by a CI-only
  PostgreSQL-service test — **no deps-free local suite catches it**. After any checksum change,
  `grep -rn <old digest>` must return zero. Related: `mail_items` and other shared tables exist
  on BOTH PostgreSQL and Cloudflare D1, so a column addition is usually TWO migrations; D1 is the
  engine most live routes use, and a PostgreSQL-only migration ships columns production cannot
  write.
- **The e2e suite shares ONE simulation server** (`workers: 1`). `workspace_resources` is seeded
  once at db-prepare and the simulation reset deletes it without re-provisioning, so a spec that
  runs a real reset permanently wipes state later specs read. A spec exercising the real reset
  must restore the registry afterwards through the real simulation endpoints, with a
  self-checking verify.

## Security and data rules

- Never commit `.env`, `.env.local`, OAuth JSON credentials, client secrets, encryption keys, API keys, access/refresh tokens, production exports, or local databases.
- Use `.env.example` only for variable names and safe placeholders.
- Use records named `FCI TEST — DO NOT USE` for development verification.
- Keep employee login separate from the one company Google Workspace data connector.
- Enforce authorization on the server and inside data queries; hidden UI controls are not authorization.
- Treat Google `sub` as the stable external user identity and verify the signed Workspace `hd` claim for production login.
- Never weaken review-first Gmail filing or automatically send messages.

## Current implementation order

Use the status lines and dependency order in [`docs/ledger/agent-plan-architecture-workspace-and-setup.md`](docs/ledger/agent-plan-architecture-workspace-and-setup.md) for active backend, Workspace, and Settings work. Use the design-critique ledger for UI remediation and the task checklists for owner setup and acceptance. Pull requests and issues may mirror those ledgers, but they do not define a separate task sequence.

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
