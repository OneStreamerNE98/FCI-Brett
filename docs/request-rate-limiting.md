# Request rate limiting

Status: Implemented and tested in source only. Not configured, deployed, or applied.

BE-10 adds bounded ingress protection to both application surfaces without changing the
single-user/test-data boundary, enabling a provider, or claiming a global quota. Allowed
requests receive no rate-limit headers and retain their existing status, headers, and
response bytes.

## Production Cloud Run contract

The Cloud Run employee boundary uses one in-memory token bucket per durable application
`userId` and process instance. The hook runs after the host-only session, role,
capability, and project-scope checks succeed, but before the protected route callback can
read a body, create a repository, or call a provider. Login and callback requests do not
yet have a durable employee identity and are outside this per-identity limiter. Logout
remains available so an employee is never trapped in a session by an exhausted bucket.

The limiter is always active. Missing variables use these bounded defaults; there is no
disable switch:

| Environment value | Default | Accepted range | Meaning |
| --- | ---: | ---: | --- |
| `FCI_REQUEST_RATE_LIMIT_CAPACITY` | `60` | 1–1,000 | Maximum burst tokens per employee identity on one instance. |
| `FCI_REQUEST_RATE_LIMIT_REFILL_TOKENS` | `60` | 1–1,000 and no greater than capacity | Tokens restored over each refill interval. |
| `FCI_REQUEST_RATE_LIMIT_REFILL_INTERVAL_MS` | `60000` | 1,000–3,600,000 | Continuous-refill interval in milliseconds. |

Invalid, fractional, zero, or out-of-range values fail configuration before the service
starts. With the defaults, one employee may burst 60 accepted operations and regains one
token per second, capped at 60.

An exhausted bucket returns `429` with the JSON body
`{"error":"rate_limited"}`, `Cache-Control: no-store`, and an integer-seconds
`Retry-After` header. Before that response, the server appends a minimized
`security.request_rate_limited` audit event containing the user ID/email already held by
the authorization context, the closed operation key, safe request/correlation IDs, the
configured policy, whether the operation was project-scoped, and the retry interval. It
never records a cookie, session digest, CSRF value, authorization header, URL query,
request body, IP address, or provider content. If audit persistence fails, the request
fails closed as the existing generic `503 service_unavailable` response and protected
work does not run.

### Per-instance limitation

This token bucket is deliberately process-local. Each Cloud Run instance has an
independent allowance, so the normal maximum of two instances can approximately double
the aggregate rate and revision overlap can temporarily increase it further. It is a
small-company abuse/cost guard, not a globally exact quota. Replacing it with shared
state would require a separately approved infrastructure and reliability decision.

## Controlled Sites development contract

The development surface applies a light fixed window immediately after the existing
same-origin and office-user checks. Each normalized office-user email receives 10
requests per 60-second window for each of four isolated scopes:

| Scope | Route | Protected cost |
| --- | --- | --- |
| `assistant` | `POST /api/v1/assistant` | OpenAI request opportunity |
| `uploads` | `POST /api/v1/uploads` | R2 object write opportunity |
| `google-sheets-sync` | `POST /api/v1/integrations/google/sheets/sync` | Google Sheets reconciliation |
| `project-drive-provisioning` | `POST /api/v1/projects/:projectId/drive` | Google Drive provisioning |

Scopes and users do not consume one another's windows. The eleventh request returns
`429`, `Cache-Control: no-store`, integer `Retry-After`, and:

```json
{
  "error": "Too many requests. Try again shortly.",
  "code": "rate_limited"
}
```

The development limiter writes no new audit row. It runs before request-body parsing,
schema setup, D1/R2 access, or a Google/OpenAI call. Unauthorized and cross-origin
requests retain their existing denial behavior and do not consume an office-user window.

## Verification and rollout boundary

Focused tests pin thresholds, refill/reset timing, user and route isolation,
`Retry-After`, the production audit event, fail-closed audit failure, exact four-route
wiring, configuration defaults/bounds, and unchanged allowed-response bytes. `npm test`
continues to build both surfaces and run the complete Node suite.

This packet changes source only. It does not deploy either surface, change a hosted
environment value, provision shared rate-limit infrastructure, apply a migration, enable
a provider, admit another user, or touch real data.
