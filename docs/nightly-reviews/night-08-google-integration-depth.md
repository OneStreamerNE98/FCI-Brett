# Night 8 — Google integration depth

**Run:** July 24, 2026 (co-run with Night 6 under the owner-approved pairing
rules — shared kickoff, combined publication). **Target:** `origin/main`
post-#180, live (non-simulation) Google paths only. **Method:** static — three
Opus lenses (idempotency/partial-failure, quota/backoff/degradation,
token/scope hygiene), every P1/P2 adversarially verified.

## What ran

- Mutation-path census: Drive root/spreadsheet/template ensures, project-folder provisioning, Gmail filing and label prepare, Calendar test-hold, Shared Drive adopt, Sheets mirror sync — each traced for re-run safety, lease/fencing, and registry atomicity.
- Backoff/timeout census over every Google client call site plus the OAuth token request; 429-vs-auth mapping per client.
- Scope census vs call sites; token lifecycle (encryption, logging, responses); allowlist fail-closed check; connectionKey partitioning sweep.

## What we found

| ID | Sev | Finding | Disposition |
|---|---|---|---|
| N8-1 | P2 | Client Directory sheet sync unleased — concurrent syncs duplicate a row, then all mirroring wedges on the duplicate-id guard | NFIX-01 |
| N8-2 | P2 | Zero timeouts on drive/sheets/gmail/calendar/OAuth fetches — a hung socket is an unbounded await | NFIX-02 |
| N8-3 | P3 | Project Register clear-then-write leaves a transient empty tab on mid-sync failure | NFIX-01 |
| N8-4 | P3 | Mirror status can freeze at "syncing" after a process death (stale "synced" impossible — verified) | NFIX-01 |
| N8-5 | P3 | Burst paths (provisioning loops, sheet sync) abort on the first raw 429 with no bounded retry | NFIX-02 |
| N8-6 | P3 | Calendar surfaces 429 as 503, hiding the rate-limit signal its siblings preserve | NFIX-02 |
| N8-7 | P3 | Status endpoint never reconciles externally revoked scopes (no liveness probe) | Finding only — needs a reauth-UX decision (WS/GI space) |

Healthy findings worth naming: every ensure/filing/provision path is
lease-fenced with find-before-create idempotency (stable appProperties
identities, deterministic Calendar event ids, name-deduped Gmail labels);
tokens AES-GCM-256 encrypted with a versioned keyring and never logged or
returned; account allowlist fail-closed; connectionKey partitioning intact;
no over-scoping.

## Recommended

NFIX-01 and NFIX-02 are both clear-cut, zone-clear fixes — fire either or both
whenever Codex has capacity. N8-7 waits for a design decision on reauth UX.

## Pastes issued

NFIX-01 and NFIX-02 ready (zones: `app/lib/google-*.ts` + their tests —
disjoint from the in-flight AI-02 and BE-15 lanes). NFIX-03 (Night 6) held
behind BE-15.

## Coverage honesty

Static reads only — no live Google calls, no e2e; D1 lease-helper adapters
trusted per their own suites; simulation branches skipped by repo law (they
never contact Google).
