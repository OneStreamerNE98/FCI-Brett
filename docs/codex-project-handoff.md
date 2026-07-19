# Moving this work into the Floor Coverings International Codex project

For handing the repository from one person's Codex installation to a coworker's Codex installation, use [`codex-to-codex-handoff.md`](codex-to-codex-handoff.md). That guide covers GitHub access, cloning, adding the local Codex project, onboarding verification, branch workflow, prompts, and handback requirements.

## What “moving the task” means

The application code and this Codex conversation are separate things:

- The **code** and the **Floor Coverings International Codex project** currently use the same repository root: `C:\Users\JasonGrass\OneDrive - Archetype Consulting\Documents\Floor Coverings International`.
- The **shared Git history** is in [`OneStreamerNE98/FCI-Brett`](https://github.com/OneStreamerNE98/FCI-Brett), which is currently public.
- The **task** is this conversation and its history.

Codex conversations do not replace the repository handoff. Preserve durable work by committing it, pushing the assigned branch, and starting the next task from one canonical local clone with the handoff prompt below.

## Canonical repository location

The current OneDrive-based repository root above is the owner's selected canonical local clone. Do not move it or create a second editable copy during an active task. OneDrive synchronization can conflict with Git or build output, so stop and reconcile the working tree if unexpected duplicate, lock, or conflict files appear.

GitHub is the collaboration and handoff layer. A coworker should clone the existing repository once to a normal local development folder and select that repository root in Codex. The coworker does not need the owner's absolute local path.

## Safe handoff procedure

1. Finish and commit all changes in the current repository.
2. Confirm the remote is the existing [`OneStreamerNE98/FCI-Brett`](https://github.com/OneStreamerNE98/FCI-Brett) repository.
3. Push the assigned branch to that repository and open a pull request. Because the repository is public, anyone may read it, but only an authorized collaborator may push. The owner should decide whether to make it private before operational configuration begins.
4. In Codex, open **Projects** and add the canonical local repository folder as a project.
5. Name the project **Floor Coverings International — Operations App**.
6. Add the business planning folder as project context only if needed; do not make two editable copies of the source code.
7. Start a new task in that project and paste the handoff prompt below.
8. Attach or reference these files in the new task:
   - `docs/ui-and-product-readiness-review.md`
   - `docs/google-workspace-rollout-guide.md`
   - `docs/meeting-notes-and-otter.md`
   - `docs/collaboration-and-sharing.md`
9. Confirm the new task can run `npm.cmd test` and `npm.cmd run build` before making more changes.

## Handoff prompt for the new Codex task

Copy and paste this into the first task inside the Floor Coverings International operations-app project:

> Continue development of the Floor Coverings International Operations application in this repository. First read `AGENTS.md` and every file in its **Read first** list, including `docs/agent-plan-architecture-workspace-and-setup.md`. Preserve the current controlled development environment and existing user data. Verify the test suite and build before changing code. Take the next open packet from the agent plan's status lines and dependency order; use the design-critique ledger for UI remediation and the task checklists for owner actions. The Google Cloud infrastructure definitions, production-persistence boundary, and authorization simulation already exist in source, so do not recreate them. Keep optional modules disabled and do not provision, deploy, migrate, connect Workspace, or change hosted configuration without the recorded approval. Work in small tested commits and finish with verification evidence plus a data/security impact note.

## Sharing with another developer

1. Invite the developer to `OneStreamerNE98/FCI-Brett` with **Write** access, not Admin access. Public read access does not grant push access.
2. Ask them to clone the repository to their computer; do not email a ZIP and do not share `node_modules`.
3. Give them `.env.example`, never `.env.local`, OAuth client secrets, encryption keys, or production tokens.
4. Create separate development OAuth credentials for local callbacks if the developer needs Google integration.
5. Add the developer's Workspace email to the test allowlist only after their access is approved.
6. Require feature branches and pull requests before merging to the protected main branch.
7. Keep production deployment and secrets limited to the owner or an approved administrator.

## Suggested Git workflow

- `main`: last accepted release.
- `codex/<short-feature-name>`: Codex or developer feature branches.
- Pull request: tests, build, screenshots for UI changes, and a short data/security impact note.
- Tag accepted releases as `v0.19`, `v0.20`, and so on.

## Do not copy these items

- `.env`, `.env.local`, OAuth JSON credentials, API keys, or encryption secrets.
- `.next`, `node_modules`, build output, or local database files.
- Personal Gmail tokens or exported production client information.

For the Sites development environment, store application secrets in the ChatGPT Sites runtime environment settings and mark them as secrets. Production secrets belong in Google Secret Manager. Store business documents in the approved Google Shared Drive, not in Git.
