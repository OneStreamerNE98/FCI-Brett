# FCI Operations repository guidance

These instructions apply to the entire repository and are intended to give every AI agent (Codex, Claude) and human contributor the same operating context.

## Read first

Before changing code, read:

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

## Current product boundary

- The Sites/Workers/D1/R2 deployment is the controlled, single-user development environment and uses test data only.
- Production will use a small regional Cloud Run/Cloud SQL modular monolith, Secret Manager, Google Workspace OIDC, and application-owned authorization and audit controls. Cloud Tasks, Cloud Scheduler, Gmail Pub/Sub, Calendar HTTPS webhooks, Cloud Storage quarantine/scanning, SMS, and `pgvector` are feature-gated capabilities, not day-one provisioning requirements.
- Follow the [Workspace-first, cost-controlled rollout](docs/architecture-decision-workspace-first-cost-controlled-rollout.md): reuse existing Workspace services, keep Sites as development, keep staging on demand, define both standalone and HA Cloud SQL profiles, and leave optional infrastructure modules disabled and unapplied until approved.
- Preserve the current development deployment, Google Workspace test connector, and existing data unless the owner explicitly approves a migration or destructive change.
- Do not add scheduling, messaging, or AI document indexing before the production platform and authorization foundation is accepted.
- Do not admit a second user or store real client data until users, sessions, roles, project permissions, backup restoration, and audit controls pass acceptance.

## Required workflow

1. Start from an up-to-date, clean `main` branch.
2. Create an agent-prefixed branch: `codex/<short-feature-name>` for Codex, `claude/<short-feature-name>` for Claude.
3. Keep changes scoped and preserve unrelated user work.
4. Run the relevant tests during development and run `npm test` before handoff.
5. Open a pull request with a concise summary, verification evidence, and data/security impact note.
6. Do not deploy, change hosted configuration, migrate data, or merge to production without owner approval.

## Multi-agent coordination

Multiple AI agents work this repository from separate clones. Each agent is its own
"machine"; GitHub is the source of truth. The rules that keep them from colliding:

- **Pull first, every session.** Fetch and start from current `main` before any work,
  and pull again after the owner merges anything. Never build on a stale clone — a
  stale-based PR conflicts with everything.
- **One branch per agent per task, always agent-prefixed** (`codex/*`, `claude/*`).
  Never commit directly to `main`. The PR history doubles as the attribution log of
  which agent did what — keep the prefixes honest.
- **Pull requests are the only merge point.** The owner (Jason) reviews and merges;
  agents never merge their own or another agent's PR unless the owner explicitly
  delegates it for a named PR.
- **Never two agents in the same files at the same time.** Work is divided by packet:
  the status lines in the [agent execution plan](docs/agent-plan-architecture-workspace-and-setup.md)
  are the claim mechanism. A packet that is `In progress` or `In review` is owned —
  do not take it, and do not edit the files its branch touches. The
  `app/FloorOpsApp.tsx` single-file queue rule is the canonical example.
- **If your work unexpectedly needs a file another agent's open PR touches**, stop and
  flag it to the owner instead of racing the other agent to a conflict.
- **After any sibling PR merges**, re-check your open branch's mergeability against
  `main` and resolve documentation-ledger conflicts by keeping main's newer status
  wording while preserving your branch's content additions.

### Roles (owner-confirmed, July 21, 2026)

- **Claude (Fable) — orchestrator:** plans the work, authors and sequences the packets
  and ledgers, reviews every code PR before merge, and delivers the final review
  verdict. Reviews run as multi-lens agent fleets with adversarial verification;
  security-critical surfaces (authorization boundaries, OIDC/session/CSRF/consent
  code) are additionally read line-by-line by the orchestrator itself.
- **Codex — implementer:** builds the packets exactly as written in the plan ledger
  (why/do/accept), one packet per draft PR, and runs the complete post-merge ledger
  flip after each of its merges.
- **Owner (Jason) — merge authority and gates:** merges PRs (may delegate a named PR),
  and holds every owner gate: new scopes, API keys, billing, live resources,
  deployment, second user, real data.
- Neither agent merges the other agent's PR without the owner explicitly delegating
  that PR by number. Review findings are addressed by the branch's owning agent.

## Useful commands

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run lint
```

`npm test` includes the production build and the Node test suite. If a command cannot run, record the exact blocker rather than treating unverified work as complete.

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
- Tests/build/lint run and their results
- Data, security, configuration, and migration impact
- Remaining blockers or owner actions
- Whether deployment or external configuration was intentionally left unchanged
