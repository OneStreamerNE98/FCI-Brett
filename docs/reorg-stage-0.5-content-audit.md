# Docs Content Audit — Reorg Stage 0.5 (August 7, 2026)

> Pre-move content reconciliation for the docs restructure plan. Four parallel audit
> agents read every non-ledger doc in `docs/` plus the four packet ledgers, ran a
> packet-level dedupe sweep across all ledgers and both August review docs, and built
> an inbound-link inventory. This audit names the authoritative doc per topic and the
> disposition of every other doc BEFORE any file moves. Location stages (1–6 of the
> reorg plan) must execute against these dispositions, not against the raw file list.

**Method:** 4 read-only audit agents, fixed per-file protocol (purpose, date signals,
self-declared status, ledger?, test pins, overlap, disposition + evidence), plus two
mechanical sweeps (packet dedupe; inbound links). Files audited: 45. Every pin claim
verified by grep against `tests/`.

---

## 1. Headline findings

1. **The corpus is healthier than feared on content agreement — the duplication is
   structural, not contradictory.** No two docs were found to disagree on facts (roles,
   architecture decisions, KPI formulas, access policy all cross-checked consistent).
   The problem is *the same content restated in 2–4 places*, which is what let the
   version-40 false claim live in 6 places across 3 files (fixed in PR #334).
2. **Eight docs are dispositions other than KEEP** (7 ARCHIVE, 1 remove). Details in §3.
3. **All five packet ledgers are load-bearing and test/guard-pinned. Do not merge or
   delete them.** Reorg stage 5 must move them as units.
4. **The August 5 review (untracked, never committed) is fully subsumed.** Every one of
   its confirmed findings either has a ledger packet already, was rejected by the
   Aug 6 adversarial validation, or is recorded as a dispatch gap in §6 below. The
   Aug 6 review is the canonical August review state. **No merge is needed — the Aug 5
   file can simply be deleted.** Its doc-hygiene uniques are preserved in §6.
5. **The rollout-guide / checklists / settings-guide layering is intentional**
   (procedure → validation → status board → user manual) and heavily test-pinned.
   Consolidating it is high-risk, low-value. Leave the structure; prune only the
   triple-restated env block (checklist 03 can link instead of restate).
6. **The Aug 6 code review has ZERO dispatch gaps** — its own disposition table maps
   every confirmed finding to a packet (NFIX-12…25, DES-14/17, FIX-11). Impressive
   discipline; the gap analysis below applies only to the Aug 5 review.
7. **The single worst breakage point in the whole reorg is the agent-plan ledger
   itself: 25 inbound markdown links from 27 files** (§7). Stage 5 needs a link-rewrite
   in the same commit, not just the 22 test pins.

## 2. Cluster verdicts

### Cluster A — review/findings (14 docs)
- **AUTHORITATIVE (keep, pinned):** full-review-2026-07-21, full-review-2026-07-24,
  nightly-review-2026-07, be04-oidc-review-and-followups, design-critique-fix-plan,
  infohint-audit-2026-07-24, complete-product-and-google-cloud-architecture-audit
- **KEEP:** code-review-2026-08-06 (canonical August review state),
  independent-audit-2026-07-30, 20-user-product-and-architecture-review
- **REMOVE:** full-review-2026-08-05 (untracked, unpinned, subsumed — see §1.4/§6)
- **ARCHIVE:** development-section-audit, pr-51-57-fable-review-findings,
  ui-and-product-readiness-review (pinned — unpin in same commit)

### Cluster B — handoffs (5 docs)
- **AUTHORITATIVE:** codex-to-codex-handoff (agent onboarding)
- **KEEP:** brett-handoff (unique human-admin audience), agent-reviewer-briefing
- **ARCHIVE:** codex-project-handoff (self-declared historical, live successor exists),
  pr-51-57-claude-fable-review-handoff (completed one-shot assignment snapshot)

### Cluster C — access model (4 docs)
No drift; all four agree exactly on roles, sessions, invitations.
- **AUTHORITATIVE:** administration-and-access-plan (design of record),
  06-20-user-operating-model-and-access (owner decision ledger)
- **KEEP:** 04-staff-login-and-permissions (pinned impl checklist),
  20-user-product-and-architecture-review (pinned)
- **Trim candidate:** role-policy table restated in 4 files — 04 and the review doc
  could link to the two authoritative sources instead.

### Cluster D — production platform (7 docs)
Genuinely separate concerns on one dependency chain; the two ADRs do not contradict
(workspace-first amends, does not replace, production-platform).
- **AUTHORITATIVE:** both architecture-decision docs, production-postgresql-foundation,
  production-postgresql-repositories, production-persistence-boundary,
  google-cloud-runtime-foundation
- **KEEP:** development-d1-schema-migrations (sole dev-D1 doc)
- **Trim candidate:** cross-summary preambles in the four foundation docs; cost/scale
  restated in runtime-foundation. Trim only if drift appears.

### Cluster E — Workspace guides/setup (9 docs + checklist dir)
Intentional layering (procedure → validation → status → manual). Heavily pinned.
- **AUTHORITATIVE:** google-workspace-rollout-guide, google-workspace-organization,
  google-workspace-watch-and-queue-design, settings-guide (verified: describes the
  REDESIGNED settings UI — no contradiction with settings-redesign-spec)
- **KEEP:** everything else, including all of task-checklists/
- **Trim candidate:** env-var block restated 3× (guide Part 10, testing doc,
  checklist 03) — checklist 03 should link.

### Cluster F — specs and misc (12 docs)
- **AUTHORITATIVE:** ai-assistant-spec, dashboard-design-spec, flooring-kpis,
  request-rate-limiting, authorization-simulation
- **KEEP:** settings-redesign-spec (add "implemented" banner),
  dashboard-workspace-setup-design (§3 UX superseded by the redesign spec's four-stage
  flow — add a one-line banner), collaboration-and-sharing, meeting-notes-and-otter,
  google-chat-notifications, google-integration-opportunities
- **ARCHIVE:** portable-record-creation (completed-slice record, stale forward section,
  no pins), pre-workspace-development-plan (superseded by agent-plan ledger +
  checklists; pinned at task-tracking-docs.test.mjs:324,413 — unpin in same commit)
- **README.md:** accurate except two missing entries — BOARD.md and
  agent-reviewer-briefing.md. Add them (stage 6 rewrites the README anyway).

## 3. Disposition summary (the stage-0.5 deliverable)

| Disposition | Files |
|---|---|
| AUTHORITATIVE (25) | full-review-07-21, full-review-07-24, nightly-review-07, be04-oidc, design-critique-fix-plan, infohint-audit-07-24, complete-product-audit, codex-to-codex-handoff, administration-and-access-plan, 06-20-user-model, both ADRs, production-postgresql-foundation, production-postgresql-repositories, production-persistence-boundary, google-cloud-runtime-foundation, rollout-guide, workspace-organization, watch-and-queue-design, settings-guide, ai-assistant-spec, dashboard-design-spec, flooring-kpis, request-rate-limiting, authorization-simulation |
| KEEP (14) | code-review-08-06, independent-audit-07-30, 20-user-review, 04-staff-login, development-d1-schema-migrations, brett-handoff, agent-reviewer-briefing, testing-and-google-workspace-setup, google-integration-opportunities, google-chat-notifications, meeting-notes-and-otter, settings-redesign-spec, dashboard-workspace-setup-design, collaboration-and-sharing, README |
| ARCHIVE (7) | development-section-audit, pr-51-57-fable-review-findings, ui-and-product-readiness-review*, codex-project-handoff, pr-51-57-claude-fable-review-handoff, portable-record-creation, pre-workspace-development-plan* (* = test-pinned: unpin in the same commit as the move) |
| REMOVE (1) | full-review-2026-08-05 (never committed; delete working-tree file) |

**Archive mechanics for reorg stage 2:** all 7 go to `docs/archive/`. For the two pinned
ones, the pin update rides in the same commit (prose and pin move together — the plan's
own rule). Every archived file gets a one-line top banner:
`> Archived August 2026 — superseded by <successor>; retained for history.`

## 4. Packet-level dedupe sweep (across all ledgers + both August reviews)

**Confirmed absorptions — already correctly marked, no action:** FIX-08→DES-05,
FIX-14→SET-06, FIX-16→SET-06, NFIX-11→DES-17.

**Suspected partial overlaps — coordinate, don't merge (owners should read each other
before dispatch):**

| Pair | Shared ground |
|---|---|
| FIX-15 (Complete) ↔ DES-17 (open) | single-slot `notify()` toast — FIX-15 shipped scoped suppression, DES-17 owns the full queue |
| NFIX-03 (Complete) ↔ FIX-12 (open, Wave R4) | per-route response preamble / no-store helper consolidation — FIX-12's residual sweep re-walks NFIX-03 ground |
| FIX-04 (Complete) ↔ NFIX-16 (open) | e2e waits-that-lie hygiene — NFIX-16 is the Aug 6 re-filing of the same defect class |
| FIX-04 ↔ NFIX-09 (in progress) | both `ci.yml` concurrency defects — distinct fixes, same workflow file |
| NFIX-08 ↔ HINT-01 | tooltip `visibility` CSS in globals.css — HINT-01's generalization could regress NFIX-08's hypothesis; coordinate the globals lock |
| NFIX-04 ↔ DES-02/DES-04 | touch-target sizing |
| NFIX-06 ↔ DES-19/DES-20 | tablet-band fixes vs systemic responsive rebuild of the same bands |

**Checked and cleared (NOT duplicates):** FIX-13 vs NFIX-19 (same settings stage-4
surface, different defects).

## 5. Dispatch gaps (findings with NO packet home)

**code-review-2026-08-06: none.** Every confirmed finding dispositioned to a packet.

**full-review-2026-08-05 (never packetized) — the gaps, preserved here before the file
is removed:**

| Finding | One-liner |
|---|---|
| C5 | E2E serial single-worker CI timeout risk (parallelism unowned) |
| C7 | Simulation-reset leak enforcement (lint rule blocking raw resets) |
| C9 | No `next/image` adoption (2 raw `<img>` tags) |
| C10 | Claude-vs-Fable orchestrator identity contradiction (AGENTS.md vs FABLE-REVIEW-PACKAGE.md) |
| H-S4 | No middleware layer / centralized edge concerns |
| H-P6–P10 | No memoization on list primitives; D1 `activity_events` missing indexes; `duplicateClientName` full-table scan; force-dynamic on all pages; empty `next.config.ts` |
| H-C13–C15 | Append-only triggers block admin maintenance; zero React component unit tests; mock-auth e2e never exercises real OIDC flow |
| H-C17–C20 | No service worker/PWA; no health-check endpoint; CSP divergence Worker vs Cloud Run; Vite SSR shared-server risk |
| M-S1–S5, S7 | Admin-field PATCH re-check; financial/raw-field list exposure; path-param validation; assistant PII to OpenAI; PII in development-access endpoint |
| M-C10–C19 (subset) | `Status` aria-label; PG isolation ceiling; brittle source-regex tests; zero server actions; no bundle analyzer |
| M-D20–D26 + Doc-Consistency | docs-index omissions and stale-doc claims (partially fixed by PR #334 + this audit) |

**Recommendation:** do NOT bulk-packetize these. Stage 5's ledger consolidation should
triage them with the A3 evidence rule (file:line or it doesn't get filed). The M-D/doc
items are largely resolved by this audit + PR #334 + the reorg itself.

## 6. Inbound link inventory (stage 3–5 breakage map)

Top most-linked-to docs files, all of which the reorg plan moves:

| Target | Inbound links | Destination per plan |
|---|---|---|
| agent-plan-architecture-workspace-and-setup.md | **25 (from 27 files)** | ledger/ |
| google-cloud-runtime-foundation.md | 15 | specs/ or guides/ |
| architecture-decision-workspace-first-cost-controlled-rollout.md | 15 | specs/ |
| production-persistence-boundary.md | 11 | specs/ |
| production-postgresql-repositories.md | 9 | specs/ |
| authorization-simulation.md | 9 | specs/ |
| google-workspace-rollout-guide.md | 8 | guides/ |
| production-postgresql-foundation.md | 7 | specs/ |
| complete-product-and-google-cloud-architecture-audit.md | 7 (one is an anchor link) | specs/ |
| design-critique-fix-plan.md | 6 | ledger/ |

**Implications the plan currently misses:**
1. The plan greps `tests/` before moves but says nothing about these markdown links.
   Every move stage must rewrite inbound links **in the same commit** (prose, pin, AND
   link move together).
2. The specs/ cluster cross-links itself — moving one production doc without its
   siblings breaks sibling-relative links. Move them as a unit.
3. Relative links OUT of docs into code (`../infrastructure/postgres/least-privilege.sql`)
   break when a file moves deeper. These are invisible to a `](docs/` grep — the move
   script must also rewrite `](../` targets.
4. README (root) has ~20 `](docs/…)` links, AGENTS.md has 8, docs/README.md has 34
   outbound. All three need same-commit rewrites at every move stage.
5. The complete-product-audit link from README uses a `#heading-anchor` — a move plus
   any heading rename silently breaks it. Move without renaming headings.

## 7. Recommendations folded back into the reorg plan

1. **Stage 2 (archive) executes against §3, not a fresh grep** — 7 files, 2 with pins.
2. **Add banners during stage 2** (archived files) and for the two superseded-section
   specs (settings-redesign-spec "implemented"; dashboard-workspace-setup-design §3).
3. **README gap fix now:** add BOARD.md + agent-reviewer-briefing.md.
4. **Delete the untracked full-review-2026-08-05 file** once this audit is merged (its
   gaps are preserved in §5).
5. **BOARD freshness tax:** path-filter the freshness check to runs where the diff
   touches a ledger file, before stage 2 opens more PR surface. (Demonstrated: PR #333
   failed once and #332 needed a regen cycle for exactly this reason.)
6. **Ledger inventory guard:** the freshness test should also fail when a
   packet-structured findings doc exists but isn't in the generator's list — the plan's
   "four ledgers" inventory was already stale the day it was written.
7. **Link-rewrite rule for stages 3–5** per §6, including `](../` outbound links and
   heading-anchor preservation.
8. **Deletion policy for archive/:** archive is terminal; deletion only when a doc is
   unpinned AND its successor carries its content — otherwise archive/ becomes a second
   graveyard nobody greps.
9. **"GitHub restructure"** in the plan title is never scoped in the body — either
   define it (issues/labels for packet dispatch?) or rename the plan part.

## 8. What this audit deliberately did NOT do

- No content edits to any audited doc (banners and trims are stage-2/3 work, executed
  after owner/orchestrator sign-off on these dispositions).
- No packet-body edits in any ledger.
- No deletion of full-review-2026-08-05 yet — it stays in the working tree until this
  audit merges (§7.4), so its content remains inspectable during review.
