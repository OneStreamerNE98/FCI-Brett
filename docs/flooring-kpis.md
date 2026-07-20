# Flooring KPI definitions

Status: Tier-1 definitions implemented by KPI-01 · Pinned July 19, 2026

This document is the single source of truth for the flooring KPIs shown in **Reports → Business KPIs**. Code, tests, and future reporting work must use these definitions rather than inventing a second formula. Tier-1 deliberately uses only fields the application already captures; it does not imply that missing commercial, installation, scheduling, or review data exists.

## Shared reporting rules

- The FCI business timezone is `America/New_York`. The selected reporting month uses that timezone, including records near UTC month boundaries.
- The month selector applies only to **Booked value per month** and **Jobs completed per month**. Win rate, average job value, and sales cycle use all currently loaded retained records; backlog is a current snapshot.
- A lead outcome is its current normalized `status`: `converted` is won and `lost` is lost. Active and archived leads are not decided leads.
- Until durable status-transition timestamps land, “status became converted/completed” is approximated by the record’s `updatedAt`. A later unrelated edit can therefore move a record into a later month or lengthen its apparent sales cycle. Reports do not currently load `activity_events`; when trustworthy transition events are loaded, they may replace this fallback without changing the business definition.
- Dollar inputs are non-negative integer-dollar `estimatedValue` fields. A recorded zero is a real value. A missing or invalid optional project estimate is excluded from value averages and sums rather than silently converted to zero.
- A denominator of zero, a missing timestamp, or a backlog with no recorded values renders an em dash (`—`), never `NaN`, `Infinity`, or a fabricated zero.
- Dollar-value KPIs are shown only when the authenticated Settings identity reports `isAdmin: true`. The existing Reports pipeline total and by-stage dollar measures follow the same gate; Office users receive lead counts plus an Administrator-only explanation instead. This presentation gate is honest UI, not a replacement for server-side authorization.

## Tier-1 formulas

| KPI | Exact formula and fields | Scope | Financial visibility | Known approximation |
| --- | --- | --- | --- | --- |
| **Win rate** | `count(leads where status = converted) ÷ count(leads where status ∈ {converted, lost})`. Group the same decided-lead set by trimmed `source`; an empty source is `Unspecified`. | All currently loaded decided leads, overall and by source. | Non-financial; all office users. | Current outcome only. Historical outcome periods require durable transition records. |
| **Booked value per month** | `Σ lead.estimatedValue` for leads whose current `status = converted` and whose `updatedAt` falls in the selected FCI business month. | Selected month. | Administrator only. | `updatedAt` stands in for the conversion timestamp. |
| **Average job value** | Lead view: arithmetic mean of `estimatedValue` across current converted leads. Project view: arithmetic mean of non-null `estimatedValue` across created projects. The UI shows both outputs in one KPI card. | All currently loaded converted leads and projects. | Administrator only. | Estimates are used because contract value is not captured until KPI-02. |
| **Sales cycle days** | Arithmetic mean of `(lead.updatedAt − lead.createdAt) ÷ 86,400,000` for current converted leads with valid timestamps and `updatedAt ≥ createdAt`. | All currently loaded converted leads. | Non-financial; all office users. | `updatedAt` stands in for conversion time. |
| **Backlog** | Count projects whose normalized `status ∈ {planning, mobilizing, installation, closeout}`. Value is `Σ project.estimatedValue` across those projects with a recorded estimate; the UI also states how many backlog projects supplied a value. | Current snapshot. | Count is non-financial; estimated backlog value is Administrator only. | Estimate values are used until contract value exists. |
| **Jobs completed per month** | Count projects whose current `status = completed` and whose `updatedAt` falls in the selected FCI business month. | Selected month. | Non-financial; all office users. | `updatedAt` stands in for completion time until installation completion is captured. |

## Drill-through behavior

- Win rate links to the existing bounded Leads destination so the operator can review active and inactive lead outcomes without a parallel report-only navigation scheme.
- Backlog links to the existing Projects **Active** destination. Active project routing and the backlog formula share the accepted non-terminal lifecycle boundary; the KPI itself remains limited to the four canonical backlog statuses above.
- A KPI is not made clickable when the report records are still loading or unavailable.

## Deliberate Tier-1 exclusions

- **Gross margin:** no job-cost or cost-of-goods capture exists. Estimated value is not margin.
- **Material-versus-labor split:** no estimate-line or invoice data exists.
- **Project/install cycle time:** real installation start and completion dates do not exist yet. KPI-03 will add them; `createdAt`/`updatedAt` must not masquerade as installation dates.
- **NPS or Google review score:** external review data is not connected. A later Google Business Profile integration is a candidate for this Google-first company, not a Tier-1 dependency.
- **Crew utilization:** scheduling, crews, shifts, and authoritative assignments are not built.
- **Installed or recognized revenue:** contract, invoice, payment, and completion-value records do not exist. Booked estimated value is not accounting revenue.

## Planned refinement sequence

- **KPI-02** adds flooring category, square feet, and contract value. Booked and average values then prefer contract value with the documented estimate fallback.
- **KPI-03** adds installation dates and callback capture, replacing the completion-time fallback where those dates exist.
- **KPI-04** adds PostgreSQL parity and rehearsal coverage for the additive KPI fields after migration-version coordination.

Any refinement must update this document and the pure helper tests in the same pull request.
