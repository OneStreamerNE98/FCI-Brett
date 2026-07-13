# Codex-to-Codex project handoff

This guide lets a coworker use their own Codex installation against the same FCI Operations repository, with the same durable project instructions and development workflow.

OpenAI describes a Codex project as a project linked to a folder on the user's computer. The repository is therefore the shared collaboration layer: each coworker clones it locally and adds that local folder as their own Codex project. Conversation history and personal Codex settings do not automatically travel with the repository.

Official references:

- [Working with ChatGPT Codex](https://openai.com/academy/working-with-codex/)
- [Get started with Codex](https://openai.com/codex/get-started/)
- [Introducing the Codex app](https://openai.com/index/introducing-the-codex-app/)

## What is shared

| Shared through GitHub | Not shared automatically |
| --- | --- |
| Source code and Git history | Existing Codex conversations |
| `AGENTS.md` repository instructions | Personal Codex settings and memories |
| Architecture, rollout, and task-checklist documents | ChatGPT account or subscription |
| Branches, commits, pull requests, and CI results | Local `.env.local` or credentials |
| Safe configuration examples | Hosted secrets and Google tokens |

Never share one ChatGPT login. Every coworker signs in to Codex with their own account and receives separate GitHub access.

## Owner: prepare the handoff

- [ ] Invite the coworker's GitHub account to `OneStreamerNE98/FCI-Brett`.
- [ ] Confirm they can see the private repository before sending setup instructions.
- [ ] Give contributor access, not repository-administrator access, unless administration is part of their job.
- [ ] Assign one bounded milestone and name the expected branch.
- [ ] Keep production secrets and deployment authority with the owner or approved administrator.
- [ ] Do not email a ZIP, copy `node_modules`, or provide `.env.local`.

## Coworker: install and clone

1. Install the Codex app and sign in with the coworker's own ChatGPT account.
2. Clone the repository to a normal local development folder outside OneDrive:

   ```powershell
   cd "$HOME\Documents"
   git clone https://github.com/OneStreamerNE98/FCI-Brett.git
   cd FCI-Brett
   ```

3. Confirm Git access and the starting state:

   ```powershell
   git remote -v
   git status --short --branch
   git log -3 --oneline
   ```

4. Install the locked dependencies and verify the baseline:

   ```powershell
   npm.cmd ci
   npm.cmd test
   ```

Do not continue implementation if the baseline build or tests fail. Record the output and ask the owner whether the failure is expected.

## Coworker: add the Codex project

1. Open Codex.
2. Select **Add project** or create a new project from a folder.
3. Select the local `FCI-Brett` repository folder—not its parent and not a OneDrive copy.
4. Name it **Floor Coverings International — Operations App**.
5. Start a new task inside that project.

The root `AGENTS.md` contains repository-wide instructions that Codex should apply automatically when working in this folder. Project decisions remain in `docs/` so another Codex instance can reconstruct the current state without the original conversation.

## First Codex task: onboarding verification

Paste this into the coworker's first task:

> Open and follow the repository's `AGENTS.md`. Read `docs/codex-to-codex-handoff.md`, `docs/architecture-decision-production-platform.md`, `docs/ui-and-product-readiness-review.md`, `docs/google-workspace-rollout-guide.md`, and `docs/task-checklists/README.md`. Run `git status --short --branch` and `npm.cmd test`. Summarize the current architecture, development safety boundary, active blockers, and recommended first implementation branch. Do not change files, hosted configuration, or external systems in this onboarding task.

The expected result is a read-only orientation report plus a passing baseline. The worker should not begin coding until the assigned milestone is confirmed.

## Recommended next worker assignment

After onboarding passes, use this prompt:

> Create and work on `codex/postgres-repositories`. First read `AGENTS.md`, `docs/20-user-product-and-architecture-review.md`, `docs/architecture-decision-production-platform.md`, `docs/production-postgresql-foundation.md`, and `docs/task-checklists/README.md`. Implement PostgreSQL client/project repository adapters against the existing provider-neutral ports and completed source-only schema. Add atomic actor-scoped request idempotency, activity evidence and outbox insertion in the same short record transaction, worker-safe outbox claim/complete/retry repository contracts, safe `bigint`/`numeric` parsing, Unicode-normalized client-name keys, and repository behavior tests against PostgreSQL 16. Keep provider/network calls outside transactions. Preserve the hosted D1 development environment and existing HTTP behavior. Do not provision Cloud SQL/Cloud Run, add credentials, migrate data, connect Workspace, build scheduling/messaging/AI, deploy, or merge. Finish with a pull request containing verification evidence and a data/security impact note.

## Daily collaboration workflow

1. Sync `main` before starting:

   ```powershell
   git switch main
   git pull --ff-only
   ```

2. Create the assigned branch:

   ```powershell
   git switch -c codex/<short-feature-name>
   ```

3. Keep each task on its own branch. Two coworkers should not work on the same branch.
4. Run relevant tests while working and `npm.cmd test` before handoff.
5. Push the branch and open a pull request into `main`.
6. Wait for GitHub CI and owner review before merging.
7. Pull the accepted `main` before beginning another task.

## Pull request handoff template

Use this structure in the pull request description:

```markdown
## Outcome

What changed and why.

## Verification

- [ ] `npm test`
- [ ] Additional route/integration/browser tests, if applicable

## Data and security impact

Schema, permissions, secrets, external services, migration, and rollback impact.

## Owner tasks

Non-secret configuration or decisions still needed. Never paste secret values here.

## Not changed

Production deployment, hosted secrets, and real client data remained untouched unless explicitly approved.
```

## End-of-task Codex handback prompt

Before the coworker ends a task, ask their Codex instance:

> Prepare a handback for another Codex instance. State the branch and commits, summarize every material change, list tests and results, identify schema/configuration/security impact, link the pull request, record unresolved blockers and owner tasks, and confirm whether deployment or external state was changed. Put durable project facts in the appropriate repository documentation rather than relying only on this conversation.

## Secrets and local configuration

- The repository may share `.env.example`; it must never contain real credentials.
- Each developer creates their own ignored `.env.local` with development-only values.
- Use separate development OAuth credentials and callbacks when Google integration testing is approved.
- Never share production Google passwords, OAuth secrets, encryption keys, access/refresh tokens, OpenAI keys, or client exports.
- Do not add the coworker to the hosted app allowlist until the owner approves application access separately from GitHub access.

## Conversation and business-context sharing

Codex project conversations are not the canonical record for this repository. Put architecture decisions, setup status, acceptance evidence, and handoff summaries in GitHub documents or pull requests.

A shared ChatGPT Project may be used separately for collaborative chats and uploaded business context when the company's plan and policies allow it. That does not replace the coworker's local Codex project or Git workflow.

## Troubleshooting

### The repository link shows 404

- Confirm the coworker accepted the GitHub invitation.
- Confirm they are signed in to the invited GitHub account.
- Confirm the repository remains private and the invitation has not expired.

### Codex cannot see the project instructions

- Confirm the selected Codex project folder is the repository root containing `AGENTS.md`.
- Pull the latest `main` and restart the task from that project.
- Do not select only `docs/` or a parent directory containing multiple unrelated projects.

### Tests work for the owner but not the coworker

- Confirm Node.js satisfies the version in `package.json`.
- Run `npm.cmd ci` from the repository root.
- Confirm no production-only secret is incorrectly required for the local simulation baseline.
- Share command output, never secret values.

## Handoff is complete when

- [ ] The coworker has their own Codex and GitHub accounts.
- [ ] The repository is cloned outside OneDrive.
- [ ] Codex is attached to the local repository root.
- [ ] `AGENTS.md` and required project documents were read.
- [ ] The baseline build and tests pass.
- [ ] The worker has a bounded branch assignment.
- [ ] Pull-request, review, CI, and secret-handling rules are understood.
