# Google Chat notification boundary

Status: GI-02 source-only implementation; feature-gated off by default, not configured, not deployed, and never live-tested.

## Purpose and current scope

FCI Operations can prepare one-way Google Chat notifications for four operational events. Incoming webhooks require no OAuth scope, but each space has its own secret webhook URL. The application stores only event routing choices; webhook URLs remain hosted secrets and are never returned to the browser, stored in D1, written to Git, or included in audit detail.

| Event type | Notification | FCI destination | Current trigger |
| --- | --- | --- | --- |
| `lead.created` | New lead | `/leads?stage=new-inquiry` | Development lead creation |
| `gmail.filing_review_needed` | Filing review needed | `/inbox?bucket=needs-review` | Catalog only; no durable review-queue event exists yet |
| `calendar.schedule_changed` | Schedule change | `/schedule` | Catalog only; scheduling is not implemented |
| `project.warranty_follow_up_due` | Warranty follow-up due | `/projects?status=closeout` | Catalog only; warranty follow-up is not implemented |

The catalog-only entries are deliberate integration seams. GI-02 does not invent scheduling, warranty, or Gmail queue state to manufacture triggers.

## Hosted configuration

All values below belong in approved hosted runtime configuration. The gate is a non-secret value and defaults to `false`. Every webhook URL is a secret.

| Environment name | Purpose | Secret |
| --- | --- | --- |
| `GOOGLE_CHAT_NOTIFICATIONS_ENABLED` | Exact `true` enables the hosted delivery gate; absent, invalid, or `false` stays off | No |
| `GOOGLE_CHAT_SALES_WEBHOOK_URL` | Sales and intake Chat space | Yes |
| `GOOGLE_CHAT_OFFICE_OPS_WEBHOOK_URL` | Office operations and filing-review Chat space | Yes |
| `GOOGLE_CHAT_FIELD_WEBHOOK_URL` | Field operations Chat space | Yes |
| `GOOGLE_CHAT_SERVICE_WEBHOOK_URL` | Warranty and service Chat space | Yes |

Do not paste a webhook URL into Settings, `.env.example`, a pull request, a ticket, a log, or an audit record. The URL contains both the Google Chat key and token. This source-only packet does not authorize creating a webhook or changing hosted configuration.

Settings → Workflow & notifications reads `GET /api/v1/integrations/google/chat/config`. Office users can see the event-to-space map and the exact secret names with configured/missing presence only. Administrators may update the four event toggles and their fixed space aliases through the same-origin, bounded `PATCH` route. The endpoint never accepts or returns a URL or caller-supplied environment-variable name.

## Delivery and failure isolation

- The hosted gate and the event toggle must both be enabled. Both default to off.
- The notifier builds a bounded Google Chat `cardsV2` message with mobile `fallbackText` and one absolute HTTPS deep link chosen from the closed catalog.
- Dynamic card text is bounded and escaped. The event builders do not select dedicated contact-email, contact-phone, site-address, or financial-value fields.
- The triggering request hands delivery to the Worker execution lifetime and returns without waiting for Chat.
- One logical notification uses one request ID for its first attempt and its one possible retry.
- A transport failure, HTTP `429`, or HTTP `503` waits for a bounded backoff and retries exactly once. Other HTTP failures are terminal.
- Provider response bodies, exception messages, request objects, payloads, and webhook URLs are never logged.
- The final sanitized outcome is appended to the existing `google_integration_events` audit stream, retaining its standard actor, entity type, and entity ID columns. Audit detail is limited to source event type, fixed space key, outcome, attempt count, and a bounded error code.
- Notifier, network, configuration, and audit failures are isolated from the business request.

## Simulation and verification

Simulation resolves no webhook secret and makes no network request. When the hosted gate and an event route are enabled in a synthetic simulation test, the notifier records `chat.notification.simulated` in `google_integration_events` instead of posting. Automated acceptance covers all four payload/deep-link shapes, default-off behavior, exact one-retry behavior, non-blocking scheduling, strict config authorization/validation, rendered Administrator and read-only states, and repository/response/audit secret-leak checks.

No live Chat message is part of GI-02 acceptance. A future owner-authorized live test must create the intended space webhooks, save each URL only as its named hosted secret, review the event routes, turn on the gate, and retain only redacted audit evidence.

## Official references

- [Google Chat incoming webhooks](https://developers.google.com/workspace/chat/quickstart/webhooks)
- [Create a Chat message](https://developers.google.com/workspace/chat/api/reference/rest/v1/spaces.messages/create)
- [Chat Message and `fallbackText`](https://developers.google.com/workspace/chat/api/reference/rest/v1/spaces.messages)
- [Google Chat cards](https://developers.google.com/workspace/chat/api/reference/rest/v1/cards)
- [Google Chat quotas](https://developers.google.com/workspace/chat/limits)
- [Cloudflare Worker execution lifetime](https://developers.cloudflare.com/workers/runtime-apis/context/#waituntil)
