# Flooring KPI definitions

Status: Tier-1 and KPI-02 booking-input definitions implemented · Pinned July 19, 2026

This document is the single source of truth for the flooring KPIs shown in **Reports → Business KPIs**. Code, tests, and future reporting work must use these definitions rather than inventing a second formula. KPI-02 adds only three booking-time project inputs—flooring category, square feet, and contract value—and does not imply that missing installation, cost, scheduling, or review data exists.

## Shared reporting rules

- The FCI business timezone is `America/New_York`. The selected reporting month uses that timezone, including records near UTC month boundaries.
- The month selector applies to **Booked value**, **Product mix**, **Revenue per square foot**, **Estimate accuracy**, and **Jobs completed**. Those booking measures use projects whose `createdAt` falls in the selected month. Win rate, average job value, and sales cycle use all currently loaded retained records; backlog is a current snapshot.
- A lead outcome is its current normalized `status`: `converted` is won and `lost` is lost. Active and archived leads are not decided leads.
- Until durable status-transition timestamps land, “status became converted/completed” is approximated by the record’s `updatedAt`. A later unrelated edit can therefore move a record into a later month or lengthen its apparent sales cycle. Reports do not currently load `activity_events`; when trustworthy transition events are loaded, they may replace this fallback without changing the business definition.
- Dollar inputs are non-negative integer-dollar `contractValue` and `estimatedValue` fields. For booked value, average job value, product-mix value share, and revenue per square foot, use a project’s recorded `contractValue` first and fall back to its `estimatedValue`; never add both. A recorded zero is a real value. Missing or invalid optional values are excluded rather than silently converted to zero.
- `flooringCategory` accepts only `hardwood`, `carpet`, `luxury-vinyl`, `tile-stone`, `laminate`, `specialty`, or `mixed`. `squareFeet` is a positive whole number. Existing projects may have all three KPI-02 fields set to null.
- A KPI-02 card says **Not yet captured** only when no project in the selected month carries the field that unlocks it: category for product mix, square feet for revenue per square foot, and contract value for estimate accuracy. If the field exists but a paired value is missing or a denominator is zero, the result is an em dash and the captured/eligible job counts explain why.
- A denominator of zero, a missing timestamp, or a backlog with no recorded values renders an em dash (`—`), never `NaN`, `Infinity`, or a fabricated zero.
- Dollar-value KPIs are shown only when the authenticated Settings identity reports `isAdmin: true`. The existing Reports pipeline total and by-stage dollar measures follow the same gate; Office users receive lead counts plus an Administrator-only explanation instead. This presentation gate is honest UI, not a replacement for server-side authorization.

## Tier-1 formulas

| KPI | Exact formula and fields | Scope | Financial visibility | Known approximation |
| --- | --- | --- | --- | --- |
| **Win rate** | `count(leads where status = converted) ÷ count(leads where status ∈ {converted, lost})`. Group the same decided-lead set by trimmed `source`; an empty source is `Unspecified`. | All currently loaded decided leads, overall and by source. | Non-financial; all office users. | Current outcome only. Historical outcome periods require durable transition records. |
| **Booked value per month** | `Σ preferredProjectValue`, where `preferredProjectValue = project.contractValue ?? project.estimatedValue`, for projects whose `createdAt` falls in the selected FCI business month. A month with no booked projects is a real `$0`; a month with projects but no recorded value is an em dash. | Selected month. | Administrator only. | Project creation is the current durable booking event. A future explicit booked transition may replace this timestamp without changing the value fallback. |
| **Average job value** | Arithmetic mean of `preferredProjectValue` across currently loaded projects with a recorded contract value or estimate. Contract value wins when both fields exist. | All currently loaded projects. | Administrator only. | This is booked/sold job value, not recognized revenue. |
| **Sales cycle days** | Arithmetic mean of `(lead.updatedAt − lead.createdAt) ÷ 86,400,000` for current converted leads with valid timestamps and `updatedAt ≥ createdAt`. | All currently loaded converted leads. | Non-financial; all office users. | `updatedAt` stands in for conversion time. |
| **Backlog** | Count projects whose normalized `status ∈ {planning, mobilizing, installation, closeout}`. Value is `Σ project.estimatedValue` across those projects with a recorded estimate; the UI also states how many backlog projects supplied a value. | Current snapshot. | Count is non-financial; estimated backlog value is Administrator only. | Estimate values are used until contract value exists. |
| **Jobs completed per month** | Count projects whose current `status = completed` and whose `updatedAt` falls in the selected FCI business month. | Selected month. | Non-financial; all office users. | `updatedAt` stands in for completion time until installation completion is captured. |
| **Product mix** | Group selected-month projects with a valid `flooringCategory`. Job count is the number in each category. Category value share is `Σ preferredProjectValue for valued jobs in category ÷ Σ preferredProjectValue for all valued categorized jobs`. A category with no valued job, or an all-zero value denominator, has an em-dash value share rather than zero. | Projects booked in the selected month. | Job counts are non-financial; value shares are Administrator only. | Uncategorized jobs are excluded and the captured-job count remains visible. |
| **Revenue per square foot** | Per eligible job: `preferredProjectValue ÷ squareFeet`. The period result is the arithmetic mean of those per-job ratios, not aggregate dollars divided by aggregate square feet. Include only jobs with positive `squareFeet` and a recorded preferred value. | Projects booked in the selected month. | Administrator only. | “Revenue” here is the booked contract/estimate value convention, not installed or recognized accounting revenue. |
| **Estimate accuracy** | Per eligible job: `contractValue ÷ estimatedValue`. The period result is the arithmetic mean of those per-job ratios. Include only jobs with both values and `estimatedValue > 0`; contract value does not fall back for this formula. | Projects booked in the selected month. | Administrator only. | A result of `100%` means contract equaled estimate; this does not measure cost or margin accuracy. |

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
- **Installed or recognized revenue:** `contractValue` is the sold price captured at booking. Invoice, payment, and completion-value records do not exist, so booked contract/estimate value is not accounting revenue.

## Planned refinement sequence

- **KPI-02 (implemented here)** adds nullable flooring category, square feet, and contract value; the formulas above pin their capture rules and the contract-to-estimate fallback.
- **KPI-03** adds installation dates and callback capture, replacing the completion-time fallback where those dates exist.
- **KPI-04** adds PostgreSQL parity and rehearsal coverage for the additive KPI fields after migration-version coordination.

Any refinement must update this document and the pure helper tests in the same pull request.
