# Night 6b — Architecture & duplication re-run

**Run:** July 31, 2026 (solo re-run). **Target:** `origin/main` at
`5cf8e65`. **Method:** pure static — three independent lenses covering
EDIT-path duplication, task-adapter parity, and repository-wide writer/export
boundaries. No dev server, browser, captures, or Playwright.

## What ran

- Repeated-logic comparison across the five lead/project/client/contact/task
  edit paths, including server CAS/audit orchestration, conflict projections,
  and client re-apply flows.
- Method-by-method parity audit of the D1, memory, and PostgreSQL task
  repositories after AI-11(a)'s `inboxReview` composition and EDIT-08's
  `findById` read.
- Repository-wide `mail_items` creator/mutator census, including writes below
  API routes, checked against the AI-10 source guard and atomic rollback tests.
- Post-NFIX-03 runtime-export census, plus regression checks for the original
  N6-2 response helpers and N6-4 deleted exports.
- Import-direction refresh and dedup against every published night, the agent
  plan, the findings ledgers, and the open GitHub backlog before filing.

## What we found

| ID | Sev | Finding | Disposition |
|---|---|---|---|
| N6b-1 | P3 | Five EDIT surfaces independently implement the same patch/CAS/conflict state machine | Owner-gated refactor proposal; no behavior bug and no generic mega-helper proposed |
| N6b-2 | P3 | The `mail_items` writer census cannot see AI-11(a)'s two adapter-level mutators | NFIX-07 guard/docs correction; preserve the task transaction |
| N6b-3 | P3 | 23 post-NFIX-03 runtime declarations are live locally but unnecessarily exported | NFIX-07 modifier-only hygiene sweep |

Healthy findings worth naming:

- D1 and PostgreSQL agree on valid `inboxReview` acceptance, including the
  guarded review transition, task/activity write, and rollback behavior in one
  batch/transaction. The memory adapter deliberately fails closed because it
  has no mail-item store; it does not manufacture a non-atomic success.
- All three task adapters agree on filters, ordering, caps, update CAS,
  reference failures, audit behavior, and response DTOs. PostgreSQL's UUID
  storage rejects the domain's broader legacy task-id alphabet; that is a
  migration caveat, not a current app-created-task divergence because new IDs
  are UUIDs.
- The original eight N6-4 dead exports remain absent. NFIX-03's shared
  no-store/error/formatting homes remain adopted at the packet's pinned sites.
- The N6-3 selector families removed through FIX-17 remain absent from
  `globals.css`; the live `panel-header-subtitle` correction remains intact.
- N6-1 is still open and has grown from five to nine application services that
  import D1 directly. This is additional evidence for the existing owner-gated
  read-port proposal, not a duplicate finding.
- `mail_items` is intentionally multi-mutator (analysis reconciliation, Gmail
  filing retirement, simulation reset, and task-accept retirement); the
  analysis route remains the sole creator. No current writer bypasses the
  review-first invariant.

## Recommended

Dispatch NFIX-07 as a small source-hygiene packet: make the creator law and
approved mutator census mechanically honest, correct the AI-10 ledger wording,
and remove only the 23 unnecessary `export` modifiers. Keep task acceptance's
mail-item transition inside the task repository transaction.

Treat N6b-1 as an owner-gated design proposal. If accepted, extract only the
pure patch/conflict mechanics; entity authorization, disclosure rules, and
task recovery remain explicit at their current boundaries.

## Pastes issued

NFIX-07 is drafted in the findings ledger and ready for a normal Codex
review-and-merge packet. N6b-1 has no implementation paste pending owner
approval.

## Coverage honesty

This re-run was static by specification: no server, browser, screenshots, or
Playwright were attempted. Focused Node suites supplied existing contract
evidence, but no live PostgreSQL integration or D1-to-PostgreSQL legacy task-id
migration was exercised. The export census was lexical across `app`, `tests`,
and `tools` because a TypeScript compiler was not resolvable in the isolated
audit worktree; barrel and namespace imports were checked, while computed
dynamic access remains a weaker-method residual. The review compared the
merged EDIT and task paths in depth, not every UI component or CSS selector.
