import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  ADMIN_ACCESS_ROLE_KEYS,
  type AdminAccessPersistenceRepository,
  type AdminAccessPersistenceResult,
  type AdminAccessRoleKey,
} from "../../ports/admin-access-persistence";
import type { AuthorizationRepository } from "../../ports/authorization";
import type {
  SecurityAuditEvent,
  SecurityAuditRepository,
} from "../../ports/security-audit";
import {
  AUTHORIZATION_ACCESS_DEFAULTS,
  normalizeAuthorizationCompanyEmail,
  resolveEmployeeAccessContext,
  type EmployeeAccessContext,
} from "../../application/authorization-policy";
import type { createAuthorizationService } from "../../application/authorization-service";
import {
  CLEAR_SESSION_COOKIE,
  readCsrfCredential,
  readSessionCredential,
  requestIsSameOrigin,
} from "./secure-session-transport.ts";

const MAX_URL_LENGTH = 2_048;
const MAX_SEARCH_LENGTH = 200;
const MAX_JSON_BODY_BYTES = 64 * 1_024;
const MAX_ADMIN_REASON_LENGTH = 500;
const MAX_ADMIN_PROJECTS = 50;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERSION_PATTERN = /^[1-9][0-9]{0,18}$/;
const GENERATED_CREDENTIAL_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

type AuthorizationService = ReturnType<typeof createAuthorizationService>;
type JsonObject = Readonly<Record<string, unknown>>;

export type EmployeeRouteActionInput = Readonly<{
  context: EmployeeAccessContext;
  projectId: string;
  fileId: string | null;
  body: JsonObject | null;
  requestId: string;
  correlationId: string;
}>;

export type EmployeeRouteTestActions = Readonly<{
  listFiles?: (input: EmployeeRouteActionInput) => Promise<unknown>;
  uploadFile?: (input: EmployeeRouteActionInput) => Promise<unknown>;
  shareFile?: (input: EmployeeRouteActionInput) => Promise<unknown>;
  fileGmailMessage?: (input: EmployeeRouteActionInput) => Promise<unknown>;
  createCalendarEvent?: (input: EmployeeRouteActionInput) => Promise<unknown>;
}>;

export type EmployeeRequestRouterDependencies = Readonly<{
  authorization: AuthorizationService;
  repository: AuthorizationRepository;
  adminAccess: AdminAccessPersistenceRepository;
  audit: SecurityAuditRepository;
  /**
   * Test-only callback seam for proving provider work cannot run after denial.
   * Production provider adapters require closed DTOs and durable authorized
   * intents and must not be composed through this option.
   */
  testActions?: EmployeeRouteTestActions;
  testMode?: boolean;
  now?: () => number;
  newId?: () => string;
  newInvitationCredential?: () => string;
}>;

type RouteMatch = Readonly<{
  kind:
    | "dashboard"
    | "search"
    | "projects"
    | "project"
    | "clients"
    | "files"
    | "files_upload"
    | "files_share"
    | "gmail_file"
    | "calendar_create"
    | "admin_invitation_create"
    | "admin_invitation_revoke"
    | "admin_user_access_change"
    | "admin_user_disable"
    | "admin_sessions_invalidate"
    | "logout";
  method: "GET" | "POST";
  projectId: string | null;
  fileId: string | null;
  adminTargetId?: string;
}>;

class HttpFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly clearSession = false,
  ) {
    super(code);
  }
}

const SESSION_DENIALS = new Set([
  "invalid_session",
  "session_revoked",
  "user_disabled",
  "outside_domain",
  "authorization_changed",
  "session_invalidated",
  "absolute_expired",
  "idle_expired",
  "role_not_approved",
]);

function uuid(value: string) {
  return UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

function route(path: string): RouteMatch | null {
  if (path === "/api/v1/dashboard") {
    return { kind: "dashboard", method: "GET", projectId: null, fileId: null };
  }
  if (path === "/api/v1/search") {
    return { kind: "search", method: "GET", projectId: null, fileId: null };
  }
  if (path === "/api/v1/projects") {
    return { kind: "projects", method: "GET", projectId: null, fileId: null };
  }
  if (path === "/api/v1/clients") {
    return { kind: "clients", method: "GET", projectId: null, fileId: null };
  }
  if (path === "/api/v1/session/logout") {
    return { kind: "logout", method: "POST", projectId: null, fileId: null };
  }
  if (path === "/api/v1/admin/invitations") {
    return {
      kind: "admin_invitation_create",
      method: "POST",
      projectId: null,
      fileId: null,
    };
  }

  const invitationRevoke = path.match(
    /^\/api\/v1\/admin\/invitations\/([^/]+)\/revoke$/,
  );
  if (invitationRevoke) {
    const invitationId = uuid(invitationRevoke[1] ?? "");
    return invitationId
      ? {
          kind: "admin_invitation_revoke",
          method: "POST",
          projectId: null,
          fileId: null,
          adminTargetId: invitationId,
        }
      : null;
  }

  const adminUserAction = path.match(
    /^\/api\/v1\/admin\/users\/([^/]+)\/(access|disable|sign-out)$/,
  );
  if (adminUserAction) {
    const userId = uuid(adminUserAction[1] ?? "");
    const action = adminUserAction[2];
    if (!userId) return null;
    return {
      kind: action === "access"
        ? "admin_user_access_change"
        : action === "disable"
          ? "admin_user_disable"
          : "admin_sessions_invalidate",
      method: "POST",
      projectId: null,
      fileId: null,
      adminTargetId: userId,
    };
  }

  const project = path.match(/^\/api\/v1\/projects\/([^/]+)$/);
  if (project) {
    const projectId = uuid(project[1] ?? "");
    return projectId
      ? { kind: "project", method: "GET", projectId, fileId: null }
      : null;
  }

  const files = path.match(/^\/api\/v1\/projects\/([^/]+)\/files$/);
  if (files) {
    const projectId = uuid(files[1] ?? "");
    return projectId
      ? { kind: "files", method: "GET", projectId, fileId: null }
      : null;
  }

  const share = path.match(
    /^\/api\/v1\/projects\/([^/]+)\/files\/([^/]+)\/share$/,
  );
  if (share) {
    const projectId = uuid(share[1] ?? "");
    const fileId = uuid(share[2] ?? "");
    return projectId && fileId
      ? { kind: "files_share", method: "POST", projectId, fileId }
      : null;
  }

  const gmail = path.match(/^\/api\/v1\/projects\/([^/]+)\/gmail\/file$/);
  if (gmail) {
    const projectId = uuid(gmail[1] ?? "");
    return projectId
      ? { kind: "gmail_file", method: "POST", projectId, fileId: null }
      : null;
  }

  const calendar = path.match(
    /^\/api\/v1\/projects\/([^/]+)\/calendar\/events$/,
  );
  if (calendar) {
    const projectId = uuid(calendar[1] ?? "");
    return projectId
      ? { kind: "calendar_create", method: "POST", projectId, fileId: null }
      : null;
  }
  return null;
}

function matchRoute(path: string, method: string | undefined): RouteMatch | null {
  const matched = route(path);
  if (!matched) return null;
  if (matched.kind === "files" && method === "POST") {
    return { ...matched, kind: "files_upload", method: "POST" };
  }
  return matched;
}

function jsonResponse(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  body: unknown,
  clearSession = false,
) {
  const payload = JSON.stringify(body);
  const headers: Record<string, string | number> = {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
  if (clearSession) headers["Set-Cookie"] = CLEAR_SESSION_COOKIE;
  response.writeHead(status, headers);
  if (request.method === "HEAD") response.end();
  else response.end(payload);
}

function discardUnreadBody(request: IncomingMessage) {
  if (!request.complete && !request.destroyed) request.resume();
}

function failureResponse(
  request: IncomingMessage,
  response: ServerResponse,
  failure: HttpFailure,
) {
  discardUnreadBody(request);
  jsonResponse(
    request,
    response,
    failure.status,
    { error: failure.code },
    failure.clearSession,
  );
}

function denialFailure(reason: string) {
  if (SESSION_DENIALS.has(reason)) {
    return new HttpFailure(401, "authentication_required", true);
  }
  if (reason === "outside_project_scope" || reason === "project_required") {
    return new HttpFailure(404, "not_found");
  }
  return new HttpFailure(403, "forbidden");
}

function sessionHash(request: IncomingMessage) {
  const credential = readSessionCredential(request);
  if (!credential.ok) {
    throw new HttpFailure(401, "authentication_required", credential.reason === "invalid");
  }
  return credential.tokenHash;
}

function contentLength(request: IncomingMessage) {
  const raw = request.headers["content-length"];
  if (Array.isArray(raw)) throw new HttpFailure(400, "invalid_request");
  if (raw === undefined) return null;
  if (!/^\d+$/.test(raw)) throw new HttpFailure(400, "invalid_request");
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) throw new HttpFailure(400, "invalid_request");
  return parsed;
}

async function jsonBody(request: IncomingMessage): Promise<JsonObject> {
  const type = request.headers["content-type"];
  if (Array.isArray(type) || !type || type.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    throw new HttpFailure(415, "unsupported_media_type");
  }
  const declaredLength = contentLength(request);
  if (declaredLength !== null && declaredLength > MAX_JSON_BODY_BYTES) {
    throw new HttpFailure(413, "request_too_large");
  }

  let length = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > MAX_JSON_BODY_BYTES) {
      throw new HttpFailure(413, "request_too_large");
    }
    chunks.push(bytes);
  }
  if (length === 0) throw new HttpFailure(400, "invalid_json");

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks, length).toString("utf8"));
  } catch {
    throw new HttpFailure(400, "invalid_json");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpFailure(400, "invalid_json");
  }
  return Object.freeze({ ...(parsed as Record<string, unknown>) });
}

function exactAdminBody(body: JsonObject, keys: readonly string[]) {
  const actual = Object.keys(body).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new HttpFailure(400, "invalid_admin_request");
  }
}

function adminText(value: unknown, maximum: number) {
  if (
    typeof value !== "string"
    || value !== value.trim()
    || value.length < 1
    || value.length > maximum
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new HttpFailure(400, "invalid_admin_request");
  }
  return value;
}

function adminEmail(value: unknown) {
  const email = normalizeAuthorizationCompanyEmail(adminText(value, 320));
  if (email === null) throw new HttpFailure(400, "invalid_admin_request");
  return email;
}

function adminRole(value: unknown): AdminAccessRoleKey {
  if (!ADMIN_ACCESS_ROLE_KEYS.includes(value as AdminAccessRoleKey)) {
    throw new HttpFailure(400, "invalid_admin_request");
  }
  return value as AdminAccessRoleKey;
}

function adminProjectIds(value: unknown, role: AdminAccessRoleKey) {
  if (!Array.isArray(value) || value.length > MAX_ADMIN_PROJECTS) {
    throw new HttpFailure(400, "invalid_admin_request");
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const projectId = typeof item === "string" ? uuid(item) : null;
    if (!projectId || seen.has(projectId)) {
      throw new HttpFailure(400, "invalid_admin_request");
    }
    seen.add(projectId);
    ids.push(projectId);
  }
  if (
    (role === "project_manager" && ids.length === 0)
    || (role !== "project_manager" && ids.length !== 0)
  ) {
    throw new HttpFailure(400, "invalid_admin_request");
  }
  return Object.freeze(ids.sort());
}

function adminVersion(value: unknown) {
  if (typeof value !== "string" || !VERSION_PATTERN.test(value)) {
    throw new HttpFailure(400, "invalid_admin_request");
  }
  try {
    if (BigInt(value) > 9_223_372_036_854_775_807n) {
      throw new HttpFailure(400, "invalid_admin_request");
    }
  } catch (error) {
    if (error instanceof HttpFailure) throw error;
    throw new HttpFailure(400, "invalid_admin_request");
  }
  return value;
}

function invitationAdminBody(body: JsonObject) {
  exactAdminBody(body, ["email", "role", "projectIds"]);
  const role = adminRole(body.role);
  return Object.freeze({
    email: adminEmail(body.email),
    role,
    projectIds: adminProjectIds(body.projectIds, role),
  });
}

function reasonAdminBody(body: JsonObject) {
  exactAdminBody(body, ["expectedVersion", "reason"]);
  return Object.freeze({
    expectedVersion: adminVersion(body.expectedVersion),
    reason: adminText(body.reason, MAX_ADMIN_REASON_LENGTH),
  });
}

function userAccessAdminBody(body: JsonObject) {
  exactAdminBody(body, ["expectedVersion", "role", "projectIds", "reason"]);
  const role = adminRole(body.role);
  return Object.freeze({
    expectedVersion: adminVersion(body.expectedVersion),
    role,
    projectIds: adminProjectIds(body.projectIds, role),
    reason: adminText(body.reason, MAX_ADMIN_REASON_LENGTH),
  });
}

function generatedInvitationCredential(value: string) {
  if (typeof value !== "string" || !GENERATED_CREDENTIAL_PATTERN.test(value)) {
    throw new Error("Generated invitation credential is invalid");
  }
  return value;
}

function invitationHash(value: string) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function adminMutationAudit(
  context: EmployeeAccessContext,
  id: string,
  action: string,
  targetType: "invitation" | "user",
  targetId: string,
  requestId: string,
  correlationId: string,
  occurredAt: number,
  metadata: Readonly<Record<string, string | number>>,
): SecurityAuditEvent {
  return {
    id,
    executorType: "user",
    executorUserId: context.userId,
    executorKey: context.email,
    originatingUserId: null,
    originatingActorKey: null,
    action,
    targetType,
    targetId,
    result: "succeeded",
    reasonCode: null,
    requestId,
    correlationId,
    source: "admin_access",
    metadata,
    occurredAt,
    retentionPolicyKey: "security_audit",
    retentionUntil: null,
  };
}

function requireAcceptedAdminMutation(result: AdminAccessPersistenceResult) {
  if (result.outcome === "accepted") return result;
  if (result.outcome === "actor_authorization_changed") {
    throw new HttpFailure(401, "authentication_required", true);
  }
  if (result.outcome === "final_active_administrator") {
    throw new HttpFailure(409, "final_active_administrator");
  }
  if (result.outcome === "stale") throw new HttpFailure(409, "access_state_stale");
  throw new HttpFailure(409, "access_conflict");
}

function requireEmptyBody(request: IncomingMessage) {
  const length = contentLength(request);
  if ((length !== null && length !== 0) || request.headers["transfer-encoding"] !== undefined) {
    throw new HttpFailure(400, "invalid_request");
  }
}

function searchQuery(url: URL) {
  if ([...url.searchParams.keys()].some((key) => key !== "q")) {
    throw new HttpFailure(400, "invalid_query");
  }
  const values = url.searchParams.getAll("q");
  if (values.length !== 1) throw new HttpFailure(400, "invalid_query");
  const query = values[0]?.trim() ?? "";
  if (!query || query.length > MAX_SEARCH_LENGTH || /[\u0000-\u001f\u007f]/.test(query)) {
    throw new HttpFailure(400, "invalid_query");
  }
  return query;
}

function requestUrl(request: IncomingMessage) {
  const raw = request.url ?? "/";
  if (raw.length > MAX_URL_LENGTH) throw new HttpFailure(414, "uri_too_long");
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("#")) {
    throw new HttpFailure(400, "invalid_request");
  }
  try {
    return new URL(raw, "http://employee-router.invalid");
  } catch {
    throw new HttpFailure(400, "invalid_request");
  }
}

async function requireMutationCredentials(
  request: IncomingMessage,
  repository: AuthorizationRepository,
  tokenHash: string,
  now: number,
  deny: (reason: "origin_mismatch" | "csrf_missing" | "csrf_invalid" | "csrf_mismatch") => Promise<never>,
) {
  if (!requestIsSameOrigin(request)) return deny("origin_mismatch");
  const csrf = readCsrfCredential(request);
  if (!csrf.ok) return deny(csrf.reason === "missing" ? "csrf_missing" : "csrf_invalid");
  if (!await repository.sessionCsrfHashMatches(tokenHash, csrf.tokenHash, now)) {
    return deny("csrf_mismatch");
  }
}

function trace(tokenHash: string, requestId: string, correlationId: string) {
  return { tokenHash, requestId, correlationId } as const;
}

const unavailable = Symbol("employee_route_action_unavailable");

export function createEmployeeRequestRouter(
  dependencies: EmployeeRequestRouterDependencies,
) {
  if (dependencies.testActions && dependencies.testMode !== true) {
    throw new Error("Employee route test actions require explicit test mode");
  }
  const now = dependencies.now ?? Date.now;
  const newId = dependencies.newId ?? randomUUID;
  const newInvitationCredential = dependencies.newInvitationCredential
    ?? (() => randomBytes(32).toString("base64url"));
  const testActions = dependencies.testMode === true ? dependencies.testActions : undefined;

  return async function handleEmployeeRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const requestId = newId();
    const correlationId = newId();
    response.setHeader("X-Request-Id", requestId);

    try {
      const url = requestUrl(request);
      const matched = matchRoute(url.pathname, request.method);
      if (!matched) throw new HttpFailure(404, "not_found");
      if (request.method !== matched.method) {
        response.setHeader(
          "Allow",
          matched.kind === "files" ? "GET, POST" : matched.method,
        );
        throw new HttpFailure(405, "method_not_allowed");
      }
      if (matched.kind !== "search" && url.search) {
        throw new HttpFailure(400, "invalid_query");
      }

      const denyTransport = async (
        reason: "origin_mismatch" | "csrf_missing" | "csrf_invalid" | "csrf_mismatch",
      ): Promise<never> => {
        const occurredAt = now();
        const event: SecurityAuditEvent = {
          id: newId(),
          executorType: "anonymous",
          executorUserId: null,
          executorKey: "anonymous",
          originatingUserId: null,
          originatingActorKey: null,
          action: "authorization.transport_denied",
          targetType: "route",
          targetId: matched.kind,
          result: "denied",
          reasonCode: reason,
          requestId,
          correlationId,
          source: "employee_route_transport",
          metadata: {
            method: matched.method,
            route_kind: matched.kind,
          },
          occurredAt,
          retentionPolicyKey: "security_audit",
          retentionUntil: null,
        };
        await dependencies.audit.append(event);
        throw new HttpFailure(403, "request_not_authorized");
      };

      if (matched.kind === "logout") {
        if (!requestIsSameOrigin(request)) {
          return await denyTransport("origin_mismatch");
        }
        requireEmptyBody(request);
        const credential = readSessionCredential(request);
        if (!credential.ok) {
          jsonResponse(request, response, 200, { outcome: "logged_out" }, true);
          return;
        }
        const csrf = readCsrfCredential(request);
        const checkedAt = now();
        if (!csrf.ok) {
          const snapshot = await dependencies.repository.findSessionByTokenHash(
            credential.tokenHash,
            checkedAt,
          );
          if (!resolveEmployeeAccessContext(snapshot, checkedAt).allowed) {
            jsonResponse(request, response, 200, { outcome: "logged_out" }, true);
            return;
          }
          return await denyTransport(
            csrf.reason === "missing" ? "csrf_missing" : "csrf_invalid",
          );
        }
        const csrfMatches = await dependencies.repository.sessionCsrfHashMatches(
          credential.tokenHash,
          csrf.tokenHash,
          checkedAt,
        );
        if (!csrfMatches) {
          const snapshot = await dependencies.repository.findSessionByTokenHash(
            credential.tokenHash,
            checkedAt,
          );
          if (resolveEmployeeAccessContext(snapshot, checkedAt).allowed) {
            await denyTransport("csrf_mismatch");
          }
          jsonResponse(request, response, 200, { outcome: "logged_out" }, true);
          return;
        }
        await dependencies.authorization.logoutSession(
          trace(credential.tokenHash, requestId, correlationId),
        );
        jsonResponse(request, response, 200, { outcome: "logged_out" }, true);
        return;
      }

      const tokenHash = sessionHash(request);
      const requestTrace = trace(tokenHash, requestId, correlationId);

      if (matched.method === "POST") {
        await requireMutationCredentials(
          request,
          dependencies.repository,
          tokenHash,
          now(),
          denyTransport,
        );
      }

      if (matched.kind === "dashboard") {
        const result = await dependencies.authorization.performDashboardView(
          requestTrace,
          (context) => dependencies.repository.getDashboardForScope(context.recordScope, now()),
        );
        if (!result.allowed) throw denialFailure(result.reason);
        jsonResponse(request, response, 200, { data: result.value });
        return;
      }

      if (matched.kind === "search") {
        const query = searchQuery(url);
        const result = await dependencies.authorization.performSearchQuery(
          requestTrace,
          (context) => dependencies.repository.searchProjectsForScope(
            context.recordScope,
            query,
            now(),
            50,
          ),
        );
        if (!result.allowed) throw denialFailure(result.reason);
        jsonResponse(request, response, 200, { data: result.value });
        return;
      }

      if (matched.kind === "projects") {
        const result = await dependencies.authorization.performProjectsList(
          requestTrace,
          (context) => dependencies.repository.listProjectsForScope(
            context.recordScope,
            now(),
            100,
          ),
        );
        if (!result.allowed) throw denialFailure(result.reason);
        jsonResponse(request, response, 200, { data: result.value });
        return;
      }

      if (matched.kind === "project" && matched.projectId) {
        const result = await dependencies.authorization.performProjectView(
          { ...requestTrace, projectId: matched.projectId },
          (context) => dependencies.repository.getProjectForScope(
            context.recordScope,
            matched.projectId!,
            now(),
          ),
        );
        if (!result.allowed) throw denialFailure(result.reason);
        if (result.value === null) throw new HttpFailure(404, "not_found");
        jsonResponse(request, response, 200, { data: result.value });
        return;
      }

      if (matched.kind === "clients") {
        const result = await dependencies.authorization.performClientsList(
          requestTrace,
          (context) => dependencies.repository.listClientsForScope(
            context.recordScope,
            now(),
            100,
          ),
        );
        if (!result.allowed) throw denialFailure(result.reason);
        jsonResponse(request, response, 200, { data: result.value });
        return;
      }

      if (matched.kind === "admin_invitation_create") {
        const result = await dependencies.authorization.performInvitationCreate(
          requestTrace,
          async (context) => {
            const input = invitationAdminBody(await jsonBody(request));
            const invitationId = newId();
            const credential = generatedInvitationCredential(newInvitationCredential());
            const createdAt = now();
            const expiresAt = createdAt + AUTHORIZATION_ACCESS_DEFAULTS.invitationLifetimeMs;
            const persistence = await dependencies.adminAccess.createInvitation({
              id: invitationId,
              email: input.email,
              tokenHash: invitationHash(credential),
              role: input.role,
              projectIds: input.projectIds,
              invitedByUserId: context.userId,
              invitedByActorKey: context.email,
              actorSessionId: context.sessionId,
              actorSessionVersion: context.sessionVersion,
              actorAuthorizationVersion: context.authorizationVersion,
              expiresAt,
              purgeAfter: expiresAt + AUTHORIZATION_ACCESS_DEFAULTS.invitationLifetimeMs,
              createdAt,
              audit: adminMutationAudit(
                context,
                newId(),
                "identity.invitation_created",
                "invitation",
                invitationId,
                requestId,
                correlationId,
                createdAt,
                { role: input.role, project_count: input.projectIds.length },
              ),
            });
            return persistence.outcome === "accepted"
              ? {
                  persistence,
                  data: Object.freeze({
                    id: invitationId,
                    email: input.email,
                    role: input.role,
                    projectIds: input.projectIds,
                    expiresAt,
                    version: persistence.version,
                    invitationCredential: credential,
                  }),
                }
              : { persistence };
          },
        );
        if (!result.allowed) throw denialFailure(result.reason);
        requireAcceptedAdminMutation(result.value.persistence);
        if (!("data" in result.value)) throw new Error("Accepted invitation result is incomplete");
        jsonResponse(request, response, 201, { data: result.value.data });
        return;
      }

      if (matched.kind === "admin_invitation_revoke" && matched.adminTargetId) {
        const result = await dependencies.authorization.performInvitationRevoke(
          requestTrace,
          async (context) => {
            const input = reasonAdminBody(await jsonBody(request));
            const changedAt = now();
            const persistence = await dependencies.adminAccess.revokeInvitation({
              invitationId: matched.adminTargetId!,
              expectedVersion: input.expectedVersion,
              actorUserId: context.userId,
              actorKey: context.email,
              actorSessionId: context.sessionId,
              actorSessionVersion: context.sessionVersion,
              actorAuthorizationVersion: context.authorizationVersion,
              reasonCode: "administrator_request",
              changedAt,
              audit: adminMutationAudit(
                context,
                newId(),
                "identity.invitation_revoked",
                "invitation",
                matched.adminTargetId!,
                requestId,
                correlationId,
                changedAt,
                { reason: input.reason },
              ),
            });
            return { persistence };
          },
        );
        if (!result.allowed) throw denialFailure(result.reason);
        const persisted = requireAcceptedAdminMutation(result.value.persistence);
        jsonResponse(request, response, 200, {
          data: { id: matched.adminTargetId, version: persisted.version, status: "revoked" },
        });
        return;
      }

      if (matched.kind === "admin_user_access_change" && matched.adminTargetId) {
        const result = await dependencies.authorization.performUserAccessChange(
          requestTrace,
          async (context) => {
            const input = userAccessAdminBody(await jsonBody(request));
            const changedAt = now();
            const persistence = await dependencies.adminAccess.setUserAccess({
              userId: matched.adminTargetId!,
              expectedVersion: input.expectedVersion,
              role: input.role,
              projectIds: input.projectIds,
              actorUserId: context.userId,
              actorKey: context.email,
              actorSessionId: context.sessionId,
              actorSessionVersion: context.sessionVersion,
              actorAuthorizationVersion: context.authorizationVersion,
              reasonCode: "administrator_request",
              changedAt,
              audit: adminMutationAudit(
                context,
                newId(),
                "authorization.user_access_changed",
                "user",
                matched.adminTargetId!,
                requestId,
                correlationId,
                changedAt,
                {
                  reason: input.reason,
                  role: input.role,
                  project_count: input.projectIds.length,
                },
              ),
            });
            return { persistence, input };
          },
        );
        if (!result.allowed) throw denialFailure(result.reason);
        const persisted = requireAcceptedAdminMutation(result.value.persistence);
        jsonResponse(request, response, 200, {
          data: {
            id: matched.adminTargetId,
            role: result.value.input.role,
            projectIds: result.value.input.projectIds,
            version: persisted.version,
            authorizationVersion: persisted.authorizationVersion,
          },
        });
        return;
      }

      if (
        (matched.kind === "admin_user_disable" || matched.kind === "admin_sessions_invalidate")
        && matched.adminTargetId
      ) {
        const perform = matched.kind === "admin_user_disable"
          ? dependencies.authorization.performUserDisable
          : dependencies.authorization.performSessionsInvalidate;
        const result = await perform(requestTrace, async (context) => {
          const input = reasonAdminBody(await jsonBody(request));
          const changedAt = now();
          const common = {
            userId: matched.adminTargetId!,
            expectedVersion: input.expectedVersion,
            actorUserId: context.userId,
            actorKey: context.email,
            actorSessionId: context.sessionId,
            actorSessionVersion: context.sessionVersion,
            actorAuthorizationVersion: context.authorizationVersion,
            reasonCode: "administrator_request",
            changedAt,
            audit: adminMutationAudit(
              context,
              newId(),
              matched.kind === "admin_user_disable"
                ? "identity.user_disabled"
                : "identity.sessions_invalidated",
              "user",
              matched.adminTargetId!,
              requestId,
              correlationId,
              changedAt,
              { reason: input.reason },
            ),
          } as const;
          const persistence = matched.kind === "admin_user_disable"
            ? await dependencies.adminAccess.disableUser(common)
            : await dependencies.adminAccess.invalidateUserSessions(common);
          return { persistence };
        });
        if (!result.allowed) throw denialFailure(result.reason);
        const persisted = requireAcceptedAdminMutation(result.value.persistence);
        jsonResponse(request, response, 200, {
          data: {
            id: matched.adminTargetId,
            status: matched.kind === "admin_user_disable" ? "disabled" : "signed_out",
            version: persisted.version,
            authorizationVersion: persisted.authorizationVersion,
          },
        });
        return;
      }

      const projectId = matched.projectId;
      if (!projectId) throw new HttpFailure(404, "not_found");
      const projectTrace = { ...requestTrace, projectId } as const;
      const input = async (
        context: EmployeeAccessContext,
        action: ((value: EmployeeRouteActionInput) => Promise<unknown>) | undefined,
      ) => {
        const parsedBody = matched.method === "POST" ? await jsonBody(request) : null;
        if (!action) return unavailable;
        return action(Object.freeze({
          context,
          projectId,
          fileId: matched.fileId,
          body: parsedBody,
          requestId,
          correlationId,
        }));
      };

      const result = matched.kind === "files"
        ? await dependencies.authorization.performFilesView(
            projectTrace,
            (context) => input(context, testActions?.listFiles),
          )
        : matched.kind === "files_upload"
          ? await dependencies.authorization.performFilesUpload(
              projectTrace,
              (context) => input(context, testActions?.uploadFile),
            )
          : matched.kind === "files_share"
            ? await dependencies.authorization.performFilesShare(
                projectTrace,
                (context) => input(context, testActions?.shareFile),
              )
            : matched.kind === "gmail_file"
              ? await dependencies.authorization.performGmailFile(
                  projectTrace,
                  (context) => input(context, testActions?.fileGmailMessage),
                )
              : matched.kind === "calendar_create"
                ? await dependencies.authorization.performCalendarCreate(
                    projectTrace,
                    (context) => input(context, testActions?.createCalendarEvent),
                  )
                : null;

      if (!result) throw new HttpFailure(404, "not_found");
      if (!result.allowed) throw denialFailure(result.reason);
      if (result.value === unavailable) {
        discardUnreadBody(request);
        jsonResponse(request, response, 503, { error: "feature_unavailable" });
        return;
      }
      jsonResponse(request, response, 200, { data: result.value });
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      if (error instanceof HttpFailure) {
        failureResponse(request, response, error);
        return;
      }
      discardUnreadBody(request);
      jsonResponse(request, response, 503, { error: "service_unavailable" });
    }
  };
}
