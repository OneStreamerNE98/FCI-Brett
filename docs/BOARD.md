# Packet board

<!-- GENERATED FILE — do not edit by hand. Regenerate with `node tools/generate-board.mjs`;
     tests/board-docs.test.mjs fails CI if this file differs from the generator output. -->

196 packets across 4 ledgers: 42 not started · 4 in progress · 2 in review · 2 blocked · 134 complete · 5 resolved · 7 superseded.
The Status column is the first sentence of the packet's ledger status line; the ledger
row holds the full text. Packets without a status line are not started.

| Packet | Title | Status | Ledger |
|---|---|---|---|
| AI-01 | Tasks foundation + phone-call meeting type (medium; no deps — parallel-safe now) | Complete — PR #135 + PR #140, July 23, 2026. | agent-plan |
| AI-02 | Assistant & Inbox surface extraction + phone-call option (medium; the ONLY FloorOpsApp packet — one queue slot, three serial PRs a→b→c) | Complete — PR #182 + PR #187 + PR #193, July 24, 2026. | agent-plan |
| AI-03 | Provider port + org-wide agentic Q&A (large, after AI-01; API/lib only — no FloorOpsApp) | Complete — PR #145, July 23, 2026 (including the reviewed revision commit). | agent-plan |
| AI-04 | Today view (medium, after AI-01 + AI-02; assistant components only) | Complete — PR #201, July 25, 2026. | agent-plan |
| AI-05 | AI triage suggestions in the Inbox (medium, after AI-02 + AI-03; inbox components only; admin-gated) | Complete — PR #205, July 25, 2026. | agent-plan |
| AI-06 | Reply with AI (small-medium, after AI-02 + AI-03; inbox components only; admin-gated) | Complete — PR #212, July 26, 2026. | agent-plan |
| AI-07 | AI task extraction, review-first (medium, after AI-01 + AI-03; two PRs a/b) | Complete — PR #185 + PR #195, July 25, 2026. | agent-plan |
| AI-08 | AI settings card + "what you can ask" help (small-medium, after AI-03 — lands before AI-05/06/07 so gates precede the gated features) | Complete — PR #152, July 23, 2026. | agent-plan |
| AI-09 | Guardrail tests, Tier-2 reconciliation, ledger closure (small; docs/tests only, last) | Complete — PR #216, July 26, 2026. | agent-plan |
| AI-10 | Email intake: durable review queue and review-first lead capture (large; after AI-09) | Complete — PR #235 + PR #238 + PR #245, July 30, 2026. | agent-plan |
| AI-11 | Typed accepts, AI settings section, and the label catalog editor (large; after AI-10) | Complete — PR #255 + PR #277 + PR #300 + PR #340, August 9, 2026. | agent-plan |
| AI-12 | A failed inbox analysis is invisible, and a provider outage reads as "You're caught up" (medium) | Complete — PR #287, August 4, 2026. | agent-plan |
| BE-01 | Documentation truth pass (small, no deps) — DO FIRST | Complete — PR #32, July 19, 2026. | agent-plan |
| BE-02 | Bounded request bodies on five dev mutation routes (small, no deps) | Complete — PR #36, July 19, 2026. | agent-plan |
| BE-03 | Retire the legacy /api/v1/records surface (small, after BE-02) | Complete — PR #46, July 19, 2026. | agent-plan |
| BE-04 | Workspace OIDC login, invitation redemption, session issuance on the Cloud Run router (large, no deps; VERIFIED) | Complete — PR #38, July 19, 2026. | agent-plan |
| BE-05 | Object storage behind the port: R2 + GCS adapters, wire uploads route (medium, no deps) | Complete — PR #40, July 19, 2026. | agent-plan |
| BE-06 | Leads & project meetings: ports, D1 adapters, PostgreSQL migration v6 (large, no deps) | Complete — PR #42, July 19, 2026. | agent-plan |
| BE-07 | Settings/preferences/filing-rules/mail-items ports + migration v7 + single calendar-ID authority (large, after BE-06) | Complete — PR #140, July 23, 2026. | agent-plan |
| BE-08 | Decouple Google clients from cloudflare:workers; key-version decryption; populate v3 integration tables (large, no deps) | Complete — PR #45, July 19, 2026. | agent-plan |
| BE-09 | Port application writes to the production boundary; reconcile the dual API contract (medium, after BE-04+BE-06; VERIFIED) | Complete — PR #51, July 20, 2026. | agent-plan |
| BE-10 | Rate limiting on both surfaces (medium, after BE-04+BE-09; VERIFIED) | Complete — PR #82, July 21, 2026. | agent-plan |
| BE-11 | Deployment mechanism source definitions (medium; source complete, apply owner-gated) | Complete — PR #47, July 19, 2026. | agent-plan |
| BE-12 | Rehearsal inventory expansion (medium, after BE-06; VERIFIED with corrections) | Complete — PR #53, July 20, 2026. | agent-plan |
| BE-13 | Fail-closed schema targeting (small, no deps) | Complete — PR #36, July 19, 2026. | agent-plan |
| BE-14 | Degraded-mode contract + outbox drain entrypoint (medium, after BE-08/09/11) | Complete — PR #178, July 24, 2026. | agent-plan |
| BE-15 | Atomic settings-blob writes across all workspace_settings writers (small-medium, after BE-07) | Complete — PR #181, July 24, 2026. | agent-plan |
| BE-16 | PostgreSQL parity for the project segment (small, after BE-15 + DES-08 a-T2; filed July 24, 2026) | Complete — PR #198, July 25, 2026. | agent-plan |
| DES-01 | Design tokens: one :root, dead-rule excision, media consolidation (medium; holds the globals.css lock) | Complete — PR #119, July 22, 2026. | agent-plan |
| DES-02 | Control/radius/border/shadow normalization + undersized-control guard (medium, after DES-01) | Complete — PR #126, July 23, 2026. | agent-plan |
| DES-03 | Logo transparency + bare-brand treatment (small-medium; SVG work parallel-safe, `.brand` edit takes the globals lock) | Complete — PR #132, July 23, 2026. | agent-plan |
| DES-04 | Nav & shell polish: 44px toggle, honest compact badges, breakpoint sweep (small-medium, after DES-02; FloorOpsApp queue) | Complete — PR #159, July 24, 2026. | agent-plan |
| DES-05 | Interactive vs static card grammar + FIX-08 absorption (medium; FloorOpsApp queue, after DES-06; GOLDEN REGEN 1 of 2) | Complete — PR #149, July 23, 2026. | agent-plan |
| DES-06 | Layout-editor polish: icon-only Edit, honest Hidden-sections row, unified title-actions (small; FIRST DES packet in the FloorOpsApp queue; no golden regen) | Complete — PR #143, July 23, 2026. | agent-plan |
| DES-07 | Primitive unification: KpiMetric→Metric, empty-state primitive, pill base (medium; FloorOpsApp queue after DES-04; GOLDEN REGEN 2 of 2, Reports hash only) | Complete — PR #165, July 24, 2026. | agent-plan |
| DES-08 | Owner-selected additions: industry surfacing, segment, quick-add removal, attention strip, Today's meetings (small each; sub-scopes ship as separate PRs in the FloorOpsApp queue) | Blocked — sub-scope c only, awaiting an owner decision to lift the July 24 deferral now that its truthful AI-10 needs-review signal dependency is complete in… | agent-plan |
| DES-09 | Guardrail wrap-up + ledger closure (small; tests/docs only, last) | In review — PR #359 | agent-plan |
| DES-10 | Brand-mark presentation refinement (small; NOT priority — after the current DES queue; SVG work parallel-safe, the `.brand` edit takes the globals lock briefly) | — | agent-plan |
| DES-11 | Curated movable & resizable dashboard cards (owner enhancement, July 24, 2026) | Complete — PR #252 + PR #261, July 31, 2026. | agent-plan |
| DES-12 | Layout editor: snap-in-place drag, touch support, and uniform card rhythm (medium) | — | agent-plan |
| DES-13 | Design-language consolidation: color, type, and spacing scales with a drift guard (medium) | Complete — PR #309, August 5, 2026. | agent-plan |
| DES-14 | FloorOpsApp decomposition: extract the four record views and their shared record contracts (large, after GI-04) | Complete — PR #327, August 5, 2026. | agent-plan |
| DES-14b | FloorOpsApp decomposition: the modal and drawer cluster (large, after DES-14) | Complete — PR #328, August 7, 2026. | agent-plan |
| DES-15 | Record-page list views with sorting and search (medium-large, after DES-14) | In review — PR #358 | agent-plan |
| DES-16 | Flow honesty: the phone-call lead path, the Schedule phantoms, and a role-gated nav (small-medium) — ADOPTION FLAGSHIP | Complete — PR #306, August 4, 2026. | agent-plan |
| DES-17 | The failure surface: error boundary, toast queue with next steps, empty-state actions (medium) | Complete — PR #332, August 7, 2026. | agent-plan |
| DES-18 | Findability and the filing prefill (small-medium, after AI-11(c) merges — inbox cluster) | — | agent-plan |
| DES-19 | Responsive layout primitives and the dynamic-state guard (medium-large; after DES-13 and DES-14) | In progress — `kimi/des19-responsive-primitives` | agent-plan |
| DES-20 | Settings navigation architecture: the phone index and the tablet double-rail (medium; after DES-19) | — | agent-plan |
| DES-21 | Conditional-action migrations to the primitives (medium-large; after DES-19; FloorOpsApp queue) | — | agent-plan |
| DES-22 | Overlay scroll ownership (small-medium; after DES-17) | — | agent-plan |
| DES-23 | Leads board phone presentation (medium; after DES-15) | — | agent-plan |
| DES-24 | Settings surface-depth grammar: end the card tunnel (medium; after DES-13) | — | agent-plan |
| DES-25 | Retire the dead webfont loading and migrate the last inline-style island (small; after DES-13) | Complete — PR #318, August 5, 2026. | agent-plan |
| DES-26 | The vanishing retry: background revalidation unmounts an error notice mid-click (small-medium; after SET-42) | Complete — PR #348 | agent-plan |
| DOC-06 | Deployment procedure runbook (small, no deps) | Complete — PR #271, July 31, 2026. | agent-plan |
| EDIT-01 | Lead edit auditing, and recording the authorization gap honestly (small, no deps) | Complete — PR #222, July 27, 2026. | agent-plan |
| EDIT-02 | `phone-call` meeting type PostgreSQL parity (RETIRED — filed on a false premise) | Resolved in PR #135, July 23, 2026. | agent-plan |
| EDIT-03 | Optimistic concurrency + edit auditing foundation (medium; gates EDIT-04…EDIT-07) | Complete — PR #225, July 27, 2026. | agent-plan |
| EDIT-04 | Lead editing (small-medium, after EDIT-01 + EDIT-03) | Complete — PR #231, July 28, 2026. | agent-plan |
| EDIT-05 | Project editing (medium-large, after EDIT-03) | Complete — PR #228, July 28, 2026. | agent-plan |
| EDIT-06 | Client and contact editing (medium, after EDIT-03) | Complete — PR #249, July 30, 2026. | agent-plan |
| EDIT-07 | Task management UI (medium, after EDIT-03) | Complete — PR #248, July 30, 2026. | agent-plan |
| EDIT-08 | Read a single task by id (small, after EDIT-07) | Complete — PR #265, July 31, 2026. | agent-plan |
| EDIT-09 | The contact editor re-renders mid-edit and lands a value in the wrong field (small-medium) | Complete — PR #297, August 4, 2026. | agent-plan |
| F-14 | Anonymous OIDC login endpoints are unthrottled (P2; VERIFIED; production-only) | — | review-2026-07-21 |
| F-15 | Throttle fires after 1–3 authorization DB round-trips (P3) | Superseded — absorbed into FIX-11. | review-2026-07-21 |
| F-16 | Duplicated Postgres advisory-lock ID across two subsystems (P2; VERIFIED) | Resolved in PR #112. | review-2026-07-21 |
| F-17 | Per-route preamble hand-rolled 36 times; `no-store` applied 4 ways (P3) | Superseded — absorbed into FIX-12. | review-2026-07-21 |
| F-18 | Setup-action + settings-card boilerplate (P3) | Superseded — absorbed into FIX-12. | review-2026-07-21 |
| FIX-01 | Route Gmail, Calendar, and create-time mirroring through effective config (P1s F-2/F-3/F-4 + P2 F-5; medium) | Complete — PR #95, July 22, 2026. | review-2026-07-21 |
| FIX-02 | Blueprint-aware project provisioning with one identity-stamping scheme (P1 F-1 + stamping/containment P3s; medium) | Complete — PR #97, July 22, 2026. | review-2026-07-21 |
| FIX-03 | Simulation audit + failure-mode parity, and complete reset (P2s F-6/F-8 + reset/status-shape P3s; small-medium) | Complete — PR #100, July 22, 2026. | review-2026-07-21 |
| FIX-04 | Test-infrastructure repairs: CI double-run, guard sustainability, flake hygiene (P2s F-9/F-10 + e2e P3s; small-medium) | Complete — PR #103, July 22, 2026. | review-2026-07-21 |
| FIX-05 | One shared sheet-mirror status label mapper (P2 F-12; small) | Complete — PR #105, July 22, 2026. | review-2026-07-21 |
| FIX-06 | API uniformity bundle (P3s; small) | Complete — PR #110, July 22, 2026. | review-2026-07-21 |
| FIX-07 | Admin gating single source of truth (P2 F-13; small) | Complete — PR #137, July 23, 2026. | review-2026-07-21 |
| FIX-08 | FloorOpsApp honesty polish bundle (P3s; small) | Superseded — absorbed into DES-05. | review-2026-07-21 |
| FIX-09 | E2e through the real simulation backend (P2 F-7; medium) | Complete — PR #317 + PR #330, August 7, 2026. | review-2026-07-21 |
| FIX-10 | Single shared advisory-lock constant (P2 F-16; small; Wave R1) | Complete — PR #112, July 22, 2026. | review-2026-07-21 |
| FIX-11 | Anonymous login-flow throttle (P2 F-14; small; blocked on the allUsers invoker-grant review, production-only) | — | review-2026-07-21 |
| FIX-12 | R4 consolidation + residual sweep (P3s F-17/F-18 + recorded residuals; medium; Wave R4, after the SET-29 series) | — | review-2026-07-21 |
| FIX-13 | Stage-4 verification durability (P2 H-2; small-medium) | Complete — PR #156, July 24, 2026. | review-2026-07-24 |
| FIX-14 | Reminder-hours field wiring (P2 H-3; small) | Resolved in PR #163. | review-2026-07-24 |
| FIX-15 | Single-slot toast clobbers (P3 H-6; small) | Complete — PR #206, July 25, 2026. | review-2026-07-24 |
| FIX-16 | Truthful custom filing rules (P3 H-7; small) | Resolved in PR #163. | review-2026-07-24 |
| FIX-17 | Post-wave polish sweep (P3 bundle H-10 + H-9; small-medium) | Complete — PR #208, July 25, 2026. | review-2026-07-24 |
| FIX-18 | Stage-3 row status reconciliation (P2 H-1; small-medium) | Complete — PR #154, July 23, 2026. | review-2026-07-24 |
| FIX-19 | Blueprint-editor mobile folder-key layout (P2 H-4; small) | Superseded — absorbed into DES-04. | review-2026-07-24 |
| FIX-20 | Wrap-insensitive documentation pins (small; from the July 27 devils-advocate review) | Complete — PR #312, August 5, 2026. | review-2026-07-24 |
| GI-01 | Google Forms lead intake (small, after SET-16) | Complete — PR #272, August 1, 2026. | agent-plan |
| GI-01a | Forms intake follow-up: Cloud Run wiring and dismissal coverage (small, after GI-01) | Complete — PR #280, August 3, 2026. | agent-plan |
| GI-02 | Chat webhook notifier + notification-routing settings (medium, independent) | Complete — PR #79, July 21, 2026. | agent-plan |
| GI-03 | Job-site map + navigation link on the client and project screens (small-medium, after WS-15; FloorOpsApp queue) — OWNER PRIORITY (July 21) | Complete — PR #80, July 21, 2026. | agent-plan |
| GI-04 | Address validation + autocomplete on lead, client, and project address entry (medium, after WS-15; FloorOpsApp queue) — OWNER PRIORITY (July 21) | Complete — PR #291, August 4, 2026. | agent-plan |
| GI-05 | Per-project Drive activity feed (medium, after SET-15) | — | agent-plan |
| GI-06 | Drive Labels status taxonomy (medium, after WS-16 edition confirmation + SET-15) | — | agent-plan |
| GI-07 | FCI Workspace Add-on: Gmail context panel + smart chips (large, after live employee login; owner-gated consent + private Marketplace) | — | agent-plan |
| HINT-01 | InfoHint generalization (small-medium; takes the globals.css lock briefly, in a free window after DES-04/05/07) | Complete — PR #168 + PR #171, July 24, 2026. | agent-plan |
| HINT-02-A | Adoption, extracted modules (small, after HINT-01) | Complete — PR #177, July 24, 2026. | agent-plan |
| HINT-02-B | Adoption, FloorOpsApp modals (small; ONE FloorOpsApp queue slot at the tail, after AI-02) | Complete — PR #262, July 31, 2026. | agent-plan |
| HINT-03 | Pinning + closure (small, last) | Complete — PR #273, August 1, 2026. | agent-plan |
| KPI-01 | Tier-1 KPI report from existing data + definitions doc (medium, after the FloorOpsApp queue clears — no schema change) | Complete — PR #41, July 19, 2026. | agent-plan |
| KPI-02 | Tier-2 minimal inputs: flooring category, square feet, contract value (medium, after KPI-01) | Complete — PR #52, July 20, 2026. | agent-plan |
| KPI-03 | Installation dates + callback capture via audited drawer actions (medium, after KPI-02) | Complete — PR #75, July 21, 2026. | agent-plan |
| KPI-04 | PostgreSQL parity and rehearsal coverage for KPI fields (small, after KPI-02/03 + BE-06) | Complete — PR #164, July 24, 2026. | agent-plan |
| NFIX-01 | Sheets mirror sync robustness: lease, write order, status recovery (small-medium) | Complete — PR #184, July 24, 2026. | nightly-2026-07 |
| NFIX-02 | Google client resilience: timeouts, bounded retry, honest 429 (small) | Complete — PR #189, July 24, 2026. | nightly-2026-07 |
| NFIX-03 | Server hygiene sweep: response-helper and formatter consolidation, dead-export removal (small) | Complete — PR #197, July 25, 2026. | nightly-2026-07 |
| NFIX-04 | Phone polish: testing-launch overflow, 44px control tier, 8px control gaps (small) | Complete — PR #203, July 25, 2026. | nightly-2026-07 |
| NFIX-05 | Correctness small fixes: filing-rules admin gate, normalized win-rate sources, readable sync timestamps (small) | Complete — PR #202, July 25, 2026. | nightly-2026-07 |
| NFIX-06 | Tablet-band clipping and overlap fixes (small) | Complete — PR #267, July 31, 2026. | nightly-2026-07 |
| NFIX-07 | Scanner false-signal classes, resilient scan method, and the three live August 3 defects (small) | Complete — PR #289, August 4, 2026. | nightly-2026-07 |
| NFIX-08 | iPhone info-tooltips never display on tap (small) | — | nightly-2026-07 |
| NFIX-09 | Every merge to main cancels the previous merge's verification (small; CI only) | Complete — PR #331, August 7, 2026. | agent-plan |
| NFIX-10 | 256 type errors nobody runs (medium; quality gate) | — | agent-plan |
| NFIX-11 | Error boundaries: one crash currently unmounts the whole app (medium; quality gate) | Superseded — absorbed into DES-17 | agent-plan |
| NFIX-12 | Execute the remaining direct-route coverage gaps (small-medium) | In progress — `deepseek/nfix12-route-coverage-gaps` | agent-plan |
| NFIX-13 | Paginate the clients and projects list endpoints (medium) | — | agent-plan |
| NFIX-14 | AI/provider failure observability: the bare catch and the 503 that ate its error (small-medium) | — | agent-plan |
| NFIX-15 | Upload boundary and stored-byte round-trip coverage (small) | — | agent-plan |
| NFIX-16 | E2E hygiene batch: assertions that cannot fail, waits that lie, and the missing golden path (medium) | — | agent-plan |
| NFIX-17 | Atomic D1 task-reference guards; defer the foreign-key rebuild (small-medium) | — | agent-plan |
| NFIX-18 | Address review release is best-effort with no compensation (small-medium) | In progress — `codex/nfix18-address-review-compensation` | agent-plan |
| NFIX-19 | FIX-09 stage-4 verification race (resolved) | Resolved in PR #330 | agent-plan |
| NFIX-20 | DevOps hygiene batch (medium) | — | agent-plan |
| NFIX-21 | Worker-isolate rate limiter is a per-isolate limit (small; hardening) | — | agent-plan |
| NFIX-22 | Decompose InboxView and centralize inbox contracts (medium-large) | — | agent-plan |
| NFIX-23 | Decompose GoogleWorkspacePanel and centralize Workspace contracts (medium-large, after NFIX-22) | — | agent-plan |
| NFIX-24 | FloorOps shell state ownership and major-view code splitting (large; FloorOpsApp queue) | — | agent-plan |
| NFIX-25 | Bound the filing-rule catalog on both engines (small-medium) | Blocked — awaiting owner-approved filing-rule catalog limit | agent-plan |
| SET-01 | Extract the eight Settings panels into `app/settings/components/` (large, complete in source in PR #35; not deployed) — DO FIRST in the SET workstream | Complete — PR #35, July 19, 2026. | agent-plan |
| SET-02 | Expose `isAdmin`; render admin-only controls honestly (small, after SET-01; merged in PR #37, not deployed) | Complete — PR #37, July 19, 2026. | agent-plan |
| SET-03 | Guided Workspace setup stepper with per-step live status (large, after SET-01+02) | Complete — PR #44, July 19, 2026. | agent-plan |
| SET-04 | Structured environment-prerequisites surface (medium, after SET-01) | Complete — PR #44, July 19, 2026. | agent-plan |
| SET-05 | Saved calendar IDs become runtime-authoritative with visible source (medium, after SET-01) | Complete — PR #279, August 3, 2026. | agent-plan |
| SET-06 | Truthful labels for persisted-but-inert settings and review-first rules (small, after SET-01; AMENDED July 23, 2026 — absorbs holistic-review FIX-14 + FIX-16) | Complete — PR #163, July 24, 2026. | agent-plan |
| SET-07 | Settings IA consistency: per-section badges, one deep-link label, nav/heading alignment (small, after SET-01) | Complete — PR #313, August 5, 2026. | agent-plan |
| SET-08 | Persist the launch checklists (medium, after SET-01+02) | Complete — PR #169, July 24, 2026. | agent-plan |
| SET-09 | Integration audit viewer (small, after SET-01+02) | Complete — PR #308, August 5, 2026. | agent-plan |
| SET-10 | Connection-health detail card (small, after SET-01+02+03) | Complete — PR #56, July 20, 2026. | agent-plan |
| SET-11 | Directory mirror maintenance surface (small, after SET-01+02+04) | Complete — PR #162, July 24, 2026. | agent-plan |
| SET-12 | Data & security: Planned placeholders for backup/restore, retention/export, session revocation, live-data cleanup (small, after SET-01) | Superseded — absorbed into SET-07. | agent-plan |
| SET-13 | Workspace resource registry + effective-config layer + resources card (large, after completed SET-03+04+10) — FIRST in the dashboard-setup feature | Complete — PR #76, July 21, 2026. | agent-plan |
| SET-14 | Workspace blueprint: model, seed, persistence, structured editor (large, after SET-13) | Complete — PR #81, July 21, 2026. | agent-plan |
| SET-15 | Shared Drive adopt/verify + blueprint-driven root folder tree + rename (medium, after SET-14) | Complete — PR #84, July 21, 2026. | agent-plan |
| SET-16 | Spreadsheets: system client-directory + owner-defined extras (medium, after SET-15) | Complete — PR #88, July 21, 2026. | agent-plan |
| SET-17 | Templates: blueprint-driven ensure with seed content (medium, after SET-15; parallel with SET-16) | Complete — PR #92, July 22, 2026. | agent-plan |
| SET-18 | Reconcile & drift maintenance (medium, after SET-15+16+17) | Complete — PR #227, July 28, 2026. | agent-plan |
| SET-19 | Domain & tenant guided checklist card (small, after SET-13; parallel with SET-14) | Complete — PR #83, July 21, 2026. | agent-plan |
| SET-20 | Calendar create-or-adopt behind the granted-scope gate (medium, after SET-05 + WS-14) | — | agent-plan |
| SET-21 | Project/client provisioning consumes the blueprint (medium, after SET-15) — LAST in the dashboard-setup feature | Complete — PR #296 + PR #301, August 4, 2026. | agent-plan |
| SET-22 | Create Google files in project folders from the app (medium, after SET-17; KPI-02/#52 UI dependency satisfied) | Complete — PR #217 + PR #221, July 27, 2026. | agent-plan |
| SET-23 | In-app document viewer (medium, after SET-15; UI in the FloorOpsApp queue) | — | agent-plan |
| SET-24 | Employee-login readiness card + read-only policy cards (small, after SET-13; activates fully when login goes live) | Complete — PR #158, July 24, 2026. | agent-plan |
| SET-25 | First-run data import: clients AND projects (medium-large, after SET-16) — OWNER PRIORITY (July 21) | Complete — PR #213, July 26, 2026. | agent-plan |
| SET-26 | Project-document search (small-medium, after SET-15; UI in the FloorOpsApp queue) | — | agent-plan |
| SET-27 | Reference-spreadsheet framework (medium, after SET-16) | — | agent-plan |
| SET-28 | End-user settings foundation: "My settings" (medium, after SET-13; full value after live login) | Complete — PR #87, July 21, 2026. | agent-plan |
| SET-29 | Workspace settings stage shell: status banner + four collapsible stages + InfoHint (medium-large; R2 — after the full-review R1 fix packets) | Complete — PR #115, July 22, 2026. | agent-plan |
| SET-30 | Stage 1 "Prepare the tenant" interior (small-medium, after SET-29) | Complete — PR #122, July 22, 2026. | agent-plan |
| SET-31 | Stage 2 "Connect" with health as an expander (small, after SET-30) | Complete — PR #125, July 23, 2026. | agent-plan |
| SET-32 | Stage 3 unified define-and-create surface (medium, after SET-31) | Complete — PR #129, July 23, 2026. | agent-plan |
| SET-33 | Stage 4 "Verify & maintain" (small-medium, after SET-32) | Complete — PR #133, July 23, 2026. | agent-plan |
| SET-34 | Redesign cross-cutting sweep: anchors, naming, 390 px, duplicate-status audit (small, after SET-33) | Complete — PR #138, July 23, 2026. | agent-plan |
| SET-35 | Per-user page layouts: Overview & Reports reorder + show/hide (medium, after SET-28 and FIX-05; FloorOpsApp queue) — OWNER PRIORITY (July 22) | Complete — PR #107, July 22, 2026. | agent-plan |
| SET-36 | Read-only "Who has access" card in Data & security (small, independent) | Complete — PR #157, July 23, 2026. | agent-plan |
| SET-37 | Settings & daily-use guide (docs-only; owner-approved July 23, 2026) | Complete — PR #150, July 23, 2026. | agent-plan |
| SET-38 | Stage 3 declutter: collapsible subsections + border cleanup (owner enhancement, July 24, 2026; NOT prioritized) | Complete — PR #190, July 24, 2026. | agent-plan |
| SET-39 | Visible build stamp tied to the deployed commit (small, no deps) | Complete — PR #263, July 31, 2026. | agent-plan |
| SET-40 | Effective-config extensions: every UI-manageable value through one resolver (medium, after SET-05) | Complete — PR #290, August 4, 2026. | agent-plan |
| SET-41 | Intake mailbox selected in Settings; the allowlist stays in env (medium, after SET-40) | Complete — PR #299, August 4, 2026. | agent-plan |
| SET-42 | Stale-while-revalidate everywhere: one data-freshness doctrine, zero refresh buttons (medium, after SET-40; InboxView portions after AI-12) | Complete — PR #311, August 5, 2026. | agent-plan |
| TRK-01 | Reconcile every task-tracking surface to a single source of truth (small, after BE-01) — assign together with BE-01 | Complete — PR #32, July 19, 2026. | agent-plan |
| TRK-02 | Harden merged-packet tracking against wrapped and bare-reference drift (small) | Complete — PR #66, July 20, 2026. | agent-plan |
| WS-01 | OWNER — Verify tenant preconditions, create Workspace resources (medium) | — | agent-plan |
| WS-02 | OWNER — Read-only GCP inventory, then approved API enablement + OAuth client (medium, after WS-01) | — | agent-plan |
| WS-03 | AGENT — Workspace docs reconciliation + env drift (small, no deps) — DO FIRST with BE-01 | Complete — PR #32, July 19, 2026. | agent-plan |
| WS-04 | AGENT — Rotation + token-failure recovery procedures (medium, no deps) | Complete — PR #39, July 19, 2026. | agent-plan |
| WS-05 | OWNER — Hosted env + secrets configuration (small, after WS-01..04) | — | agent-plan |
| WS-06 | OWNER — Flip to workspace mode and connect (small, after WS-05) | — | agent-plan |
| WS-07 | OWNER — Service-by-service live verification (medium, after WS-06) | — | agent-plan |
| WS-08 | OWNER — Enable Drive provisioning; provision ONE test project; verify Gmail filing end-to-end (medium, after WS-07) | — | agent-plan |
| WS-09 | AGENT+OWNER — Sheets mirror mechanics documented, then live-verified (medium, after WS-08) | — | agent-plan |
| WS-10 | AGENT — Connection-health and sync-error operator surface (medium, after WS-03) | Complete — PR #253, July 30, 2026. | agent-plan |
| WS-11 | OWNER — Development acceptance run (medium, after WS-08+09) | — | agent-plan |
| WS-12 | AGENT — Gmail watch/queue + Calendar channel contracts (medium, after WS-03; contracts + local fakes, no live resources) | Complete — PR #39, July 19, 2026. | agent-plan |
| WS-13 | AGENT — Document the dev→production connection boundary (small, after WS-03) | Complete — PR #144, July 23, 2026. | agent-plan |
| WS-14 | OWNER — Calendar-management scope review and consent re-grant (small, after WS-02; gates SET-20) | — | agent-plan |
| WS-15 | OWNER — Maps Platform billing, restricted API keys, budget alert (small, after WS-02; gates GI-03/GI-04) | — | agent-plan |
| WS-16 | OWNER — Google-native quick wins, no code (small, anytime) | — | agent-plan |
| WS-17 | Google credential severance on employee disable/offboarding (small-medium) | Complete — PR #241, July 30, 2026. | agent-plan |
| WS-18 | Decouple filed-email evidence reads from the connection key (small-medium) | Complete — PR #246, July 30, 2026. | agent-plan |
| WS-19 | Tenant cutover — make a Workspace switch survivable (medium) | Complete — PR #288, August 4, 2026. | agent-plan |
| WS-20 | Attach additional shared mailboxes to the workspace (medium-large) | In progress — `codex/ws20-shared-mailboxes` | agent-plan |
| WS-21 | Per-person shared-inbox access grants (small-medium, after WS-20) | — | agent-plan |
