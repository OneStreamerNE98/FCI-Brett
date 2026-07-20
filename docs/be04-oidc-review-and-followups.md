# BE-04 Workspace OIDC — post-merge security review and follow-up packets

Date: July 19, 2026 · Status reconciled: July 20, 2026 · Reviews merged PR #38
("Add Workspace OIDC employee login") and PR #48 (OIDC-01 callback compatibility) on
merged `main` baseline `cfe1a5d` · Also records the resolved PR #41 KPI-01 test collision,
the completed OIDC-04 documentation reconciliation in PRs #49/#50, OIDC-02/OIDC-03
completion in PRs #54/#55, and their status reconciliation in PRs #60/#62.

This is a Codex-ready follow-up ledger. Each packet is one agent work packet with the same
shape as `docs/agent-plan-architecture-workspace-and-setup.md` (why / files / steps /
acceptance / severity / deps). Follow that plan's **Global guardrails** and the repo
`AGENTS.md`. Update each packet's status line in this file on start and on merge.

## Review verdict

**The BE-04 implementation is strong and does not need a rewrite.** Independent adversarial
review (2 of 5 dimensions completed before an infra limit; the two most security-critical —
OIDC protocol and policy/tests — both finished, and the highest-impact findings were
re-verified by hand against the code). The token verifier is textbook: signature verified
against Google's JWKS **before** any claim is read, `alg` pinned to RS256 with `kty=RSA`
(no alg/HMAC confusion), `jku`/`x5u`/`crit` rejected, canonical base64url enforced,
`state`/`nonce`/PKCE bound in an AES-256-GCM AAD cookie with timing-safe comparison, and
**`hd` enforced against the signed claims** (not the URL hint), pinned to
`cherryhillfci.com` at config load. Identity is keyed by immutable `(provider, issuer,
sub)` with a test asserting the lookup SQL has no email predicate; invitations are
single-use under `FOR UPDATE` with audit in the same transaction; absent config keeps both
login routes `404`-identical; and grep confirms **zero** `oai-authenticated-user-email`
reads in `app/platform`. These properties must be preserved by every packet below.

**PR #48 resolved the launch-blocking callback correctness bug, PR #54 completed the
OIDC-02 hardening, and PR #55 completed the OIDC-03 negative and real-PostgreSQL test matrix.**
The source-side OIDC follow-up packets are complete. Live login
remains blocked by configuration, migration/apply, deployment, and owner approval.

Severity legend: **launch-blocker** (feature cannot work in production) · high · medium ·
low. "Confirmed" = re-verified against the code for this document; "Reviewer-reported" =
from a completed review dimension, credible and specific, not independently re-verified
(the verifier pass was cut short by an infra limit — the assignee should confirm before
fixing).

---

## OIDC-01 · Accept Google's real callback parameters (launch-blocker; CONFIRMED)
**Status:** Complete — PR #48, July 19, 2026.
**Why:** `employeeLoginCallbackQuery` (`app/platform/google-cloud/employee-request-router.ts`,
~lines 458-469) rejects the callback if **any** query key is not exactly `code` or `state`:
`if (keys.some((key) => key !== "code" && key !== "state")) throw new
EmployeeOidcFailure("authorization_denied")`. Google's authorization-code redirect always
appends more parameters — at minimum `scope`, and for Workspace accounts `authuser`, `hd`,
and sometimes `prompt`. So **every real production login will fail closed** with a
misleading `authorization_denied` audit reason. The current tests never catch it because
they all construct the callback as bare `?code=…&state=…` (or call `complete()` directly).
This is not a security hole (it denies, never over-accepts), but it makes live OIDC
non-functional — and it will not surface until someone attempts a real Google login, which
has not happened because OIDC is source-only.
**Do:** (1) Read `code` and `state` from the query and **ignore** unknown parameters rather
than rejecting them; keep the existing "exactly one `code` and one `state`" cardinality
check (reject duplicates) and keep rejecting a present `error` parameter (Google returns
`?error=access_denied` on user cancel — map that to a clean denial, not a generic failure).
Do **not** loosen anything else. (2) Add a test with a realistic redirect
(`?state=…&code=…&scope=openid%20email%20profile&authuser=0&hd=cherryhillfci.com&prompt=consent`)
that must succeed, plus a `?error=access_denied&state=…` case that must produce a
clean-denial audit event. (3) Confirm nothing upstream strips query parameters before the
router sees the URL (it does not today).
**Files:** `app/platform/google-cloud/employee-request-router.ts`,
`tests/cloud-run-employee-login.test.mjs`.
**Accept:** a realistic multi-parameter Google redirect completes login in a test; a
user-cancel `error` param yields a recorded denial; duplicate `code`/`state` still rejected;
`npm test` green. **Effort:** small.

## OIDC-02 · Verifier and attempt-cookie hardening bundle (low/medium; mixed) — small
**Status:** Complete — PR #54, July 20, 2026. Source-only and not deployed.
**Why:** Three independent robustness gaps, safe to fix together:
- **Issuer strict typing (low; CONFIRMED).** `employee-oidc.ts` ~line 371 uses
  `GOOGLE_ISSUERS.has(String(claims.iss))`; `String(["accounts.google.com"])` passes, so a
  single-element **array** `iss` is accepted, while every other claim is strictly
  `typeof`-checked. Only reachable if Google signed such a token (it will not), so it is
  defense-in-depth consistency, not a live hole.
- **Malformed-unrelated-cookie tolerance (low; reviewer-reported).**
  `readEmployeeOidcAttemptCookie` (~lines 436-445) throws `attempt_invalid` for the whole
  request if **any** cookie in the `Cookie` header lacks `=` or has an empty name/value
  (e.g. an analytics `foo` or `bar=`), even when a valid `__Host-fci_oidc_attempt` cookie
  is present — so an unrelated cookie can block login on that browser.
- **Attempt single-use (low; reviewer-reported).** The state/nonce/PKCE attempt is a
  stateless AES-GCM cookie (`complete()` ~lines 603-643); nothing server-side invalidates a
  consumed attempt. Single-use rests on the browser honoring the clear-cookie header and
  Google rejecting code reuse. Re-navigating the still-cached authorization URL within the
  10-minute window can mint a fresh code bound to the same nonce/challenge.
**Do:** (1) Strictly reject a non-string `iss` (`typeof claims.iss !== "string"`) before the
allowlist check. (2) In the cookie parser, **skip** malformed/unrelated cookie items and
only fail if the `__Host-fci_oidc_attempt` cookie itself is absent or unparseable. (3) For
attempt single-use, prefer the low-cost mitigation: shorten the attempt lifetime is already
10 min — additionally bind and check a one-time server marker if a session/identity store
is cheaply available; **otherwise** document explicitly (in
`docs/authorization-simulation.md` and a code comment) that single-use relies on
authorization-code single-use at Google plus the clear-cookie header, and that the 10-minute
attempt window is the accepted bound. Pick one and note the decision. Do not weaken the
existing AAD binding, timing-safe comparisons, or expiry math.
**Files:** `app/platform/google-cloud/employee-oidc.ts`, `tests/employee-oidc.test.mjs`,
and (if the documentation route is chosen) `docs/authorization-simulation.md`.
**Accept:** array/non-string `iss` rejected in a test; a valid attempt cookie succeeds when
an unrelated malformed cookie is also present; the attempt-reuse decision is implemented or
explicitly documented with a test or comment; `npm test` green. **Effort:** small.

## OIDC-03 · Test-coverage backfill for the new login path (medium; reviewer-reported) — medium
**Status:** Complete — PR #55, July 20, 2026. Source-only and not deployed.
**Why:** The implementation conforms to policy, but the **new** suites do not exercise the
behaviors BE-04's own acceptance line claims, so a future regression would pass CI. Confirmed
by grep: `tests/cloud-run-employee-login.test.mjs` and `tests/employee-oidc.test.mjs`
contain **zero** `idle_expired` / `absolute_expired` / `logout` assertions (that coverage
lives only in the pre-existing `tests/cloud-run-employee-routes.test.mjs`, which PR #38 did
not touch). Reviewer-reported additional gaps, all specific and worth confirming:
- The verifier's **negative** claims are untested and the stub auto-injects the correct
  nonce, so removing the nonce/exp/aud/iss/`email_verified`/alg checks would not fail any
  test (`employee-oidc.test.mjs` only covers wrong `hd`, wrong signing key, state mismatch,
  attempt expiry).
- PR #48 now covers a realistic multi-parameter callback, provider cancellation mapped to
  a clean `403`, denial audit, attempt-cookie clearing, and duplicate `code`/`state`.
  Remaining router coverage is retryable completion failure → `503 login_unavailable`
  with audit + cookie clearing, and cross-origin `/session/google/start` denial.
- The persistence **named-denial matrix is 2-of-7**, plus a distinct `23505` conflict path. Tests cover `invitation_invalid` and
  `invitation_expired`; the five untested named reasons are `invitation_required`,
  `invitation_email_mismatch`, `identity_conflict`, `user_unavailable`, and
  `role_not_approved`, plus the distinct `23505` conflict outcome. There is **no gated
  real-PostgreSQL integration test** for the new `authenticateEmployeeSession`
  transaction, so the `FOR UPDATE` single-use race guard never runs against real PG.
**Do:** Add tests (unit + the existing gated-PG integration pattern) covering verifier
negatives (past `exp`, wrong `aud`, wrong string `iss`, `email_verified:false`,
`alg:HS256`/`none`, and **nonce mismatch**; `options.claims` can already override the
default nonce, while the signed-token helper needs configurable headers for alg cases),
the remaining router failure mapping + audit/cookie clearing + cross-origin start denial,
the five missing named persistence denials plus the `23505` conflict outcome, and a gated
real-PG integration test for concurrent single-use invitation redemption. Use separately
issued sessions to verify idle expiry, absolute expiry, and logout. Do not change
production code except a minimal test seam if the algorithm cases require it.
**Files:** `tests/employee-oidc.test.mjs`, `tests/cloud-run-employee-login.test.mjs`,
`tests/postgres-employee-login-persistence.test.mjs`, plus a new gated
`tests/*.integration.test.mjs` following the existing integration-test gating.
**Accept:** each named negative case fails if its guard is removed (mutation-sanity: try
it); the gated PG integration test proves the invitation race and issues-then-expires or
revokes real sessions; `npm test` and the CI PostgreSQL job are green. **Effort:** medium.

## OIDC-04 · Reconcile the docs the merge left stale (medium; CONFIRMED) — small
**Status:** Complete — PR #49, July 19, 2026.
**Why:** PR #38 originally merged touching zero docs, and the later merge train widened
the drift. The canonical BE-04 item now says Complete, but merged `main` still contradicts
its own
tracking rules (`AGENTS.md` and the plan doc require behavior changes to update their docs
in the same PR). Confirmed: sequencing and handoff passages still assign already-merged
PRs; and
`docs/authorization-simulation.md` still describes login/session issuance as not-yet-existing
in places even though `employee-request-router.ts` now issues `__Host-fci_session`. The
root `README.md` likewise still places employee OIDC/session issuance outside the source
boundary, and the complete architecture audit still assigns removal or typing of the
already-removed `/api/v1/records` route. Before this packet,
`tests/task-tracking-docs.test.mjs` only format-checked BE-01/WS-03/TRK-01, so it did not
catch this.
**Do:** (1) Reconcile every merged packet status and the sequencing/handoff mentions in
the plan, `docs/codex-to-codex-handoff.md`, and the owner-facing checklist summary.
(2) Reconcile `docs/authorization-simulation.md`: keep the approved-policy content, but
correct any statement that a login/session-issuance route does not exist to reflect the
merged source (note what is now implemented vs still deferred — sliding idle renewal remains
deferred). (3) Extend `tests/task-tracking-docs.test.mjs` so a merged packet whose status
line still says "In review"/"draft" fails CI — a lightweight rule that would have caught
this for the explicit known-packet map. Update that map and its tracking-file list whenever
a packet merges. (4) Reconcile the root README's production/launch boundary and mark the
architecture audit's generic-records action resolved in source without weakening the
separate upload warning or assistant records-only assertion.
**Files:** `README.md`, `docs/agent-plan-architecture-workspace-and-setup.md`,
`docs/authorization-simulation.md`, `docs/codex-to-codex-handoff.md`,
`docs/task-checklists/README.md`,
`docs/complete-product-and-google-cloud-architecture-audit.md`, this follow-up ledger,
affected architecture/checklist status surfaces, and `tests/task-tracking-docs.test.mjs`.
**Accept:** no tracking doc assigns an already-merged PR for review;
`authorization-simulation.md` matches merged source; the explicit offline merged-packet
map fails on a draft/in-review status for a known merged packet and passes after this fix;
the root README distinguishes merged OIDC/role/scoping source from live activation; the
architecture audit records PR #46's route/helper removal while preserving the assistant's
records-only test assertion;
`npm test` green. **Effort:** small.

---

## KPI-01-FIX · Stop the KPI stat tiles from breaking the Reports metric test (RESOLVED) — PR #41
**Status:** Resolved in PR #41, July 19, 2026. Both complete GitHub
Chromium runs, both Node/build runs, and both Terraform checks pass.
**Cause:** The pre-existing Reports test used a page-wide `.metric-card` locator, so its
"Active projects" lookup also matched the new KPI card that intentionally shares the
application's metric-card visual convention.
**Resolution:** Keep the valid shared styling and scope the old regression locator to the
existing summary row with `.metrics-grid > .metric-card`. The focused legacy Reports test
and all 22 KPI-focused Playwright cases pass together; the pinned formulas in
`docs/flooring-kpis.md` and the direct `isAdmin` gate on dollar KPIs are unchanged.
**Files:** `tests/e2e/floor-ops.spec.ts`. No visual or production behavior changed.

---

## Recommended order for Codex

KPI-01-FIX and OIDC-01 are resolved in PRs #41 and #48. OIDC-04 is complete in PR #49,
with its completed status guarded by PR #50. OIDC-02 and OIDC-03 are complete in PRs
#54/#55. No source-side OIDC review packet remains; live configuration, migration/apply,
deployment, and employee admission still require the recorded owner approvals and acceptance gates.

OIDC-01..04 touch only Cloud Run platform + tests + docs (no FloorOpsApp), so they run in
parallel with the FloorOpsApp queue and with the other open backend packets. None requires
Brett or any owner input.

## What was NOT reviewed (be honest about coverage)

Three of five review dimensions (invitations/sessions lifecycle, persistence/SQL/least-
privilege, config/composition) were cut short by an infrastructure limit, and the automated
verifier pass did not run — the findings above come from the two completed dimensions (OIDC
protocol, policy/tests) plus hand-verification of the load-bearing items. The completed
policy/tests reviewer read across the session/persistence code and reported nothing
alarming there, and the earlier pre-merge structural check confirmed the session cookie
hardening and transactional audit. A full re-review of the three unread dimensions is
reasonable follow-up but not a blocker; if run, add any confirmed findings here as OIDC-05+.
