# Moving this work into the Floor Coverings International Codex project

For handing the repository from one person's Codex installation to a coworker's Codex installation, use [`codex-to-codex-handoff.md`](codex-to-codex-handoff.md). That guide covers GitHub access, cloning, adding the local Codex project, onboarding verification, branch workflow, prompts, and handback requirements.

## What “moving the task” means

The application code and this Codex conversation are separate things:

- The **code** is the Git repository currently stored at `C:\Users\JasonGrass\Documents\Codex\2026-07-11\i-wa`.
- The **Floor Coverings International Codex project** is currently associated with `C:\Users\JasonGrass\OneDrive - Archetype Consulting\Documents\Floor Coverings International`.
- The **task** is this conversation and its history.

Codex does not currently provide a reliable one-click way to move this existing conversation into a different local project. Preserve the work by committing the repository, choosing one canonical code location, and starting the next task from the target project with the handoff prompt below.

## Recommended repository location

Keep the live development repository outside OneDrive. Node/Next.js repositories contain thousands of frequently changing files, symbolic links, build caches, and secrets that do not sync well through OneDrive.

Recommended canonical location:

`C:\Users\JasonGrass\Documents\Floor Coverings International\flooring-operations-app`

Use GitHub as the collaboration and backup mechanism. Use the OneDrive project folder for business documents, exported reports, training material, and a shortcut or text file containing the repository URL.

If you prefer to keep the existing repository location, that is also acceptable. Add the existing folder as a Codex project rather than copying it into OneDrive.

## Safe handoff procedure

1. Finish and commit all changes in the current repository.
2. Create a private GitHub repository owned by the business, for example `floor-coverings-international/flooring-operations-app`.
3. Push the current Git repository to that private repository.
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

> Continue development of the Floor Coverings International Operations application in this repository. First read `AGENTS.md`, `docs/20-user-product-and-architecture-review.md`, `docs/architecture-decision-production-platform.md`, `docs/architecture-decision-workspace-first-cost-controlled-rollout.md`, `docs/task-checklists/README.md`, `docs/ui-and-product-readiness-review.md`, and `docs/google-workspace-rollout-guide.md`. Preserve the current controlled development environment and existing user data. Verify the test suite and build before changing code. The next milestone is costed, unapplied Google Cloud infrastructure definitions: keep Sites/D1/R2 as development, make staging on demand, define standalone and regional-HA Cloud SQL profiles without selecting one, use zero-minimum/bounded-maximum Cloud Run, and leave Tasks, Scheduler, Pub/Sub, quarantine/scanning, SMS, and `pgvector` disabled. Use safe variables for open inputs and do not provision, deploy, migrate, connect Workspace, or change hosted configuration. Identity, sessions, capabilities, roles, project permissions, and the approved app-to-Google access matrix follow the accepted gates. Work in small tested commits and finish with verification evidence plus a data/security impact note.

## Sharing with another developer

1. Invite the developer to the private GitHub repository with **Write** access, not Admin access.
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

Store application secrets in the hosting platform's encrypted secret settings. Store business documents in the approved Google Shared Drive, not in Git.
