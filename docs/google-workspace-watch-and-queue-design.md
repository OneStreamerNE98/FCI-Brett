# Google Workspace watch, queue, and sync-state design

Status: Source contracts and local fakes only; no provider adapter or live resource

Reviewed: July 19, 2026

> **No live integration is implemented or authorized here.** This work does not create
> Gmail watches, Pub/Sub topics/subscriptions, Calendar notification channels, Cloud
> Tasks queues, Cloud Scheduler jobs, webhooks, or provider credentials. It does not
> change hosted configuration or deployment. Live activation remains blocked by the
> [production-foundation gates](task-checklists/07-production-foundation-and-migration.md).

## Decision summary

| Area | Accepted source design | Not authorized by this design |
| --- | --- | --- |
| Gmail transport | Begin with serialized scheduled polling of Gmail History for the one approved mailbox. Do not use `users.watch` or Pub/Sub for the first background-sync release. | A Gmail watch, Pub/Sub topic/subscription, push endpoint, or polling schedule. |
| Calendar transport | When separately approved, use expiring Calendar HTTPS notification channels plus periodic reconciliation. Calendar does not use Pub/Sub. | A channel, public webhook, Scheduler renewal job, or Calendar provider adapter. |
| Durable work | Application-owned leased jobs, terminal failures, and controlled replay target the existing PostgreSQL `outbox_events` pattern. Cloud Tasks may later deliver work but is never the dead-letter/replay system of record. | Queue provisioning, dispatch, worker composition, or PostgreSQL schema changes. |
| Sync state | Encrypted, key-versioned Gmail history and Calendar sync state target existing `integration_cursors` rows. | Cursor encryption/decryption, PostgreSQL adapter composition, or provider calls. |
| Otter intake | Defer a signed inbound endpoint. Continue intentional links and pasted transcripts only. | An unsigned Zapier/Otter webhook or automatic transcript ingestion. |

These choices preserve the current review-first Gmail workflow: background discovery may
populate a future review queue, but it may not file a message, apply `FCI/Filed`, send a
reply, or copy an attachment without the existing explicit exact-project approval.

## Source contract delivered in this slice

The source-only boundary consists of:

- [`DurableJobRepository`](../app/ports/durable-job.ts), which defines idempotent
  enqueue, ordered lease claims, version-fenced completion/failure, bounded retry,
  terminal failure listing, expired-lease recovery, and reasoned replay evidence;
- [`IntegrationSyncStateRepository`](../app/ports/integration-sync-state.ts), which
  defines active encrypted cursor saves, transient failure evidence, resync-required
  clearing, disablement, and expiration queries for `gmail_history`,
  `calendar_sync_token`, and separately registered `calendar_channel_token` state;
- local-only memory adapters under [`app/adapters/memory`](../app/adapters/memory); and
- focused behavior tests in
  [`tests/workspace-sync-contracts.test.mjs`](../tests/workspace-sync-contracts.test.mjs).

The adapters call no provider and create no infrastructure. They exist to settle state
semantics before a migration, live adapter, or task handler is reviewed.

## PostgreSQL mapping and current limitation

### Sync state targets `integration_cursors`

The sync-state contract maps directly to the existing migration-3 table:

| Contract field | PostgreSQL field |
| --- | --- |
| `id`, `resourceId`, `cursorKind` | `id`, `resource_id`, `cursor_kind` |
| `cursorCiphertext`, `keyVersion` | `cursor_ciphertext`, `key_version` |
| `status` | `status` (`active`, `resync_required`, `disabled`) |
| success/failure evidence | `last_success_at`, `last_error_at`, `last_error_code` |
| notification expiry | `expires_at` |
| fencing | `version` plus `updated_at` |

Cursor plaintext never belongs in a job payload, log, audit event, URL, or document. The
future encryption broker will encrypt a small provider-specific value before calling the
repository and select decryption material by the stored key version. Gmail polling stores
an encrypted history ID with `expires_at = NULL`. A Calendar resource stores only its
encrypted sync token as `calendar_sync_token`, normally with `expires_at = NULL`.

Each future Calendar notification channel is a **separate** `integration_resources` row
with its own `calendar_channel_token` cursor row. That row stores only the encrypted
verification token/key version and channel expiry. Separate resources permit old/new
channels to overlap. Marking the calendar sync token `resync_required` therefore clears
only the invalid sync token; it does not discard credentials needed to authenticate or
stop still-live channels. The existing metadata port can register a resource but cannot
yet read or transition a channel resource, so a typed PostgreSQL channel-resource
lifecycle extension remains an explicit activation blocker. No channel row is created by
this slice.

### Durable jobs target `outbox_events`

The job contract deliberately follows the implemented outbox transition model:

| Contract field | Intended `outbox_events` field |
| --- | --- |
| `id`, `jobKey`, `jobType` | `id`, `event_key`, `event_type` |
| `actorKey`, `correlationId`, `payload` | `actor_id`, `correlation_id`, `payload` |
| availability/lease/attempts | `available_at`, `lease_expires_at`, `attempt_count` |
| lifecycle | `status`, `completed_at`, `dead_lettered_at` |
| safe failure evidence | `last_error_code`, `last_error_message` |
| fencing | `version`, `updated_at` |

The current PostgreSQL `outbox_events` constraints permit only `client.created` and
`project.created`, and require exactly one client/project relationship. Therefore this
slice does **not** claim that Workspace jobs can be inserted today. Before production
composition, a separately reviewed immutable migration must extend the existing table
for workspace-scoped job types and relationships, update least-privilege/readiness
expectations, and add a PostgreSQL adapter contract test. No Workspace job may be
misrepresented as a client/project creation event to bypass those constraints.

Replay mutates only a terminal row through its current version fence, resets the bounded
attempt window, and retains the prior failure as evidence. The production implementation
must authorize the Administrator, require a nonblank reason/correlation ID, and append a
security-audit event atomically with the replay transition. Blind or bulk replay is not
allowed.

## Provider-neutral durable work lifecycle

1. A synchronous application transaction writes business state and one unique job key.
   Repeating the same key and fingerprint returns the existing job; a different
   fingerprint is a conflict.
2. A worker claims a small ordered batch using a short database transaction, increments
   the attempt and version, and commits a bounded lease before any provider call.
3. Provider work runs outside the transaction with a timeout, correlation ID, and a
   provider-operation idempotency key where the API supports one.
4. Completion is accepted only for the claimed `processing` state and exact version.
5. A transient timeout, quota response, or provider 5xx receives bounded exponential
   backoff with jitter. The caller supplies the reviewed attempt limit; the state
   transition decides retry versus terminal failure atomically.
6. `invalid_grant`/revocation is `reauthorization_required`, never a blind retry.
   Permanent validation/permission failures also become terminal.
7. An expired lease is recovered in an ordered, `SKIP LOCKED`-style bounded pass and is
   treated as a safe `lease_expired` failure, not a completed operation.
8. Terminal work appears in a human exception queue. Only an authorized, reasoned,
   audited, version-fenced replay can return it to pending.

Cloud Tasks, if later activated, carries a job ID/version hint to an authenticated Cloud
Run handler. The handler reloads authoritative state from PostgreSQL. A task payload is
not the job record, and exhausting Cloud Tasks delivery does not erase the application's
terminal failure.

## Gmail design: scheduled History polling first

### Why polling is the first transport

FCI has one approved intake mailbox. Serialized polling avoids a Pub/Sub topic,
subscription, push IAM policy, and seven-day Gmail watch renewal before those operational
controls are justified. It aligns with the rollout guide's current instruction to keep
Pub/Sub disabled. The polling cadence is an activation-time operational decision; no
schedule is created in this slice.

`users.watch` is explicitly deferred, not silently half-configured. If later volume or
latency evidence justifies push, it requires a separate design/approval that provisions
Pub/Sub, renews the watch daily (and never less often than every seven days), stores its
expiry, treats notifications only as hints, and retains periodic reconciliation.

Polling itself has no watch expiry to renew. Health is based on the scheduled job's last
success/failure and cursor age. The generic `expiresAt` contract remains available for a
future approved Gmail watch; expiry monitoring must alert before renewal is late.

### Bootstrap and incremental processing

1. Confirm one connected account equals the configured intake mailbox and the connection
   is not reauthorization-required.
2. Read a starting mailbox history ID, then perform one bounded Inbox baseline. Catch up
   from the starting ID so changes made during the baseline are not skipped.
3. Encrypt the committed history ID and save `cursor_kind = gmail_history` in
   `integration_cursors`. Store no message bodies or OAuth material in that row.
4. Each approved poll enqueues one mailbox-scoped unique job. Only one worker may process
   that mailbox cursor at a time.
5. Call Gmail History from the decrypted committed cursor and page outside a database
   transaction. Convert changes to minimized, stable application commands. A crash may
   repeat a page, so every upsert/enqueue key must be idempotent.
6. Commit the application changes and the new encrypted history cursor together only
   after the complete response is processed. Never advance the cursor on partial failure.

Gmail notification/history changes may update a future review queue, but they do not
automatically file messages, copy attachments, draft/send replies, or mutate review
labels. Current Inbox retention remains unchanged.

### Gmail failure and degraded behavior

- Timeout, 429, and eligible 5xx: retain the cursor, record safe failure evidence, retry
  within the bounded job policy, and show stale/last-success health.
- Invalid/expired history cursor: atomically clear encrypted cursor material, mark
  `resync_required`, and require a bounded baseline/catch-up job. Do not silently skip to
  the newest history ID.
- Definitive `invalid_grant`: mark the connection Reauthorization required, dead-letter
  the job, stop polling, and use the rollout guide's delete/re-authorize procedure.
- Prolonged lapse: leave existing reviewed records readable, label Inbox discovery as
  degraded/stale, alert the configured owner, and never display a false fresh timestamp.

## Calendar design: expiring HTTPS channels plus reconciliation

When the checklist gates pass, use Calendar `events.watch` HTTPS channels—not Pub/Sub.
Notifications carry change hints rather than event content, so every accepted hint only
enqueues a serialized calendar sync job.

### Initial sync and channel state

1. Run a bounded full events sync for each configured company calendar and obtain the
   provider's next sync token.
2. Create an unguessable channel ID and channel token for the exact HTTPS webhook.
   Register that channel as its own integration resource, then store the encrypted token
   in that resource's `calendar_channel_token` cursor row with its exact expiry. Keep the
   calendar's encrypted `calendar_sync_token` in the calendar resource's separate row.
3. The webhook accepts only the expected HTTPS path and exact active channel ID,
   resource ID, and channel token. It limits headers/body, logs no token, writes an
   idempotent hint job, and returns quickly without calling Calendar.
4. The worker calls incremental events sync from the committed token and transactionally
   applies event changes plus the newly encrypted token. Duplicate notifications and
   repeated pages must be harmless.

### Renewal and reconciliation

- An approved renewal sweep lists active `calendar_channel_token` rows expiring inside
  the reviewed safety window. Register a separate replacement channel/resource before
  the old channel expires.
- Accept old and new channel identifiers during a short overlap, then stop the old
  channel best-effort after the replacement is proven. An old channel notification must
  remain idempotent.
- Run a periodic reconciliation even when notifications appear healthy; notifications
  can be delayed, duplicated, or missed.
- On an invalid Calendar sync token (for example the provider's full-resync response),
  clear only the calendar resource's sync-token material, mark that cursor
  `resync_required`, and stop claiming freshness. Existing channel-token rows remain
  available for authentication and best-effort shutdown. Perform a bounded full sync,
  then decide explicitly whether to retain or replace each still-live channel before
  claiming recovery.
- On missed renewal or channel lapse, show Calendar sync as degraded, retain the last
  successful local projection, alert the owner, and reconcile before claiming recovery.

## Otter intake decision: explicitly deferred

The current product can save an intentional Otter link, pasted transcript excerpt,
summary, decisions, and action items against an exact meeting/project. That remains the
approved path.

Do not expose a generic or unsigned Otter/Zapier endpoint. A future inbound design must
first identify a provider-supported signature or use an application-owned HMAC secret,
verify timestamp and replay nonce before parsing, bound content type/body size, map to an
exact authorized project/meeting, quarantine untrusted transcript files, create audit
evidence, and enqueue idempotent work. No such endpoint, secret, or queue exists now.

## Activation gates and acceptance evidence

Before any live polling, watch, channel, queue, scheduler, or webhook exists:

- the selected Cloud Run/Cloud SQL platform, Secret Manager, identity/authorization,
  audit, backup/restore, and owner approvals in checklist 07 pass;
- an immutable PostgreSQL migration and adapter make the job contract compatible with
  `outbox_events`, with least-privilege/readiness and PostgreSQL 16 tests;
- the integration adapter can read and transition separately registered Calendar channel
  resources and their `calendar_channel_token` rows without coupling them to sync-token
  resync;
- cursor encryption supports stored key versions and the connector recovery/rotation
  drill passes;
- task/webhook authentication, timeouts, rate limits, idempotency, bounded retries,
  failed-job alerts, and controlled replay are tested;
- approved non-production Workspace resources and credentials are isolated from
  production; and
- expiration/lapse drills prove Gmail/Calendar health becomes degraded and that renewal,
  reconciliation, and no-duplicate recovery work.

Until then, the current on-demand Gmail list and Calendar test controls remain the only
implemented provider behavior, Sites remains the one-user test-data development
environment, and no second user or real client data is authorized.
