# Enhancement briefs (owner planning, not packets)

The documents in this directory are owner planning briefs, NOT packets — they
carry no status lines, the dispatch law ignores them, and packets are filed
from them at wave start. Several have since been partially superseded by filed
packets (SET-40/41/42, WS-21, DES-12/13/14/15, NFIX-07/08) — the ledger
([`agent-plan-architecture-workspace-and-setup.md`](../ledger/agent-plan-architecture-workspace-and-setup.md))
wins on conflict.

## The filing queue (routing recorded August 4, 2026)

Every remaining brief-only item, with the wave whose start files it as a packet and the
source that carries its content. This queue is the routing record: nothing the owner has
requested lives outside a filed packet, this queue, or an owner checklist row.

| Files at | Item | Content source |
| --- | --- | --- |
| Wave 5 | Presentation mode (clean full-screen display; conditional-render design per the architecture review; the Google Workspace stage-collapse folds in) | `enhancements-sync-buttons-nav-and-ios-bug.md` item 6 |
| Wave 5 | Small-UI batch — ONE packet: rearrangeable nav icons, collapsed-rail border removal, dev-badge visibility toggle (badges only; simulation itself is never a UI toggle) | `enhancements-sync-buttons-nav-and-ios-bug.md` items 4/5 + line ~285 |
| Wave 4 (docs) | Stale-tenant write-fencing packet for the WS-20 wave (Postgres uses `integration_connections`; disconnected-mode flows stay open; the WS-17 id-stability pin question is settled at design time) | PR #288 disposition comment + preserved commit SHAs |
| Wave 6 | Emails update records (review-first; must close AI-R10 inside it) | `enhancement-emails-update-records.md` |
| Wave 6 | Agent write actions (permission check + confirm-diff; v1 scopes around the durable-identity blocker) | `enhancement-agent-write-actions.md` |
| Wave 6 | Meet-link checkbox on meetings | recorded owner request (July) — filed from this row |

Grid views/filtering and the multi-mailbox plan are already fully superseded by filed
packets (DES-15 · WS-20/WS-21/SET-41). The usability wave (DES-16/17/18) filed
August 4 from the adoption review.
