# Night 6 — Architecture & duplication

**Run:** July 24, 2026 (co-run with Night 8 under the owner-approved pairing
rules — shared kickoff, combined publication). **Target:** `origin/main`
post-#180. **Method:** static only — three Opus lenses (boundaries/import
direction, duplication under the 3+-instances rule, dead code), every P1/P2
adversarially verified. No dev server, no captures.

## What ran

- Import-direction census across `app/{domain,application,ports,adapters,features,lib,components,settings}`.
- Direct-fetch census, duplicated-literal and repeated-logic sweeps, currency/date/status formatter comparison against existing shared homes.
- Dead-surface sweep: exports of `app/lib` + `app/application` + the 12 largest source files; globals.css selector families vs `className` usage; package.json dependency usage.

## What we found

| ID | Sev | Finding | Disposition |
|---|---|---|---|
| N6-1 | P2 | Application read-path bypasses ports (5 services hardwire D1 SQL; tools.ts skips the task port) | Owner-gated architecture proposal — schedule with the next PostgreSQL-migration work |
| N6-2 | P2 | `noStore()` duplicated ~22×; `errorResponse()` ×8; no `formatUsd` home | NFIX-03 |
| N6-3 | P3 | ~10 dead CSS families (~30 rule lines) from a removed dashboard mock | Folded into FIX-17 (dated amendment) |
| N6-4 | P3 | 8 zero-reference exports (postgres-values aliases + 4 scattered) | NFIX-03 |

Healthy findings worth naming: domain layer imports nothing cross-layer; no
feature-to-feature reach-ins; ports import no adapters; write path properly
port-driven; all runtime dependencies used; no dead exports in the 12 largest
files.

## Recommended

Fire NFIX-03 when its zone clears (held behind BE-15's shared settings-route
files). Decide N6-1's read-side ports alongside the next PostgreSQL push — it
is the single change that lets the dormant postgres suite back reads without
rewriting every service.

## Pastes issued

NFIX-03 drafted; paste HELD until BE-15 (PR #181) merges. N6-1 awaits an owner
decision — no paste.

## Coverage honesty

Static lens work only; dead-export analysis did not cover every module; the
~120 module-local type exports of the house testability convention were
deliberately not filed; FloorOpsApp size/fetch count not filed (owned by
AI-02's extraction series).
