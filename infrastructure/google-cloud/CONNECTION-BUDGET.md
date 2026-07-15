# Cloud SQL connection and revision-overlap budget

The runtime source caps each Cloud Run pool at 10 and defaults to 5. Migration
and rehearsal commands each require exactly one connection. The infrastructure
starts Cloud Run at zero minimum instances and plans for at most two instances.

## Planning formula

```text
(runtime pool max × max instances × simultaneously active revisions)
+ migration connection
+ staging rehearsal connection, when applicable
+ administrator and monitoring reserve
<= reviewed usable Cloud SQL connections
```

Current planning inputs:

| Input | Staging | Production |
| --- | ---: | ---: |
| Runtime pool max | 5 | 5 |
| Maximum instances per revision | 2 | 2 |
| Overlapping revisions | 2 | 2 |
| Runtime ceiling | 20 | 20 |
| Migration | 1 | 1 |
| Rehearsal | 1 | 0 |
| Administrator/monitoring reserve | 10 | 10 |
| Planned total | **32** | **31** |
| Reviewed usable instance budget | **TBD** | **TBD** |

The `usable_connection_budget` default is `0`, so enabling the core fails until
the Cloud administrator records a verified usable value for the selected tier.
Do not equate the PostgreSQL `max_connections` setting with usable capacity:
reserve connections for platform operations, administration, monitoring,
migration, and revision overlap.

Before changing Cloud Run max instances, pool size, traffic-splitting strategy,
or database tier, recalculate the formula and capture the planned versus
observed peak. A new revision may overlap the old revision during rollout, so
`2 instances × 5 connections` is not the complete worst case.

Required evidence for staging or production approval:

- selected instance tier/profile and observed `max_connections`;
- platform/superuser reserve and the resulting usable limit;
- planned revision overlap and any tag/traffic behavior;
- active runtime, migration/rehearsal, monitoring, and administrator sessions;
- connection alert threshold and observed maximum during smoke/load testing;
- dated owner acceptance or a revised pool/instance cap.

This document is a source calculation. No Cloud SQL instance or load test has
been run by this branch.
