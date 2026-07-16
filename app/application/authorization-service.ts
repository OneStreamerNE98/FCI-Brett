import type { AuthorizationRepository } from "../ports/authorization";
import type { IdentityPersistenceRepository } from "../ports/identity-persistence";
import type {
  SecurityAuditEvent,
  SecurityAuditRepository,
} from "../ports/security-audit";
import {
  authorizeOperation,
  AUTHORIZATION_OPERATIONS,
  isAuthorizationOperation,
  resolveEmployeeAccessContext,
  resolveFieldLinkAccess,
  type AccessContext,
  type AuthorizationCapability,
  type EmployeeAccessContext,
  type FieldLinkAccessContext,
  type FieldLinkDenialReason,
  type FieldLinkSnapshot,
  type OperationDenialReason,
  type SessionDenialReason,
} from "./authorization-policy";

export type AuthorizationRequest = Readonly<{
  tokenHash: string;
  operation: string;
  projectId: string | null;
  requestId: string | null;
  correlationId: string;
}>;

export type AuthorizationDenialReason =
  | SessionDenialReason
  | OperationDenialReason
  | FieldLinkDenialReason;

export type AuthorizationServiceDecision =
  | Readonly<{
      allowed: true;
      context: EmployeeAccessContext;
    }>
  | Readonly<{
      allowed: false;
      reason: AuthorizationDenialReason;
    }>;

export type EmployeeOperationResult<T> =
  | Extract<AuthorizationServiceDecision, Readonly<{ allowed: false }>>
  | Readonly<{
      allowed: true;
      context: EmployeeAccessContext;
      value: T;
    }>;

export type FieldAuthorizationRequest = Omit<AuthorizationRequest, "tokenHash">;

export type FieldAuthorizationDecision =
  | Readonly<{ allowed: true; context: FieldLinkAccessContext }>
  | Readonly<{ allowed: false; reason: OperationDenialReason | FieldLinkDenialReason }>;

export type FieldOperationResult<T> =
  | Extract<FieldAuthorizationDecision, Readonly<{ allowed: false }>>
  | Readonly<{
      allowed: true;
      context: FieldLinkAccessContext;
      value: T;
    }>;

export type LogoutRequest = Readonly<{
  tokenHash: string;
  requestId: string | null;
  correlationId: string;
}>;

export type LogoutResult = Readonly<{ outcome: "logged_out" }>;

export type AuthorizationTraceRequest = Readonly<{
  tokenHash: string;
  requestId: string | null;
  correlationId: string;
}>;

export type ProjectAuthorizationTraceRequest = AuthorizationTraceRequest & Readonly<{
  projectId: string;
}>;

export type OptionalProjectAuthorizationTraceRequest = AuthorizationTraceRequest & Readonly<{
  projectId: string | null;
}>;

export type FieldAuthorizationTraceRequest = Readonly<{
  projectId: string;
  requestId: string | null;
  correlationId: string;
}>;

export type AuthorizationServiceDependencies = Readonly<{
  repository: AuthorizationRepository;
  sessions: Pick<IdentityPersistenceRepository, "revokeSession">;
  audit: SecurityAuditRepository;
  now?: () => number;
  newId: () => string;
}>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requiredUuid(value: string, label: string) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a canonical UUID`);
  }
  return value.toLowerCase();
}

function optionalUuid(value: string | null, label: string) {
  return value === null ? null : requiredUuid(value, label);
}

function stableAuthorizationRequest(request: AuthorizationRequest): AuthorizationRequest;
function stableAuthorizationRequest(request: FieldAuthorizationRequest): FieldAuthorizationRequest;
function stableAuthorizationRequest(
  request: AuthorizationRequest | FieldAuthorizationRequest,
): AuthorizationRequest | FieldAuthorizationRequest {
  return Object.freeze({
    ...request,
    projectId: optionalUuid(request.projectId, "Authorization project ID"),
    requestId: optionalUuid(request.requestId, "Authorization request ID"),
    correlationId: requiredUuid(request.correlationId, "Authorization correlation ID"),
  });
}

function stableLogoutRequest(request: LogoutRequest): LogoutRequest {
  return Object.freeze({
    ...request,
    requestId: optionalUuid(request.requestId, "Logout request ID"),
    correlationId: requiredUuid(request.correlationId, "Logout correlation ID"),
  });
}

function stableFieldLinkSnapshot(snapshot: FieldLinkSnapshot): FieldLinkSnapshot {
  return Object.freeze({
    ...snapshot,
    linkId: requiredUuid(snapshot.linkId, "Field-link ID"),
    projectId: requiredUuid(snapshot.projectId, "Field-link project ID"),
  });
}

function authorizationAuditEvent(
  context: AccessContext | null,
  request: Pick<AuthorizationRequest, "operation" | "projectId" | "requestId" | "correlationId">,
  id: string,
  occurredAt: number,
  allowed: boolean,
  reason: AuthorizationDenialReason | null,
): SecurityAuditEvent {
  const employee = context?.principalKind === "employee" ? context : null;
  const fieldLink = context?.principalKind === "field_link" ? context : null;
  const recordedOperation = isAuthorizationOperation(request.operation)
    ? request.operation
    : "unknown";
  return {
    id,
    executorType: employee ? "user" : fieldLink ? "external" : "anonymous",
    executorUserId: employee?.userId ?? null,
    executorKey: employee?.email ?? (fieldLink ? `field_link:${fieldLink.linkId}` : "anonymous"),
    originatingUserId: null,
    originatingActorKey: null,
    action: allowed ? "authorization.access_allowed" : "authorization.access_denied",
    targetType: request.projectId !== null ? "project" : "operation",
    targetId: request.projectId ?? recordedOperation,
    result: allowed ? "succeeded" : "denied",
    reasonCode: reason,
    requestId: request.requestId,
    correlationId: request.correlationId,
    source: "authorization",
    metadata: {
      operation: recordedOperation,
      principal_kind: context?.principalKind ?? "anonymous",
      project_scoped: request.projectId !== null,
    },
    occurredAt,
    retentionPolicyKey: "security_audit",
    retentionUntil: null,
  };
}

export function createAuthorizationService(
  dependencies: AuthorizationServiceDependencies,
) {
  const now = dependencies.now ?? Date.now;

  async function appendDecisionAudit(
    context: AccessContext | null,
    request: Pick<AuthorizationRequest, "operation" | "projectId" | "requestId" | "correlationId">,
    allowed: boolean,
    reason: AuthorizationDenialReason | null,
    occurredAt: number,
  ) {
    await dependencies.audit.append(authorizationAuditEvent(
      context,
      request,
      requiredUuid(dependencies.newId(), "Authorization audit event ID"),
      occurredAt,
      allowed,
      reason,
    ));
  }

  async function authorizeSession(
    request: AuthorizationRequest,
  ): Promise<AuthorizationServiceDecision> {
    const stableRequest = stableAuthorizationRequest(request);
    const checkedAt = now();
    const snapshot = await dependencies.repository.findSessionByTokenHash(
      stableRequest.tokenHash,
      checkedAt,
    );
    const session = resolveEmployeeAccessContext(snapshot, checkedAt);
    if (!session.allowed) {
      const knownContext: EmployeeAccessContext | null = snapshot
        ? ({
            principalKind: "employee",
            sessionId: snapshot.sessionId,
            sessionVersion: snapshot.sessionVersion,
            userId: snapshot.userId,
            email: snapshot.email.trim().toLowerCase(),
            authorizationVersion: snapshot.userAuthorizationVersion,
            roles: [],
            capabilities: new Set<AuthorizationCapability>(),
            recordScope: {
              kind: "assigned_projects",
              sessionId: snapshot.sessionId,
              sessionVersion: snapshot.sessionVersion,
              userId: snapshot.userId,
              authorizationVersion: snapshot.userAuthorizationVersion,
              includeFinancial: false,
            },
          } as const)
        : null;
      await appendDecisionAudit(knownContext, stableRequest, false, session.reason, checkedAt);
      return { allowed: false, reason: session.reason };
    }

    const operation = authorizeOperation(
      session.context,
      stableRequest.operation,
      stableRequest.projectId,
    );
    if (!operation.allowed) {
      await appendDecisionAudit(
        session.context,
        stableRequest,
        false,
        operation.reason,
        checkedAt,
      );
      return { allowed: false, reason: operation.reason };
    }

    if (
      operation.requiresProjectCheck &&
      stableRequest.projectId !== null &&
      !await dependencies.repository.projectExistsForScope(
        session.context.recordScope,
        stableRequest.projectId,
        checkedAt,
      )
    ) {
      await appendDecisionAudit(
        session.context,
        stableRequest,
        false,
        "outside_project_scope",
        checkedAt,
      );
      return { allowed: false, reason: "outside_project_scope" };
    }

    if (
      operation.sensitive &&
      !await dependencies.repository.capabilityIsCurrentForScope(
        session.context.recordScope,
        operation.capability,
        stableRequest.projectId,
        checkedAt,
      )
    ) {
      await appendDecisionAudit(
        session.context,
        stableRequest,
        false,
        "missing_capability",
        checkedAt,
      );
      return { allowed: false, reason: "missing_capability" };
    }

    // Routine scoped reads rely on normal request telemetry. Sensitive allows
    // are recorded before a provider or mutation callback can run, so an audit
    // failure fails closed.
    if (operation.sensitive) {
      await appendDecisionAudit(session.context, stableRequest, true, null, checkedAt);
    }
    return { allowed: true, context: session.context };
  }

  async function authorizeFieldLink(
    snapshot: FieldLinkSnapshot,
    request: FieldAuthorizationRequest,
  ): Promise<FieldAuthorizationDecision> {
    const stableSnapshot = stableFieldLinkSnapshot(snapshot);
    const stableRequest = stableAuthorizationRequest(request);
    const checkedAt = now();
    const link = resolveFieldLinkAccess(stableSnapshot, checkedAt);
    if (!link.allowed) {
      const knownContext: FieldLinkAccessContext = {
        principalKind: "field_link",
        linkId: stableSnapshot.linkId,
        projectId: stableSnapshot.projectId,
        capabilities: new Set<AuthorizationCapability>(),
      };
      await appendDecisionAudit(knownContext, stableRequest, false, link.reason, checkedAt);
      return { allowed: false, reason: link.reason };
    }
    const operation = authorizeOperation(
      link.context,
      stableRequest.operation,
      stableRequest.projectId,
    );
    if (!operation.allowed) {
      await appendDecisionAudit(link.context, stableRequest, false, operation.reason, checkedAt);
      return { allowed: false, reason: operation.reason };
    }
    if (operation.sensitive) {
      await appendDecisionAudit(link.context, stableRequest, true, null, checkedAt);
    }
    return { allowed: true, context: link.context };
  }

  async function logoutSession(request: LogoutRequest): Promise<LogoutResult> {
    const stableRequest = stableLogoutRequest(request);
    const revokedAt = now();
    const snapshot = await dependencies.repository.findSessionByTokenHash(
      stableRequest.tokenHash,
      revokedAt,
    );
    if (!snapshot || snapshot.revokedAt !== null) return { outcome: "logged_out" };

    const actorKey = snapshot.email.trim().toLowerCase();
    const audit: SecurityAuditEvent = {
      id: requiredUuid(dependencies.newId(), "Logout audit event ID"),
      executorType: "user",
      executorUserId: snapshot.userId,
      executorKey: actorKey,
      originatingUserId: null,
      originatingActorKey: null,
      action: "identity.session_revoked",
      targetType: "session",
      targetId: snapshot.sessionId,
      result: "succeeded",
      reasonCode: "logout",
      requestId: stableRequest.requestId,
      correlationId: stableRequest.correlationId,
      source: "authorization",
      metadata: { trigger: "user_logout" },
      occurredAt: revokedAt,
      retentionPolicyKey: "security_audit",
      retentionUntil: null,
    };
    const revocation = await dependencies.sessions.revokeSession({
      sessionId: snapshot.sessionId,
      expectedVersion: snapshot.sessionVersion,
      revokedAt,
      revokedByActorKey: actorKey,
      reasonCode: "logout",
      audit,
    });
    if (revocation.outcome !== "accepted") {
      // A concurrent logout is successful only when the credential no longer
      // resolves. Never report success while a reusable session survived a
      // stale-version or conflict result.
      const remaining = await dependencies.repository.findSessionByTokenHash(
        stableRequest.tokenHash,
        revokedAt,
      );
      if (remaining && remaining.revokedAt === null) {
        throw new Error("Session logout could not confirm revocation");
      }
    }
    // Logout is deliberately idempotent: a concurrent revocation and an
    // unknown credential produce the same external result.
    return { outcome: "logged_out" };
  }

  async function performEmployeeOperation<T>(
    operation: string,
    request: AuthorizationTraceRequest & Readonly<{ projectId: string | null }>,
    work: (context: EmployeeAccessContext) => Promise<T>,
  ): Promise<EmployeeOperationResult<T>> {
    // `operation` is supplied only by the named wrappers below. It is written
    // after the caller-controlled fields so a forged runtime property cannot
    // relabel the protected action.
    const decision = await authorizeSession({ ...request, operation });
    if (!decision.allowed) return decision;
    const value = await work(decision.context);
    return { ...decision, value };
  }

  async function performFieldOperation<T>(
    snapshot: FieldLinkSnapshot,
    operation: string,
    request: FieldAuthorizationTraceRequest,
    work: (authorized: FieldLinkAccessContext) => Promise<T>,
  ): Promise<FieldOperationResult<T>> {
    const decision = await authorizeFieldLink(snapshot, { ...request, operation });
    if (!decision.allowed) return decision;
    const value = await work(decision.context);
    return { ...decision, value };
  }

  function noProjectRequest(request: AuthorizationTraceRequest) {
    return { ...request, projectId: null } as const;
  }

  return Object.freeze({
    logoutSession,
    performDashboardView<T>(
      request: AuthorizationTraceRequest,
      work: (context: EmployeeAccessContext) => Promise<T>,
    ) {
      return performEmployeeOperation(
        AUTHORIZATION_OPERATIONS.dashboardView,
        noProjectRequest(request),
        work,
      );
    },
    performSearchQuery<T>(
      request: AuthorizationTraceRequest,
      work: (context: EmployeeAccessContext) => Promise<T>,
    ) {
      return performEmployeeOperation(
        AUTHORIZATION_OPERATIONS.searchQuery,
        noProjectRequest(request),
        work,
      );
    },
    performProjectsList<T>(
      request: AuthorizationTraceRequest,
      work: (context: EmployeeAccessContext) => Promise<T>,
    ) {
      return performEmployeeOperation(
        AUTHORIZATION_OPERATIONS.projectsList,
        noProjectRequest(request),
        work,
      );
    },
    performProjectView<T>(
      request: ProjectAuthorizationTraceRequest,
      work: (context: EmployeeAccessContext) => Promise<T>,
    ) {
      return performEmployeeOperation(AUTHORIZATION_OPERATIONS.projectView, request, work);
    },
    performClientsList<T>(
      request: AuthorizationTraceRequest,
      work: (context: EmployeeAccessContext) => Promise<T>,
    ) {
      return performEmployeeOperation(
        AUTHORIZATION_OPERATIONS.clientsList,
        noProjectRequest(request),
        work,
      );
    },
    performFinancialsView<T>(
      request: OptionalProjectAuthorizationTraceRequest,
      work: (context: EmployeeAccessContext) => Promise<T>,
    ) {
      return performEmployeeOperation(AUTHORIZATION_OPERATIONS.financialsView, request, work);
    },
    performProjectCreate<T>(
      request: AuthorizationTraceRequest,
      work: (context: EmployeeAccessContext) => Promise<T>,
    ) {
      return performEmployeeOperation(
        AUTHORIZATION_OPERATIONS.projectCreate,
        noProjectRequest(request),
        work,
      );
    },
    performProjectAssign<T>(
      request: ProjectAuthorizationTraceRequest,
      work: (context: EmployeeAccessContext) => Promise<T>,
    ) {
      return performEmployeeOperation(AUTHORIZATION_OPERATIONS.projectAssign, request, work);
    },
    performGmailFile<T>(
      request: ProjectAuthorizationTraceRequest,
      work: (context: EmployeeAccessContext) => Promise<T>,
    ) {
      return performEmployeeOperation(AUTHORIZATION_OPERATIONS.gmailFile, request, work);
    },
    performCalendarCreate<T>(
      request: OptionalProjectAuthorizationTraceRequest,
      work: (context: EmployeeAccessContext) => Promise<T>,
    ) {
      return performEmployeeOperation(AUTHORIZATION_OPERATIONS.calendarCreate, request, work);
    },
    performFilesShare<T>(
      request: ProjectAuthorizationTraceRequest,
      work: (context: EmployeeAccessContext) => Promise<T>,
    ) {
      return performEmployeeOperation(AUTHORIZATION_OPERATIONS.filesShare, request, work);
    },
    performFilesView<T>(
      request: ProjectAuthorizationTraceRequest,
      work: (context: EmployeeAccessContext) => Promise<T>,
    ) {
      return performEmployeeOperation(AUTHORIZATION_OPERATIONS.filesView, request, work);
    },
    performFilesUpload<T>(
      request: ProjectAuthorizationTraceRequest,
      work: (context: EmployeeAccessContext) => Promise<T>,
    ) {
      return performEmployeeOperation(AUTHORIZATION_OPERATIONS.filesUpload, request, work);
    },
    performDataExport<T>(
      request: OptionalProjectAuthorizationTraceRequest,
      work: (context: EmployeeAccessContext) => Promise<T>,
    ) {
      return performEmployeeOperation(AUTHORIZATION_OPERATIONS.dataExport, request, work);
    },
    performAuditView<T>(
      request: AuthorizationTraceRequest,
      work: (context: EmployeeAccessContext) => Promise<T>,
    ) {
      return performEmployeeOperation(
        AUTHORIZATION_OPERATIONS.auditView,
        noProjectRequest(request),
        work,
      );
    },
    performFieldAssignmentOpen<T>(
      snapshot: FieldLinkSnapshot,
      request: FieldAuthorizationTraceRequest,
      work: (authorized: FieldLinkAccessContext) => Promise<T>,
    ) {
      return performFieldOperation(
        snapshot,
        AUTHORIZATION_OPERATIONS.fieldAssignmentOpen,
        request,
        work,
      );
    },
  });
}
