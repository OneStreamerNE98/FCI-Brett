export const GOOGLE_CHAT_EVENT_CATALOG = [
  {
    eventType: "lead.created",
    label: "New lead",
    description: "A new lead was added to the intake pipeline.",
    defaultSpaceKey: "sales",
    deepLink: "/leads?stage=new-inquiry",
    entityType: "lead",
  },
  {
    eventType: "gmail.filing_review_needed",
    label: "Filing review needed",
    description: "A Gmail item needs an Administrator's review before filing.",
    defaultSpaceKey: "office-ops",
    deepLink: "/inbox?bucket=needs-review",
    entityType: "gmail-message",
  },
  {
    eventType: "calendar.schedule_changed",
    label: "Schedule changed",
    description: "An operational calendar schedule changed.",
    defaultSpaceKey: "field",
    deepLink: "/schedule",
    entityType: "calendar-event",
  },
  {
    eventType: "project.warranty_follow_up_due",
    label: "Warranty follow-up due",
    description: "A closeout or warranty follow-up is due.",
    defaultSpaceKey: "service",
    deepLink: "/projects?status=closeout",
    entityType: "project",
  },
] as const;

export const GOOGLE_CHAT_SPACE_CATALOG = [
  {
    spaceKey: "sales",
    label: "Sales",
    envVar: "GOOGLE_CHAT_SALES_WEBHOOK_URL",
  },
  {
    spaceKey: "office-ops",
    label: "Office operations",
    envVar: "GOOGLE_CHAT_OFFICE_OPS_WEBHOOK_URL",
  },
  {
    spaceKey: "field",
    label: "Field operations",
    envVar: "GOOGLE_CHAT_FIELD_WEBHOOK_URL",
  },
  {
    spaceKey: "service",
    label: "Service and warranty",
    envVar: "GOOGLE_CHAT_SERVICE_WEBHOOK_URL",
  },
] as const;

export const GOOGLE_CHAT_NOTIFICATIONS_GATE_ENV_VAR = "GOOGLE_CHAT_NOTIFICATIONS_ENABLED";

export type GoogleChatEventType = typeof GOOGLE_CHAT_EVENT_CATALOG[number]["eventType"];
export type GoogleChatSpaceKey = typeof GOOGLE_CHAT_SPACE_CATALOG[number]["spaceKey"];
export type GoogleChatEnvironment = Readonly<Record<string, string | undefined>>;

export type GoogleChatRoute = Readonly<{
  eventType: GoogleChatEventType;
  enabled: boolean;
  spaceKey: GoogleChatSpaceKey;
}>;

export type GoogleChatRoutingSettings = Readonly<{
  routes: readonly GoogleChatRoute[];
}>;

export type GoogleChatNotificationEvent =
  | Readonly<{
      eventType: "lead.created";
      entityId: string;
      leadNumber: string;
      company: string;
      projectName: string;
    }>
  | Readonly<{
      eventType: "gmail.filing_review_needed";
      entityId: string;
      subject: string;
      projectLabel?: string;
    }>
  | Readonly<{
      eventType: "calendar.schedule_changed";
      entityId: string;
      projectName: string;
      changeSummary: string;
    }>
  | Readonly<{
      eventType: "project.warranty_follow_up_due";
      entityId: string;
      projectName: string;
      followUpLabel: string;
    }>;

export type GoogleChatCardsV2Payload = Readonly<{
  fallbackText: string;
  cardsV2: readonly [Readonly<{
    cardId: string;
    card: Readonly<{
      header: Readonly<{
        title: string;
        subtitle: string;
      }>;
      sections: readonly [Readonly<{
        widgets: readonly [
          Readonly<{ textParagraph: Readonly<{ text: string }> }>,
          Readonly<{
            buttonList: Readonly<{
              buttons: readonly [Readonly<{
                text: string;
                altText: string;
                onClick: Readonly<{
                  openLink: Readonly<{ url: string }>;
                }>;
              }>];
            }>;
          }>,
        ];
      }>];
    }>;
  }>];
}>;

export type GoogleChatPublicConfig = Readonly<{
  featureEnabled: boolean;
  mode: "disabled" | "simulation" | "webhook";
  events: readonly Readonly<{
    type: GoogleChatEventType;
    label: string;
    description: string;
    enabled: boolean;
    spaceKey: GoogleChatSpaceKey;
  }>[];
  spaces: readonly Readonly<{
    key: GoogleChatSpaceKey;
    label: string;
    secretEnvVar: string;
    configured: boolean;
  }>[];
  missingDetails: readonly Readonly<{
    label: string;
    envVar: string;
    secret: true;
  }>[];
  updatedAt: string;
}>;

export type GoogleChatAuditRecord = Readonly<{
  eventType: "chat.notification.simulated" | "chat.notification.sent" | "chat.notification.failed";
  actor: string;
  entityType: string;
  entityId: string;
  detail: string;
}>;

export type GoogleChatDeliveryDependencies = Readonly<{
  fetch: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Pick<Response, "ok" | "status">>;
  resolveWebhook: (spaceKey: GoogleChatSpaceKey) => string | undefined | Promise<string | undefined>;
  writeAudit: (record: GoogleChatAuditRecord) => Promise<void>;
  randomUUID: () => string;
  sleep: (milliseconds: number) => Promise<void>;
  timeoutSignal: (milliseconds: number) => AbortSignal;
  retryDelayMs?: number;
  timeoutMs?: number;
}>;

export type GoogleChatDeliveryResult = Readonly<{
  outcome: "skipped" | "simulated" | "sent" | "failed";
  attempts: number;
  requestId?: string;
  errorCode?: string;
}>;

export type GoogleChatDefer = (task: Promise<void>) => void;

const EVENT_TYPES = new Set<string>(GOOGLE_CHAT_EVENT_CATALOG.map(({ eventType }) => eventType));
const SPACE_KEYS = new Set<string>(GOOGLE_CHAT_SPACE_CATALOG.map(({ spaceKey }) => spaceKey));
const ROUTE_KEYS = ["eventType", "enabled", "spaceKey"] as const;
const ROUTING_KEYS = ["routes"] as const;
const EVENT_UPDATE_KEYS = ["type", "enabled", "spaceKey"] as const;
const UPDATE_KEYS = ["events"] as const;
const DEFAULT_RETRY_DELAY_MS = 1_000;
const MIN_RETRY_DELAY_MS = 25;
const MAX_RETRY_DELAY_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 10_000;

function exactObjectKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function eventDefinition(eventType: GoogleChatEventType) {
  const definition = GOOGLE_CHAT_EVENT_CATALOG.find((candidate) => candidate.eventType === eventType);
  if (!definition) throw new Error("Unknown Google Chat event type.");
  return definition;
}

function spaceDefinition(spaceKey: GoogleChatSpaceKey) {
  const definition = GOOGLE_CHAT_SPACE_CATALOG.find((candidate) => candidate.spaceKey === spaceKey);
  if (!definition) throw new Error("Unknown Google Chat space key.");
  return definition;
}

export function defaultGoogleChatRouting(): GoogleChatRoutingSettings {
  return Object.freeze({
    routes: Object.freeze(GOOGLE_CHAT_EVENT_CATALOG.map((entry) => Object.freeze({
      eventType: entry.eventType,
      enabled: false,
      spaceKey: entry.defaultSpaceKey,
    }))),
  });
}

function parseStoredGoogleChatRouting(value: unknown): GoogleChatRoutingSettings | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (!exactObjectKeys(input, ROUTING_KEYS) || !Array.isArray(input.routes)) return null;
  if (input.routes.length !== GOOGLE_CHAT_EVENT_CATALOG.length) return null;

  const routes = new Map<GoogleChatEventType, GoogleChatRoute>();
  for (const candidate of input.routes) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const route = candidate as Record<string, unknown>;
    if (!exactObjectKeys(route, ROUTE_KEYS)) return null;
    if (typeof route.eventType !== "string" || !EVENT_TYPES.has(route.eventType)) return null;
    if (typeof route.enabled !== "boolean") return null;
    if (typeof route.spaceKey !== "string" || !SPACE_KEYS.has(route.spaceKey)) return null;
    const eventType = route.eventType as GoogleChatEventType;
    if (routes.has(eventType)) return null;
    routes.set(eventType, Object.freeze({
      eventType,
      enabled: route.enabled,
      spaceKey: route.spaceKey as GoogleChatSpaceKey,
    }));
  }

  if (routes.size !== GOOGLE_CHAT_EVENT_CATALOG.length) return null;
  return Object.freeze({
    routes: Object.freeze(GOOGLE_CHAT_EVENT_CATALOG.map(({ eventType }) => routes.get(eventType)!)),
  });
}

/** Accepts only the complete, closed routing catalog. No URL or env name is caller-controlled. */
export function parseGoogleChatRoutingUpdate(value: unknown): GoogleChatRoutingSettings | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (!exactObjectKeys(input, UPDATE_KEYS) || !Array.isArray(input.events)) return null;
  if (input.events.length !== GOOGLE_CHAT_EVENT_CATALOG.length) return null;

  const routes = new Map<GoogleChatEventType, GoogleChatRoute>();
  for (const candidate of input.events) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const event = candidate as Record<string, unknown>;
    if (!exactObjectKeys(event, EVENT_UPDATE_KEYS)) return null;
    if (typeof event.type !== "string" || !EVENT_TYPES.has(event.type)) return null;
    if (typeof event.enabled !== "boolean") return null;
    if (typeof event.spaceKey !== "string" || !SPACE_KEYS.has(event.spaceKey)) return null;
    const eventType = event.type as GoogleChatEventType;
    if (routes.has(eventType)) return null;
    routes.set(eventType, Object.freeze({
      eventType,
      enabled: event.enabled,
      spaceKey: event.spaceKey as GoogleChatSpaceKey,
    }));
  }

  if (routes.size !== GOOGLE_CHAT_EVENT_CATALOG.length) return null;
  return Object.freeze({
    routes: Object.freeze(GOOGLE_CHAT_EVENT_CATALOG.map(({ eventType }) => routes.get(eventType)!)),
  });
}

export function normalizeStoredGoogleChatRouting(value: unknown): GoogleChatRoutingSettings {
  return parseStoredGoogleChatRouting(value) ?? parseGoogleChatRoutingUpdate(value) ?? defaultGoogleChatRouting();
}

/** The feature gate is deliberately literal: whitespace/case variants remain disabled. */
export function googleChatNotificationsEnabled(environment: GoogleChatEnvironment) {
  return environment[GOOGLE_CHAT_NOTIFICATIONS_GATE_ENV_VAR] === "true";
}

function configuredSecret(environment: GoogleChatEnvironment, envVar: string) {
  const value = environment[envVar];
  return typeof value === "string" && value.trim().length > 0;
}

function publicTimestamp(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "";
  try {
    return new Date(value).toISOString();
  } catch {
    return "";
  }
}

export function buildGoogleChatPublicConfig(input: Readonly<{
  environment: GoogleChatEnvironment;
  simulation: boolean;
  routing: GoogleChatRoutingSettings;
  updatedAt: number | null;
}>): GoogleChatPublicConfig {
  const notificationsEnabled = googleChatNotificationsEnabled(input.environment);
  const routing = normalizeStoredGoogleChatRouting(input.routing);
  const spaces = GOOGLE_CHAT_SPACE_CATALOG.map((space) => Object.freeze({
    key: space.spaceKey,
    label: space.label,
    secretEnvVar: space.envVar,
    configured: configuredSecret(input.environment, space.envVar),
  }));
  const configuredByKey = new Map(spaces.map((space) => [space.key, space.configured]));
  const missingSpaceKeys = new Set<GoogleChatSpaceKey>();
  if (notificationsEnabled && !input.simulation) {
    for (const route of routing.routes) {
      if (route.enabled && !configuredByKey.get(route.spaceKey)) missingSpaceKeys.add(route.spaceKey);
    }
  }
  const missingDetails = GOOGLE_CHAT_SPACE_CATALOG
    .filter((space) => missingSpaceKeys.has(space.spaceKey))
    .map((space) => Object.freeze({
      label: `${space.label} Google Chat webhook`,
      envVar: space.envVar,
      secret: true as const,
    }));

  return Object.freeze({
    featureEnabled: notificationsEnabled,
    mode: notificationsEnabled ? (input.simulation ? "simulation" : "webhook") : "disabled",
    events: Object.freeze(GOOGLE_CHAT_EVENT_CATALOG.map((entry) => {
      const route = routing.routes.find((candidate) => candidate.eventType === entry.eventType)!;
      return Object.freeze({
        type: entry.eventType,
        label: entry.label,
        description: entry.description,
        enabled: route.enabled,
        spaceKey: route.spaceKey,
      });
    })),
    spaces: Object.freeze(spaces),
    missingDetails: Object.freeze(missingDetails),
    updatedAt: publicTimestamp(input.updatedAt),
  });
}

function cleanDynamicText(value: string, maximum: number, fallback: string) {
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return (cleaned || fallback).slice(0, maximum);
}

function escapeCardText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function eventSummary(event: GoogleChatNotificationEvent) {
  switch (event.eventType) {
    case "lead.created":
      return `${cleanDynamicText(event.leadNumber, 48, "New lead")} · ${cleanDynamicText(event.company, 120, "Company not provided")} · ${cleanDynamicText(event.projectName, 120, "Project not provided")}`;
    case "gmail.filing_review_needed": {
      const subject = cleanDynamicText(event.subject, 180, "Message subject unavailable");
      const project = event.projectLabel ? ` · ${cleanDynamicText(event.projectLabel, 120, "")}` : "";
      return `${subject}${project}`;
    }
    case "calendar.schedule_changed":
      return `${cleanDynamicText(event.projectName, 120, "Project not provided")} · ${cleanDynamicText(event.changeSummary, 180, "Schedule details changed")}`;
    case "project.warranty_follow_up_due":
      return `${cleanDynamicText(event.projectName, 120, "Project not provided")} · ${cleanDynamicText(event.followUpLabel, 120, "Follow-up is due")}`;
  }
}

function absoluteDeepLink(appOrigin: string, path: string) {
  const origin = new URL(appOrigin);
  if (origin.protocol !== "https:" || !origin.hostname || origin.username || origin.password) {
    throw new Error("Google Chat deep-link origin must be HTTPS.");
  }
  return new URL(path, origin.origin).href;
}

export function buildGoogleChatPayload(
  event: GoogleChatNotificationEvent,
  appOrigin: string,
): GoogleChatCardsV2Payload {
  const definition = eventDefinition(event.eventType);
  const summary = eventSummary(event);
  const deepLink = absoluteDeepLink(appOrigin, definition.deepLink);
  return Object.freeze({
    fallbackText: `${definition.label}: ${summary}`.slice(0, 500),
    cardsV2: Object.freeze([Object.freeze({
      cardId: `fci-${definition.eventType.replaceAll(".", "-")}`,
      card: Object.freeze({
        header: Object.freeze({
          title: definition.label,
          subtitle: "FCI Operations",
        }),
        sections: Object.freeze([Object.freeze({
          widgets: Object.freeze([
            Object.freeze({ textParagraph: Object.freeze({ text: escapeCardText(summary) }) }),
            Object.freeze({
              buttonList: Object.freeze({
                buttons: Object.freeze([Object.freeze({
                  text: "Open in FCI Operations",
                  altText: "Open this item in FCI Operations",
                  onClick: Object.freeze({
                    openLink: Object.freeze({ url: deepLink }),
                  }),
                })]),
              }),
            }),
          ]),
        })]),
      }),
    })]),
  }) as GoogleChatCardsV2Payload;
}

function validRequestId(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function safeEntityId(value: string) {
  return cleanDynamicText(value, 200, "unknown");
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  if (!Number.isSafeInteger(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, value!));
}

/** Returns a validated URL only to the delivery call; callers must never log or serialize it. */
function validGoogleChatWebhook(value: string | undefined) {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.host !== "chat.googleapis.com") return null;
    if (url.username || url.password || url.hash) return null;
    if (!/^\/v1\/spaces\/[A-Za-z0-9_-]+\/messages$/u.test(url.pathname)) return null;
    if (url.searchParams.getAll("key").length !== 1 || !url.searchParams.get("key")?.trim()) return null;
    if (url.searchParams.getAll("token").length !== 1 || !url.searchParams.get("token")?.trim()) return null;
    if ([...url.searchParams.keys()].some((key) => key !== "key" && key !== "token")) return null;
    return url.href;
  } catch {
    return null;
  }
}

function auditDetail(input: Readonly<{
  sourceEventType: GoogleChatEventType;
  spaceKey: GoogleChatSpaceKey;
  outcome: "simulated" | "sent" | "failed";
  attempts: number;
  errorCode?: string;
}>) {
  return JSON.stringify(input);
}

async function writeAuditSafely(
  dependencies: GoogleChatDeliveryDependencies,
  input: Readonly<{
    event: GoogleChatNotificationEvent;
    actor: string;
    spaceKey: GoogleChatSpaceKey;
    auditEventType: GoogleChatAuditRecord["eventType"];
    outcome: "simulated" | "sent" | "failed";
    attempts: number;
    errorCode?: string;
  }>,
) {
  const definition = eventDefinition(input.event.eventType);
  try {
    await dependencies.writeAudit({
      eventType: input.auditEventType,
      actor: input.actor,
      entityType: definition.entityType,
      entityId: safeEntityId(input.event.entityId),
      detail: auditDetail({
        sourceEventType: input.event.eventType,
        spaceKey: input.spaceKey,
        outcome: input.outcome,
        attempts: input.attempts,
        ...(input.errorCode ? { errorCode: input.errorCode } : {}),
      }),
    });
  } catch {
    // Audit failure must not escape into the business request or delivery task.
  }
}

async function failedResult(
  dependencies: GoogleChatDeliveryDependencies,
  input: Readonly<{
    event: GoogleChatNotificationEvent;
    actor: string;
    spaceKey: GoogleChatSpaceKey;
    attempts: number;
    requestId?: string;
    errorCode: string;
  }>,
): Promise<GoogleChatDeliveryResult> {
  await writeAuditSafely(dependencies, {
    ...input,
    auditEventType: "chat.notification.failed",
    outcome: "failed",
  });
  return Object.freeze({
    outcome: "failed",
    attempts: input.attempts,
    ...(input.requestId ? { requestId: input.requestId } : {}),
    errorCode: input.errorCode,
  });
}

export async function deliverGoogleChatNotification(
  event: GoogleChatNotificationEvent,
  actor: string,
  appOrigin: string,
  config: Readonly<{
    notificationsEnabled: boolean;
    simulation: boolean;
    routing: GoogleChatRoutingSettings;
  }>,
  dependencies: GoogleChatDeliveryDependencies,
): Promise<GoogleChatDeliveryResult> {
  const route = config.routing.routes.find((candidate) => candidate.eventType === event.eventType);
  if (!config.notificationsEnabled || !route?.enabled) {
    return Object.freeze({ outcome: "skipped", attempts: 0 });
  }

  let requestId: string | undefined;
  try {
    const candidate = dependencies.randomUUID();
    if (validRequestId(candidate)) requestId = candidate;
  } catch {
    // The stable provider id is required, but exception details are never retained.
  }
  if (!requestId) {
    return failedResult(dependencies, {
      event,
      actor,
      spaceKey: route.spaceKey,
      attempts: 0,
      errorCode: "invalid_request_id",
    });
  }
  if (config.simulation) {
    await writeAuditSafely(dependencies, {
      event,
      actor,
      spaceKey: route.spaceKey,
      auditEventType: "chat.notification.simulated",
      outcome: "simulated",
      attempts: 0,
    });
    return Object.freeze({ outcome: "simulated", attempts: 0, requestId });
  }

  let webhookValue: string | undefined;
  try {
    webhookValue = await dependencies.resolveWebhook(route.spaceKey);
  } catch {
    return failedResult(dependencies, {
      event,
      actor,
      spaceKey: route.spaceKey,
      attempts: 0,
      requestId,
      errorCode: "secret_unavailable",
    });
  }
  const webhook = validGoogleChatWebhook(webhookValue);
  if (!webhook) {
    return failedResult(dependencies, {
      event,
      actor,
      spaceKey: route.spaceKey,
      attempts: 0,
      requestId,
      errorCode: webhookValue ? "invalid_webhook_secret" : "missing_webhook_secret",
    });
  }

  let body: string;
  try {
    body = JSON.stringify(buildGoogleChatPayload(event, appOrigin));
  } catch {
    return failedResult(dependencies, {
      event,
      actor,
      spaceKey: route.spaceKey,
      attempts: 0,
      requestId,
      errorCode: "invalid_notification",
    });
  }

  // Append Google's idempotency key only after the secret URL passes the exact
  // Chat host/path/key/token validation above. The same URL is reused on retry.
  const deliveryUrl = new URL(webhook);
  deliveryUrl.searchParams.set("requestId", requestId);

  const retryDelayMs = boundedInteger(
    dependencies.retryDelayMs,
    DEFAULT_RETRY_DELAY_MS,
    MIN_RETRY_DELAY_MS,
    MAX_RETRY_DELAY_MS,
  );
  const timeoutMs = boundedInteger(
    dependencies.timeoutMs,
    DEFAULT_TIMEOUT_MS,
    MIN_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
  );
  let attempts = 0;
  let errorCode = "network_error";

  while (attempts < 2) {
    attempts += 1;
    let retryable = false;
    try {
      const response = await dependencies.fetch(deliveryUrl.href, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
        body,
        redirect: "error",
        signal: dependencies.timeoutSignal(timeoutMs),
      });
      if (response.ok) {
        await writeAuditSafely(dependencies, {
          event,
          actor,
          spaceKey: route.spaceKey,
          auditEventType: "chat.notification.sent",
          outcome: "sent",
          attempts,
        });
        return Object.freeze({ outcome: "sent", attempts, requestId });
      }
      if (response.status === 429 || response.status === 503) {
        retryable = true;
        errorCode = `provider_${response.status}`;
      } else {
        errorCode = "provider_rejected";
      }
    } catch {
      retryable = true;
      errorCode = "network_error";
    }

    if (!retryable || attempts >= 2) break;
    try {
      await dependencies.sleep(retryDelayMs);
    } catch {
      errorCode = "backoff_failed";
      break;
    }
  }

  return failedResult(dependencies, {
    event,
    actor,
    spaceKey: route.spaceKey,
    attempts,
    requestId,
    errorCode,
  });
}

/**
 * Registers a lazy, fully caught task. If the runtime rejects deferral, the
 * provider operation never starts and no exception reaches the caller.
 */
export function deferGoogleChatTask(
  defer: GoogleChatDefer,
  task: () => Promise<unknown>,
): void {
  let accepted = false;
  const scheduled = Promise.resolve()
    .then(async () => {
      if (accepted) await task();
    })
    .catch(() => undefined);
  try {
    defer(scheduled);
    accepted = true;
  } catch {
    // The triggering business request remains successful if deferral is unavailable.
  }
}

export function googleChatWebhookEnvironmentName(spaceKey: GoogleChatSpaceKey) {
  return spaceDefinition(spaceKey).envVar;
}
