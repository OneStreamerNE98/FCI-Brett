# Night 7 — Code correctness

**Run:** July 25, 2026 (co-run with Night 1 under the owner-approved pairing
rules — shared kickoff, combined publication). **Target:** `origin/main`
post-#196. **Method:** static — three Opus lenses (domain/application
computation, API route correctness, client-state + synthesis), every P1/P2
adversarially verified with executed-proof preference (verifiers run suites
or write throwaway repros).

## What ran

- Deep read of `app/domain` + `app/application` computation (timezone math,
  money, stage transitions, KPI aggregation, fingerprints).
- Route sweep of `app/api/v1/**` for validation, error-path, bounds,
  partial-failure, and gate-consistency defects (NFIX-03/BE-16/AI-04 zones
  excluded as in-flight).
- Client-state pass over FloorOpsApp + extracted assistant/inbox/settings
  components (stale-after-mutation, load races, optimistic desyncs).

## What we found

**Zero P1/P2 survived verification** — the computation core held up. Eight
P3s filed:

| ID | Sev | Finding | Disposition |
|---|---|---|---|
| N7-1 | P3 | filing-rules mutations office-gated while every sibling settings route requires admin (core confirmed; severity-refuted from P2 — API-only, trusted insiders, review-first impact) | NFIX-05 |
| N7-2 | P3 | Revenue-per-sq-ft is an average of per-project ratios, not aggregate ÷ aggregate | Verified intentional — `docs/flooring-kpis.md` defines exactly this formula |
| N7-3 | P3 | Booked value/count + average job value include cancelled projects | Verified intentional — matches the documented booking/average definitions |
| N7-4 | P3 | Win-rate-by-source splits rows on raw casing while status is normalized in the same loop | NFIX-05 |
| N7-5 | P3 | DirectorySyncPanel renders "Last synced" as raw epoch milliseconds | NFIX-05 |
| N7-6 | P3 | Meeting POST coerces unknown meetingType to "other"; far-off dates accepted (direct-API surface only) | Note-only |
| N7-7 | P3 | refreshDirectoryData lacks the load-generation guard its three sibling loaders use (transient stale-snapshot race) | Fold into FIX-15 |
| N7-8 | P3 | Optimistic meeting prepend ignores meeting_at DESC order (transient) | Fold into FIX-15 |

Verified clean along the way: the three existing load-generation guards,
toast-timer cleanup, mobile-nav focus trap, optimistic project updates
re-syncing selectedProject, the ask-loading Q-race guard, and the inbox
loadedBucket guard.

## Recommended

NFIX-05 is dispatchable immediately (zone clear of all open lanes); its
win-rate normalization is a formula refinement, so the packet carries the
`docs/flooring-kpis.md` definition update + pure-helper tests in the same PR
per that document's rule. N7-2/N7-3 resolved as documented intended behavior
(the KPI source of truth defines both formulas exactly as coded) — mention to
the owner only as "revisit the definitions if you ever want different
semantics." N7-7/N7-8 ride FIX-15's FloorOpsApp pass rather than opening a
competing lane in the same file.

## Pastes issued

NFIX-05 drafted and zone-checked (amended after automated review to carry the
KPI-definition update). N7-2/N7-3 closed as verified-intentional — no paste,
no pending decision.

## Coverage honesty

Not read by any lens: the page wrappers (leads/clients/projects/reports/
schedule), management/access, GoogleWorkspacePanel beyond L720 (Night 8's
zone), the workspace blueprint/defaults/drive-actions cards, features/maps,
ProjectSegmentSelector, repo internals, CSS, and tests-as-subject. Lens B's
candidate on filing-rules was the only P2 candidate; its refutation confirmed
the core facts and reduced severity only.
