# Fable review findings: pull requests #51–#57

Review date: July 20, 2026 · Reviewer: Claude Fable (multi-agent, adversarially
verified) · Input: [PR #51–#57 review handoff](pr-51-57-claude-fable-review-handoff.md) ·
Baseline: `main` after PR #58 (`c955d91`) · Follow-ups section revised July 20, 2026
after a completeness audit of the review record.

> **Snapshot scope:** review record and follow-up instructions, not a status ledger.
> Canonical status lives in the [agent execution plan](agent-plan-architecture-workspace-and-setup.md)
> and the [OIDC follow-up ledger](be04-oidc-review-and-followups.md).

## Verdict

**All seven PRs are acceptable as written. No P0 or P1 finding survived adversarial
verification.** Three P2 findings and six P3 nits were confirmed; the P2s and two P3s
were fixed directly on the PR branches during this review (commits noted on each PR).
The only merge blocker was mechanical: PR #58 rewrote ledger status lines after all six
main-based branches forked, so every one of them went `CONFLICTING` — conflicts confined
to documentation files, zero source or test conflicts. All six branches were updated
onto current `main` with main's ledger wording preserved.

| PR | Packet | Review outcome |
| --- | --- | --- |
| #51 | BE-09 | Acceptable. Blanket POST→same-origin+session-CSRF gate (method-based, structurally unbypassable); authorization (session→capability→scope→sensitive live recheck→fail-closed pre-audit) strictly precedes body parsing and repository work; closed project-field allowlist 400s KPI fields; exactly-one bounded Idempotency-Key with raw-header duplicate detection; `expiresAt` is retention metadata only; creator-only assignment; PM lead list empty; 5 new tests / 41 assertions prove replay-identical, changed-body 409, actor isolation, `{data}` envelope, scope filtering, CSRF + idempotency denials. D1 refactor preserves Sites behavior. |
| #52 | KPI-02 | Acceptable. Contract-value admin gating (write reject, read mask, non-cacheable) verified leak-free including UI state; migration 0012 strictly additive; formulas match the pinned definitions. P2 fixed on branch: category allowlist equality-pinned by a new test. P3 fixed on branch: estimate-accuracy fixture made falsifiable (mean vs aggregate now distinguishable). |
| #53 | BE-12 | Acceptable, zero findings. Inventory dispositions verified against the D1 schema; v2 null-only KPI keys enforced pre-connection; grants exact; cleanup bounded; evidence report leak-free. |
| #54 | OIDC-02 | Acceptable. Strict `iss` typing before allowlist; cookie parser tolerant of unrelated damage yet fail-closed on bare/empty/duplicate attempt cookie; residual 10-minute stateless-attempt boundary documented in doc + code comment; AAD/timing/expiry regions untouched; both changes independently mutation-sensitive. P2 fixed on branch: rebased over main's ledger edit (status-line conflict only). |
| #55 | OIDC-03 | Acceptable, zero findings. Verifier negatives falsifiable (nonce no longer auto-injected); dead `completionError` seam now used; persistence denial matrix complete; real-PG `FOR UPDATE` race test deterministic (lock-queued transactions, no sleeps); schema cleanup bounded. Stacked on #54 by design — do not merge first. |
| #56 | SET-10 | Acceptable. Payload exposes only masked account + bounded status/booleans; grantedServices derived independently, null in simulation; Office users neither render nor fetch; recorded-consent wording distinct from live health; CSS rule blast radius contained. P2 fixed on branch: workspace-mode payload now exhaustively key-pinned in tests (was simulation-only). |
| #57 | Brand assets | Acceptable. Both SVGs independently re-verified: no script/handler/foreignObject/external href/raster; sizes + SHA-256 match the handoff pins; shortcut metadata uses the supported string form; collapsed-desktop→mobile-drawer fix preserves navigation states; a11y correct. P3 fixed on branch: handoff-doc fallback-column wording corrected. |

## Cross-PR answers (from the handoff)

- **#51/#52/#53 KPI closed boundary:** internally consistent and fail-closed. Field
  names agree exactly across all three sides (camelCase API / snake_case columns /
  rehearsal keys); #51 uses a **closed allowlist** (not a denylist), so any future field
  is rejected by default; #53 rejects non-null KPI values before any connection.
  Note for KPI-04: production closure is enforced at exactly one layer (the router
  allowlist) — add a repository-layer guard when parity lands.
- **#54→#55 stacking:** safe and documented. #55 contains no #54 regression. Merge #54
  first, then retarget/rebase #55 onto main (expect a trivial OIDC-03 status-line
  conflict), rerun checks, then merge.
- **#56/#57 truthful state + accessibility:** yes at desktop and 390 px per focused
  suites; no invented provider-health or grant claims.
- **Overclaims:** none found. `cutoverReady` stays hard-coded false; migration 0012 is
  documented as not hosted-applied; no PR claims deployment, provider health, or parity.
- **Doc reconciliation:** the handoff's table is accurate; this review added one item —
  after PR #58, every branch needed the ledger rebase (now done).

## Findings fixed on the PR branches during review

| Fix | PR | Where |
| --- | --- | --- |
| Ledger rebases onto `main` post-#58 (keep main's status wording, preserve branch additions; tracking guard 6/6 green on every branch) | #51 #52 #53 #54 #56 #57 | docs/ledger files only |
| Category allowlist equality-pinned: new test asserts the reports and domain seven-value lists identical, with a source-of-truth comment on the reports copy (a production re-export was avoided because the bare-node test loader needs extensioned imports the Next build does not use) | #52 | `tests/flooring-kpis.test.mjs`, `app/features/reports/flooring-kpis.ts` |
| Estimate-accuracy unit fixture falsifiability (ratios 1.2/1.5, mean 1.35 ≠ aggregate 1.25) | #52 | `tests/flooring-kpis.test.mjs` |
| Branch's own KPI-02 ledger-pin regex updated to main's resolved status wording | #52 | `tests/flooring-kpis.test.mjs` |
| Workspace-mode connection payload exhaustively key-pinned in both live-mode tests | #56 | `tests/google-correctness-behavior.test.mjs` |
| Handoff asset-table fallback wording corrected to name the actual retained PNGs | #57 | `docs/pr-51-57-claude-fable-review-handoff.md` |
| #55 pre-emptively rebased onto the updated #54 base; the predicted OIDC-03 status-line conflict resolved with the newer wording | #55 | `docs/be04-oidc-review-and-followups.md` |

## Remaining follow-ups for Codex (non-blocking; fold into the named packets)

1. **KPI-03 (absorb):** two small honesty/consistency items in #52's surface, deferred
   because they change production behavior and deserve their own tests:
   - `app/features/reports/BusinessKpisPanel.tsx` (~line 79): Office users always see
     "Not yet captured on booked projects" under Estimate accuracy because the note keys
     on the server-masked (null) contract values; when `!isAdmin`, render a restricted
     note (e.g. "Contract-value capture details are restricted") instead of an
     affirmative claim that can be false. Assert it in the Office e2e journey.
   - `app/domain/project-creation.ts` (`normalizeProjectCreation`): explicit
     `estimatedValue: null` is rejected 400 by the range check while `squareFeet: null`
     and `contractValue: null` are accepted as absent — add the `!== null` guard and
     normalize to null like its siblings, plus one assertion.
2. **KPI-04 (note):** add a repository-layer rejection of KPI fields in the production
   project repository so the closed boundary is enforced at two layers, then remove
   both when parity lands. Also centralizes the category allowlist for PostgreSQL
   (CHECK constraint) — the reports/domain sides are equality-pinned by test; a true
   single-source refactor can land with KPI-04.
3. **Post-merge flip checklist — run the WHOLE list for each merged PR** (per the
   handoff's reconciliation table; packet map: BE-09→#51, KPI-02→#52, BE-12→#53,
   OIDC-02→#54, OIDC-03→#55, SET-10→#56; #57 has no canonical packet). Registering the
   PR in the guard alone will turn CI red — each flip must, in one commit:
   - (a) Set the packet status to `Complete — PR #NN, <date>.` in its canonical ledger,
     and reword every tracking-doc passage that still calls the PR a draft/in-review —
     including the "Open draft against `main`" checklist rows, the plan's start-now /
     Wave-2 queue text, and (for #54/#55) the OIDC ledger's
     "stacked on draft PR #54" wording.
   - (b) Update `tests/task-tracking-docs.test.mjs` in the same commit: add the packet
     to `mergedPlanPackets` (or, for #57 which has no packet entry, append 57 to the
     literal merged-PR list beside 48/49); remove the packet from `expectedPlanDrafts`;
     delete or update the explicit OIDC-02/OIDC-03 draft status pins (~lines 211–212)
     when #54/#55 flip; and update the pinned checklist prose, `reviewQueue`, and
     `startNow` snapshot assertions in the dashboard test so they describe the
     post-merge state.
   - (c) First flip only: generalize the guard's hardcoded Complete-status date regex
     "July 19, 2026" (e.g. `(July \d{1,2}, 2026)`) so later merge dates can register.
   - (d) KPI-02/#52 only: the branch's own ledger-pin regexes in
     `tests/flooring-kpis.test.mjs` (~lines 126–128) pin the "In review — draft PR #52"
     wording and the "now KPI-02 → KPI-03" queue text — update them in the same flip
     commit.
   - (e) After #54 merges: when #55 retargets to `main`, update #55's dependency wording
     (PR body and the OIDC-03 status line's "intentionally stacked on draft PR #54")
     before rerunning checks and merging.
   - (f) Do NOT touch the two dated snapshot docs: this file and
     `docs/pr-51-57-claude-fable-review-handoff.md` are intentionally absent from the
     guard's `trackingFiles` list. Do not add them to the guard and do not "reconcile"
     their historical draft-era wording — they record a point in time.
4. **TRK-02 · tracking-guard hardening (new small packet — add it to the agent plan
   ledger when claiming):** three verified blind spots in
   `tests/task-tracking-docs.test.mjs`:
   - The cross-file stale-reference scan's `badTerms` alternation omits `in progress`,
     so a tracking doc calling a merged PR "in progress" passes the scan (the
     per-packet status check catches it only for mapped packets). Add it.
   - `packetStatus()` captures only the first physical line of a `**Status:**` entry, so
     a wrapped status hides required phrases (loud false failure) and forbidden phrases
     (silent false pass). Capture the full status paragraph, or assert status entries
     are single-line.
   - The proximity scan collapses whitespace (its 120-char window crosses
     table/heading boundaries), stops at `.`/`;` (misses adjacent-sentence staleness),
     and matches only the literal `PR #NN` form — bare `#54` / `OIDC-02/#54` references,
     the dominant form in the checklists, escape it. Rework it to operate per line or
     per sentence and to also match bare `#NN`, or document these blind spots beside
     `badTerms`.
5. **Brand-asset note (optional, owner-approved only):** the full-logo SVG in #57 has
   fixed 1254×1254 dimensions, no `viewBox`, and an opaque off-white background; the
   review accepted it byte-for-byte. A transparent or `viewBox`-corrected source would
   be a future approved asset replacement — never an unreviewed mutation.

## Owner-judgment questions left open (for Jason; Codex should not decide these)

The handoff asked four questions that are business/product judgment, not defects. The
review accepted current behavior as reasonable; each is routed for explicit confirmation:

1. **#52 — booking event and units:** is project creation the correct durable booking
   event, and are whole dollars the right storage unit? (Confirm during KPI-03, before
   more reporting builds on them.)
2. **#52 — category taxonomy:** do the seven flooring categories cover the business
   without creating a false taxonomy? (Confirm during KPI-04, before the PostgreSQL
   CHECK constraint freezes them.)
3. **#53 — rehearsal format v1:** may format v1 be retired outright, or does a
   compatibility requirement exist? (Decide in the KPI-04/BE-12 follow-on; v2 is
   authoritative in #53.)
4. **#56 — stale details on refresh error:** should the connection-health card keep
   showing last-known details with a refresh error, or clear them? (Current behavior
   keeps them visible; revisit as a SET-10 usability follow-up if desired.)

## Recommended merge sequence

All branches are green-CI drafts on current `main` after the review fixes. Merge with a
merge commit, marking each ready first; re-verify sibling mergeability after each, and
after a shared-file sibling lands (#52/#57 share `app/FloorOpsApp.tsx`; #52/#56 share
`app/globals.css`) rerun the survivor's focused browser tests, not just the merge check:

1. **#54** (OIDC-02 — security hardening, smallest)
2. **#55** (OIDC-03 — after retargeting/rebasing onto main post-#54; completes the
   OIDC-01/02/03 precondition set for live employee login, which remains owner-gated)
3. **#51** (BE-09 — unlocks BE-10/BE-14)
4. **#53** (BE-12 — rehearsal v2)
5. **#52** (KPI-02 — unlocks KPI-03; expect ledger-only rebases as siblings land)
6. **#56** (SET-10)
7. **#57** (brand assets — independent, any time; carries the review handoff doc)

## Review coverage and honesty

Eleven review lenses ran (two per large PR, one per small PR, two cross-PR auditors);
every P0–P2 candidate went through adversarial refutation and only the three P2s
survived. PR #51's two lenses were completed by the lead reviewer directly after
subagent session limits interrupted the fleet twice; its conclusions rest on direct
line-by-line reading of the router, authorization service/policy, shared operations,
D1 refactor, and all five new tests. Not re-run locally: full `npm test` per branch
(GitHub CI is authoritative and green on every reviewed head); mutation claims in #54/#55
were hand-traced (3 of 22 spot-verified), not mechanically re-executed.
