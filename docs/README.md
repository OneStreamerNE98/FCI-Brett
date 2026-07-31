# Documentation index

One line per document, grouped by who it's for. Files stay where they are —
this index is the map. (Added July 24, 2026; keep current when adding docs.)

## For the owner

- [settings-guide.md](settings-guide.md) — the plain-English manual: using the app (everyone) + administering it, panel by panel.
- [task-checklists/](task-checklists/README.md) — the owner's setup/readiness status board (checklists 00–11).
- [brett-handoff.md](brett-handoff.md) — the one-page read-only-first Google inventory handoff for Brett.
- [nightly-reviews/](nightly-reviews/README.md) — the nightly review program: what ran each night, findings, recommendations. Specs for the six un-run nights live in [nightly-reviews/SPECS.md](nightly-reviews/SPECS.md).
- [20-user-product-and-architecture-review.md](20-user-product-and-architecture-review.md) — how the app serves a ~20-person org.

## For admins & staff

- [settings-guide.md](settings-guide.md) — same manual; Part 1 is for every user.
- [google-workspace-rollout-guide.md](google-workspace-rollout-guide.md) — first-time-admin walkthrough of the Google connection (Parts 1–15 + troubleshooting).
- [meeting-notes-and-otter.md](meeting-notes-and-otter.md) — capturing meetings and phone calls (incl. Otter workflow).
- [testing-and-google-workspace-setup.md](testing-and-google-workspace-setup.md) — validating the Workspace setup in development.

## Design authorities (specs that govern the UI)

- [dashboard-design-spec.md](dashboard-design-spec.md) — tokens, affordance grammar, brand/nav (+ [mockup](dashboard-design-mockup.html)).
- [settings-redesign-spec.md](settings-redesign-spec.md) — the four-stage Google Workspace settings design (+ [wireframe](settings-redesign-wireframe.html)).
- [ai-assistant-spec.md](ai-assistant-spec.md) — the AI layer: architecture, tool registry, safety model, canonical copy, Tier-2 gates.
- [dashboard-workspace-setup-design.md](dashboard-workspace-setup-design.md) — the setup-dashboard design decision record.
- [design-baseline/](design-baseline/) · [design-evidence/](design-evidence/) — screenshot baselines and per-packet visual evidence.

## Findings & reviews

- [independent-audit-2026-07-30-self-reviewed-changes.md](independent-audit-2026-07-30-self-reviewed-changes.md) — independent source audit of five self-reviewed behavior changes and their ledger claims.
- [full-review-2026-07-21-findings.md](full-review-2026-07-21-findings.md) — the July-21 full-codebase review (F-findings, FIX-01…12).
- [full-review-2026-07-24-findings.md](full-review-2026-07-24-findings.md) — the July-23/24 holistic post-wave review (H-findings, FIX-13…19).
- [nightly-review-2026-07-findings.md](nightly-review-2026-07-findings.md) — the rolling nightly-program ledger (N-findings, NFIX packets).
- [infohint-audit-2026-07-24.md](infohint-audit-2026-07-24.md) — the curated forms-only (i)-hint table (Workstream H authority).
- [design-critique-fix-plan.md](design-critique-fix-plan.md) — the earlier design-critique ledger (phases A/B).
- [ui-and-product-readiness-review.md](ui-and-product-readiness-review.md) · [development-section-audit.md](development-section-audit.md) · [pr-51-57-fable-review-findings.md](pr-51-57-fable-review-findings.md) — earlier review artifacts.

## Agent operations (the packet system)

- [../AGENTS.md](../AGENTS.md) — the repository operating contract for every agent and human contributor: roles, required workflow, and multi-agent coordination rules. (Added to the index July 24, 2026.)
- [agent-plan-architecture-workspace-and-setup.md](agent-plan-architecture-workspace-and-setup.md) — THE ledger: every workstream, packet, status, and sequencing rule.
- [be04-oidc-review-and-followups.md](be04-oidc-review-and-followups.md) — the OIDC packet series.
- [codex-project-handoff.md](codex-project-handoff.md) · [codex-to-codex-handoff.md](codex-to-codex-handoff.md) · [pr-51-57-claude-fable-review-handoff.md](pr-51-57-claude-fable-review-handoff.md) — agent handoff records.

## Architecture & platform (developer reference)

- [complete-product-and-google-cloud-architecture-audit.md](complete-product-and-google-cloud-architecture-audit.md) — the full architecture audit + roadmap.
- [architecture-decision-production-platform.md](architecture-decision-production-platform.md) · [architecture-decision-workspace-first-cost-controlled-rollout.md](architecture-decision-workspace-first-cost-controlled-rollout.md) — the two foundational ADRs.
- [production-persistence-boundary.md](production-persistence-boundary.md) · [production-postgresql-foundation.md](production-postgresql-foundation.md) · [production-postgresql-repositories.md](production-postgresql-repositories.md) · [development-d1-schema-migrations.md](development-d1-schema-migrations.md) — storage layers.
- [google-cloud-runtime-foundation.md](google-cloud-runtime-foundation.md) — the fail-closed Cloud Run image, private Cloud SQL connector, one-off migration command, and bounded core rehearsal. (Added to the index July 24, 2026.)
- [google-workspace-organization.md](google-workspace-organization.md) · [google-workspace-watch-and-queue-design.md](google-workspace-watch-and-queue-design.md) · [google-chat-notifications.md](google-chat-notifications.md) · [google-integration-opportunities.md](google-integration-opportunities.md) — Google integration design.
- [flooring-kpis.md](flooring-kpis.md) — the authoritative KPI definitions.
- [request-rate-limiting.md](request-rate-limiting.md) · [authorization-simulation.md](authorization-simulation.md) · [administration-and-access-plan.md](administration-and-access-plan.md) · [collaboration-and-sharing.md](collaboration-and-sharing.md) · [portable-record-creation.md](portable-record-creation.md) · [pre-workspace-development-plan.md](pre-workspace-development-plan.md) — subsystem references.

## Runbooks (operators)

- [runbooks/google-cloud/](runbooks/google-cloud/) — production Google Cloud operational runbooks.
