# Codex-to-Codex project handoff

This guide lets a coworker use their own Codex installation against the same FCI Operations repository, with the same durable project instructions and development workflow.

OpenAI describes a Codex project as a project linked to a folder on the user's computer. The repository is therefore the shared collaboration layer: each coworker clones it locally and adds that local folder as their own Codex project. Conversation history and personal Codex settings do not automatically travel with the repository.

The GitHub repository is currently **public**, so anyone can read its source and documentation or fork it to propose a pull request. A coworker still needs explicit collaborator access to push an assigned branch directly to this repository as an authorized company contributor. The owner should decide whether to return it to private before operational configuration begins; public or private, secrets and real company/client data never belong in Git.

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

- [ ] Invite the coworker's GitHub account to `OneStreamerNE98/FCI-Brett` with contributor access so they can push assigned branches.
- [ ] Confirm they can clone the repository and that their intended write access works before sending the assignment.
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

> Open and follow the repository's `AGENTS.md`. Read `docs/codex-to-codex-handoff.md`, `docs/architecture-decision-production-platform.md`, `docs/architecture-decision-workspace-first-cost-controlled-rollout.md`, `docs/complete-product-and-google-cloud-architecture-audit.md`, `docs/google-cloud-runtime-foundation.md`, `docs/ui-and-product-readiness-review.md`, `docs/google-workspace-rollout-guide.md`, and `docs/task-checklists/README.md`. Run `git status --short --branch` and `npm.cmd test`. Summarize the current architecture, development safety boundary, cost/provisioning gates, active blockers, and recommended first implementation branch. Do not change files, hosted configuration, or external systems in this onboarding task.

The expected result is a read-only orientation report plus a passing baseline. The worker should not begin coding until the assigned milestone is confirmed.

## Completed production-runtime worker assignment

The source-only `codex/google-cloud-runtime-foundation` assignment now provides the fail-closed container/runtime boundary, validated private Cloud SQL configuration, bounded pools, separate migration and rehearsal commands, exact readiness, least-privilege source policies, and strict test-data core rehearsal. It does not containerize the employee application, provision infrastructure, apply roles or migrations, connect Workspace, or deploy. See [Google Cloud runtime foundation](google-cloud-runtime-foundation.md).

## Recommended next worker assignment

The infrastructure worker may begin with safe variables for open owner inputs. Those inputs remain hard blockers to applying definitions. Use this prompt:

> Create and work on `codex/google-cloud-infrastructure-definitions`. First read `AGENTS.md`, `docs/architecture-decision-production-platform.md`, `docs/architecture-decision-workspace-first-cost-controlled-rollout.md`, `docs/complete-product-and-google-cloud-architecture-audit.md`, `docs/google-cloud-runtime-foundation.md`, `docs/task-checklists/07-production-foundation-and-migration.md`, and `docs/task-checklists/08-operations-recovery-and-security.md`. Preserve the current Sites development environment. Add costed, reviewable, unapplied definitions for isolated project/credential/data boundaries, on-demand staging, a minimum production core, zero-minimum/bounded-maximum Cloud Run, private networking, Secret Manager references, service identities, backups/PITR, probes, monitoring, and budget alerts. Provide separate standalone/zonal and regional-HA Cloud SQL profiles without selecting one. Put Tasks, Scheduler, Pub/Sub, quarantine/scanning, SMS, and `pgvector` behind disabled-by-default feature flags or modules. Document official calculator inputs, the connection and revision-overlap budget, staging creation/teardown, role/grant denial checks, restore, migration rehearsal, and rollback/forward-fix evidence. Use safe variables for open owner inputs and make them apply-time blockers. Do not provision resources, add credentials, apply roles or migrations, connect Workspace, migrate data, deploy, or merge. Finish with a pull request containing verification evidence and a data/security impact note.

In parallel, the owner should complete `docs/task-checklists/06-20-user-operating-model-and-access.md`. PR #11 has merged the runtime foundation, so approval of the role/access matrix is the remaining owner gate for a source-only authorization worker to add simulated identities, scoped-query boundaries, and denial tests without enabling employee login or live data. Google Workspace OIDC and live authorization rollout must wait until the production foundation, tested migration/cutover path, and provider-neutral database/storage boundaries pass acceptance.

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

### The repository link shows 404 or a push is denied

- Confirm the repository URL is exact and the coworker is signed in to the intended GitHub account.
- For a push denial, confirm the coworker accepted the collaborator invitation and has contributor access.
- If the owner later makes the repository private, confirm the invitation has not expired.

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
