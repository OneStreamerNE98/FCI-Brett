# Optional feature activation gates

All optional flags are `false` in staging and production. On an initial plan, a
false flag enables no optional API and creates no optional resource. The source
module only models the API gate; feature-specific queues, jobs, topics,
channels, buckets, scanners, senders, or database extensions are not created
prematurely.

For safety, enabled project services use `disable_on_destroy = false`. Turning
a flag off later removes no feature resources (none are defined here) and stops
Terraform from requesting the optional API, but it does not disable an API that
was previously enabled. API disablement is a separate reviewed operation after
dependency and shared-project checks.

Evidence for an off feature must show no queue/topic/channel/bucket/extension or
provider resource, no feature-specific IAM grant, no dispatcher or webhook
traffic, and no application activation. An enabled-but-unused API is recorded
as residual project state, not misreported as disabled.

| Flag | Default | Activation gate |
| --- | --- | --- |
| `cloud_tasks` | Off | Durable jobs/attempts/failures/replay exist; bounded retry/idempotency, monitoring, cost, owner, and rollback approved |
| `cloud_scheduler` | Off | An approved dispatcher, recovery, renewal, reconciliation, cleanup, or reminder-materialization handler exists |
| `gmail_pubsub` | Off | Durable Gmail watch/history cursor, renewal, deduplication, reconciliation, and failure handling pass |
| `calendar_webhooks` | Off | Persisted channel/resource/token/expiry/sync state and full reconciliation pass; Calendar does not use Pub/Sub |
| `upload_quarantine` | Off | Private quarantine, type/size validation, malware scan, generation-specific release, authorized download, retention, alerts, and exceptions pass |
| `sms` | Off | Provider/sender, consent, STOP/START/HELP, quiet hours, signed callbacks, unknown outcomes, retention, exception queue, and spend cap approved |
| `pgvector` | Off | Permission-filtered indexing/retrieval requirements, leakage tests, retention, cost, and operational owner approved |

Every true flag also needs an `optional_feature_approvals` record containing:

- named owner and approval reference;
- reviewed monthly cost estimate;
- monitoring/alert plan;
- durable failure and controlled replay behavior;
- disable/rollback procedure.

Enabling an API is not feature acceptance. Each feature still requires its own
reviewable source module, tests, operational evidence, and separate apply gate.
