# BE-04 Workspace OIDC — post-merge security review and follow-up packets

Date: July 19, 2026 · Reviews merged PR #38 ("Add Workspace OIDC employee login") at
`main` @ `9316771` · Also carries the fix packet for the failing draft PR #41 (KPI-01).

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

**But there is one launch-blocking correctness bug and a set of hardening + test-coverage +
doc gaps.** None is an exploitable hole in the merged code (every finding is fail-closed or
availability/test-only), which is why merge was acceptable — but OIDC-01 must land before
any live employee login is attempted, and the test backfill matters because BE-04 is the
production security boundary.

Severity legend: **launch-blocker** (feature cannot work in production) · high · medium ·
low. "Confirmed" = re-verified against the code for this document; "Reviewer-reported" =
from a completed review dimension, credible and specific, not independently re-verified
(the verifier pass was cut short by an infra limit — the assignee should confirm before
fixing).

---

## OIDC-01 · Accept Google's real callback parameters (launch-blocker; CONFIRMED) — DO FIRST
**Status:** In progress — `codex/oidc-login-followups`, July 19, 2026.
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
**Status:** Open.
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
**Status:** Open.
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
- The router's **login-failure path** has no assertions: the denial-audit append, the
  `403 login_not_authorized` vs `503 login_unavailable` mapping, attempt-cookie clearing,
  and cross-origin `/session/google/start` denial are unasserted; the harness even has a
  dead `completionError` option.
- The persistence **denial matrix** is 4-of-8: `user_unavailable` (disabled user),
  `invitation_email_mismatch`, `identity_conflict`, `invitation_required`,
  `role_not_approved`, and the `23505` conflict path are implemented but untested, and there
  is **no gated real-PostgreSQL integration test** for the new `authenticateEmployeeSession`
  transaction (unlike the other repositories), so the `FOR UPDATE` single-use race guard
  never runs against real PG.
**Do:** Add tests (unit + the existing gated-PG integration pattern) covering: a realistic
multi-param callback (shared with OIDC-01), verifier negatives (past `exp`, wrong `aud`,
wrong `iss`, `email_verified:false`, `alg:HS256`/`none`, **nonce mismatch** — fix the stub so
the nonce is not auto-injected, making the check falsifiable), the router failure mapping +
denial-audit append + cross-origin start denial (use the dead `completionError` option or
remove it), the four missing persistence denials, and a gated real-PG integration test that
issues a session via the new path and then rejects it on idle expiry, absolute expiry, and
logout. Do not change production code except the minimal stub fix that makes the nonce check
testable.
**Files:** `tests/employee-oidc.test.mjs`, `tests/cloud-run-employee-login.test.mjs`,
`tests/postgres-employee-login-persistence.test.mjs`, plus a new gated
`tests/*.integration.test.mjs` following the existing integration-test gating.
**Accept:** each named negative case fails if its guard is removed (mutation-sanity: try it);
the gated PG integration test issues-then-expires/revokes a real session; `npm test` and the
CI PostgreSQL job green. **Effort:** medium.

## OIDC-04 · Reconcile the docs the merge left stale (medium; CONFIRMED) — small
**Status:** Open.
**Why:** PR #38 merged touching zero docs, so merged `main` now contradicts its own
tracking rules (`AGENTS.md` and the plan doc require behavior changes to update their docs
in the same PR). Confirmed: the BE-04 status line in
`docs/agent-plan-architecture-workspace-and-setup.md` (~line 180 and the sequencing
mentions) still reads **"In review — draft PR #38"** though it is merged; and
`docs/authorization-simulation.md` still describes login/session issuance as not-yet-existing
in places even though `employee-request-router.ts` now issues `__Host-fci_session`. The
guard test `tests/task-tracking-docs.test.mjs` only format-checks BE-01/WS-03/TRK-01, so it
did not catch this.
**Do:** (1) Set the BE-04 status line to `Complete — PR #38, July 19, 2026` and fix the
sequencing/handoff mentions in the plan doc and `docs/codex-to-codex-handoff.md`.
(2) Reconcile `docs/authorization-simulation.md`: keep the approved-policy content, but
correct any statement that a login/session-issuance route does not exist to reflect the
merged source (note what is now implemented vs still deferred — sliding idle renewal remains
deferred). (3) Extend `tests/task-tracking-docs.test.mjs` so a merged packet whose status
line still says "In review"/"draft" fails CI — a lightweight rule that would have caught
this and will catch the next one.
**Files:** `docs/agent-plan-architecture-workspace-and-setup.md`,
`docs/authorization-simulation.md`, `docs/codex-to-codex-handoff.md`,
`tests/task-tracking-docs.test.mjs`.
**Accept:** no doc says BE-04/PR #38 is in review/draft; `authorization-simulation.md`
matches merged source; the guard test fails on a "draft/in-review" status line for a merged
packet, and passes on `main` after this fix; `npm test` green. **Effort:** small.

---

## KPI-01-FIX · Stop the KPI stat tiles from breaking the Reports metric test (CONFIRMED) — on draft PR #41
**Status:** Open — the fix lands on the existing `codex/tier1-flooring-kpis` branch (draft
PR #41), not a new branch.
**Why:** Draft PR #41's Chromium job is **red**. `BusinessKpisPanel` renders each KPI tile
as `<article className="metric-card business-kpi-card">`, so KPI cards are also
`.metric-card`. The pre-existing `tests/e2e/floor-ops.spec.ts` (~lines 375-376) does
`page.locator('.metric-card').filter({ hasText: 'Active p…' })` and expects exactly one — but
a KPI tile whose label also starts "Active p…" now matches too, producing a strict-mode
violation ("unexpected value 'Active projects—Loading current totals'"). This is a genuine
regression: the new panel collided with an existing test's selector. (My KPI-01 packet said
"reuse the shared panel/stat conventions" — that was slightly too loose; reusing the bare
`.metric-card` class is what caused the collision.)
**Do:** Give the KPI tiles a **distinct** root class instead of reusing `.metric-card` (e.g.
`business-kpi-card` only, with its own minimal styling, or scope the KPI panel so the
existing `.metric-card` selector on the Reports metric row stays unique). Prefer the option
that keeps the visual result identical while making the KPI tiles non-matching for the
existing selector. Re-run `tests/e2e/floor-ops.spec.ts` and the new
`tests/e2e/flooring-kpis.spec.ts` together to prove both pass. Keep the pinned formulas from
`docs/flooring-kpis.md` and the `isAdmin` gate on dollar KPIs unchanged.
**Files:** `app/features/reports/BusinessKpisPanel.tsx`, `app/globals.css`,
`tests/e2e/flooring-kpis.spec.ts` (only if a selector there also needs the new class).
**Accept:** the full Chromium regression suite passes (both `floor-ops.spec.ts` and
`flooring-kpis.spec.ts`); no visual change to the KPI panel; `npm test` green. **Effort:**
small.

---

## Recommended order for Codex

1. **KPI-01-FIX** — unblocks the red draft PR #41 (it is otherwise the next FloorOpsApp
   packet in the queue).
2. **OIDC-01** — the launch-blocker; small and self-contained; do before any live-login work.
3. **OIDC-04** — cheap doc/guard reconciliation; removes the merged-main contradiction.
4. **OIDC-02** then **OIDC-03** — hardening, then the test backfill (OIDC-03 shares a test
   fixture with OIDC-01, so sequence OIDC-01 → OIDC-03).

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
