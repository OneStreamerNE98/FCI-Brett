import type {
  AdminAccessOverview,
  AdminAccessRoleKey,
} from "../ports/admin-access-persistence";
import {
  CachedGetError,
  cachedGetJson,
  invalidateCachedGet,
  invalidateCachedGetPrefix,
} from "./client-get-cache";

const ADMIN_ACCESS_PATH = "/api/v1/admin/access";
const CSRF_HEADER = "x-fci-csrf-token";
const CREDENTIAL_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

type ErrorEnvelope = Readonly<{ error?: unknown }>;

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export class AdminAccessClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = "AdminAccessClientError";
  }
}

function requireAdminApi(secureSessionReady: boolean) {
  if (!secureSessionReady) {
    throw new AdminAccessClientError(0, "secure_session_not_ready");
  }
}

async function responseEnvelope(response: Response) {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new AdminAccessClientError(response.status, "invalid_server_response");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AdminAccessClientError(response.status, "invalid_server_response");
  }
  if (!response.ok) {
    const error = (value as ErrorEnvelope).error;
    throw new AdminAccessClientError(
      response.status,
      typeof error === "string" && error ? error : "request_failed",
    );
  }
  return value as Readonly<Record<string, unknown>>;
}

function dataObject(envelope: unknown) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new AdminAccessClientError(200, "invalid_server_response");
  }
  const record = envelope as Readonly<Record<string, unknown>>;
  const data = record.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new AdminAccessClientError(200, "invalid_server_response");
  }
  return data as Readonly<Record<string, unknown>>;
}

function mutationHeaders(csrfToken: string) {
  if (!CREDENTIAL_PATTERN.test(csrfToken)) {
    throw new AdminAccessClientError(0, "secure_session_not_ready");
  }
  return {
    "Content-Type": "application/json",
    [CSRF_HEADER]: csrfToken,
  } as const;
}

async function postAdminMutation(
  path: string,
  csrfToken: string,
  body: Readonly<Record<string, unknown>>,
) {
  const response = await fetch(path, {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: mutationHeaders(csrfToken),
    body: JSON.stringify(body),
  });
  const data = dataObject(await responseEnvelope(response));
  invalidateCachedGet(ADMIN_ACCESS_PATH);
  invalidateCachedGetPrefix("/api/v1/admin/audit");
  return data;
}

export async function readAdminAccessOverview(
  secureSessionReady: boolean,
): Promise<AdminAccessOverview> {
  requireAdminApi(secureSessionReady);
  try {
    const envelope = await cachedGetJson<unknown>(ADMIN_ACCESS_PATH);
    return dataObject(envelope) as AdminAccessOverview;
  } catch (error) {
    if (error instanceof CachedGetError) {
      const code = isErrorEnvelope(error.body)
        ? error.body.error
        : "invalid_server_response";
      throw new AdminAccessClientError(
        error.status,
        typeof code === "string" && code ? code : "request_failed",
      );
    }
    throw error;
  }
}

export async function inviteAdminAccessPerson(
  csrfToken: string,
  input: Readonly<{
    email: string;
    role: AdminAccessRoleKey;
    projectIds: readonly string[];
  }>,
) {
  const data = await postAdminMutation(
    "/api/v1/admin/invitations",
    csrfToken,
    input,
  );
  // Invitation fulfillment is not composed yet. Deliberately discard the
  // one-time raw credential instead of logging, caching, or inventing a URL.
  return {
    id: String(data.id ?? ""),
    email: String(data.email ?? ""),
  } as const;
}

export function revokeAdminAccessInvitation(
  csrfToken: string,
  invitationId: string,
  expectedVersion: string,
  reason: string,
) {
  return postAdminMutation(
    `/api/v1/admin/invitations/${encodeURIComponent(invitationId)}/revoke`,
    csrfToken,
    { expectedVersion, reason },
  );
}

export function changeAdminAccessPerson(
  csrfToken: string,
  userId: string,
  input: Readonly<{
    expectedVersion: string;
    role: AdminAccessRoleKey;
    projectIds: readonly string[];
    reason: string;
  }>,
) {
  return postAdminMutation(
    `/api/v1/admin/users/${encodeURIComponent(userId)}/access`,
    csrfToken,
    input,
  );
}

export function disableAdminAccessPerson(
  csrfToken: string,
  userId: string,
  expectedVersion: string,
  reason: string,
) {
  return postAdminMutation(
    `/api/v1/admin/users/${encodeURIComponent(userId)}/disable`,
    csrfToken,
    { expectedVersion, reason },
  );
}

export function signOutAdminAccessPerson(
  csrfToken: string,
  userId: string,
  expectedVersion: string,
  reason: string,
) {
  return postAdminMutation(
    `/api/v1/admin/users/${encodeURIComponent(userId)}/sign-out`,
    csrfToken,
    { expectedVersion, reason },
  );
}
