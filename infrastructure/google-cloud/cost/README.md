# Dated Google Cloud planning costs

Reviewed: July 14, 2026

These are transparent planning calculations from Google's published USD rates,
not a quote or owner-approved region. The primary region remains open. Before
provisioning, rerun the [Google Cloud Pricing Calculator](https://cloud.google.com/products/calculator)
for the approved region and attach its non-secret input/output summary to the
approval record.

## Cloud SQL comparison input

Use the same inputs for both options so availability is the only difference:

| Calculator input | Planning value |
| --- | --- |
| Product | Cloud SQL for PostgreSQL |
| Illustrative region | Iowa (`us-central1`) only; not selected |
| Edition/version | Enterprise, PostgreSQL 16 |
| Machine | Custom, 1 vCPU, 3.75 GiB memory (`db-custom-1-3840`) |
| Runtime | 730 hours/month, on-demand, no commitment |
| SSD storage | 20 GiB initial; 100 GiB autoresize ceiling |
| Backup storage assumption | 20 GiB used |
| Backup location | `us` multi-region for illustration only; owner must approve the real location |
| PITR | Enabled, 7-day transaction-log retention |
| Network egress | 0 GiB in baseline; add measured egress separately |
| Standalone option | Zonal (`ZONAL`) |
| HA option | Regional high availability (`REGIONAL`) |

Published `us-central1` Enterprise rates used for the illustration:

| Component | Standalone | Regional HA |
| --- | ---: | ---: |
| vCPU-hour | $0.0413 | $0.0826 |
| GiB memory-hour | $0.0070 | $0.0140 |
| GiB SSD-hour | $0.000232877 | $0.000465753 |
| GiB backup-hour | $0.000109589 | $0.000109589 |

Formula-based illustrative monthly result:

| Component | Standalone | Regional HA |
| --- | ---: | ---: |
| 1 vCPU + 3.75 GiB memory | $49.31 | $98.62 |
| 20 GiB SSD | $3.40 | $6.80 |
| 20 GiB used backup | $1.60 | $1.60 |
| **Illustrative Cloud SQL subtotal** | **$54.31/month** | **$107.02/month** |

The HA subtotal is about $52.71/month more for automated regional failover. It
does not decide whether that availability is worth the cost. The owner must
accept RPO/RTO, outage impact, maintenance expectations, restore evidence, and
the selected profile.

For an on-demand 24-hour staging exercise using the same illustration, the
database subtotal is about $1.79 standalone or $3.52 HA, before retained backup,
logs, network, or other services. Teardown and retained-data verification still
matter. The `$50/month` pre-production budget is an alert, not a cap.

Sources: [Cloud SQL pricing](https://cloud.google.com/sql/pricing/),
[Cloud SQL HA](https://docs.cloud.google.com/sql/docs/postgres/high-availability),
and [Cloud SQL PITR](https://docs.cloud.google.com/sql/docs/postgres/backup-recovery/configure-pitr).

## Other minimum-core calculator inputs

These costs are traffic or usage dependent and are not included in the database
subtotal:

| Service | Calculator/review input |
| --- | --- |
| Cloud Run | Approved region; request-based billing; 1 vCPU, 512 MiB, concurrency 40, min 0, max 2; estimate low/expected/peak requests, CPU time, memory time, and egress |
| Secret Manager | Six production containers or seven staging containers because employee login, the company data connector, and runtime/migration/rehearsal database credentials are separated; count active versions and accesses. The billing-account free tier currently includes six active versions and 10,000 accesses/month, shared with other projects |
| Artifact Registry | Compressed image storage, retained digests, downloads/egress, and cleanup policy after release design is approved |
| Logging/Monitoring | Expected log ingestion/retention, custom metrics, alert policy usage, uptime checks, and notification volume |
| Networking | Cross-region and internet egress; VPC and Private Service Access configuration themselves are not a spending cap |

Secret payloads are not created by Terraform. See
[Secret Manager pricing](https://cloud.google.com/secret-manager/pricing) and
[Cloud Run pricing](https://cloud.google.com/run/pricing).

## Production budget proposal

After the region, database profile, and expected traffic are approved:

1. Save the calculator date, currency, region, inputs, fixed costs, and
   usage-based assumptions without credentials or payment details.
2. Add standalone and HA totals and identify excluded taxes/support/egress.
3. Propose the production budget alert at 120-150% of the selected reviewed
   estimate.
4. Have the owner approve the amount and recipients.
5. Review actual costs after month one and monthly thereafter.

Terraform leaves the production budget at `0`, which blocks enabling the core
until this process supplies an approved positive value.

This file is a dated official-rate planning comparison, not an accepted pricing
calculator export. The region, backup location, traffic scenarios, image size,
logging volume, egress, selected database profile, and production budget remain
open owner inputs. Do not mark the final all-service cost or profile-selection
gate complete until the approved calculator evidence records those values.
