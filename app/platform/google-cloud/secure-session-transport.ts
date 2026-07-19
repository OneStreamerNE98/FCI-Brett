import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";

export const SESSION_COOKIE_NAME = "__Host-fci_session";
export const SESSION_CSRF_HEADER = "x-fci-csrf-token";
export const CLEAR_SESSION_COOKIE =
  `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; ` +
  "Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure; HttpOnly; SameSite=Strict";

const MAX_COOKIE_HEADER_LENGTH = 8_192;
const MAX_CREDENTIAL_LENGTH = 128;
const MIN_CREDENTIAL_LENGTH = 43;
const CREDENTIAL_PATTERN = /^[A-Za-z0-9_-]+$/;

export type TransportCredentialResult =
  | Readonly<{ ok: true; tokenHash: string }>
  | Readonly<{ ok: false; reason: "missing" | "invalid" }>;

function singleHeader(
  request: IncomingMessage,
  name: string,
): string | null | undefined {
  const value = request.headers[name];
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return null;
  return value;
}

function credentialHash(rawCredential: string) {
  return `sha256:${createHash("sha256").update(rawCredential, "utf8").digest("hex")}`;
}

function validRawCredential(value: string) {
  return value.length >= MIN_CREDENTIAL_LENGTH &&
    value.length <= MAX_CREDENTIAL_LENGTH &&
    CREDENTIAL_PATTERN.test(value);
}

export function createSessionCookie(
  rawCredential: string,
  issuedAt: number,
  absoluteExpiresAt: number,
) {
  if (!validRawCredential(rawCredential)) {
    throw new TypeError("Session cookie credential is invalid");
  }
  if (
    !Number.isSafeInteger(issuedAt)
    || !Number.isSafeInteger(absoluteExpiresAt)
    || issuedAt < 0
    || absoluteExpiresAt <= issuedAt
    || !Number.isFinite(new Date(absoluteExpiresAt).getTime())
  ) {
    throw new TypeError("Session cookie expiry is invalid");
  }
  const maxAge = Math.floor((absoluteExpiresAt - issuedAt) / 1_000);
  if (maxAge < 1) throw new TypeError("Session cookie lifetime is invalid");
  return `${SESSION_COOKIE_NAME}=${rawCredential}; Path=/; Max-Age=${maxAge}; ` +
    `Expires=${new Date(absoluteExpiresAt).toUTCString()}; ` +
    "Secure; HttpOnly; SameSite=Strict";
}

/**
 * Reads exactly one host-only session cookie and immediately replaces the raw
 * bearer value with its canonical digest. Callers never receive the bearer.
 */
export function readSessionCredential(
  request: IncomingMessage,
): TransportCredentialResult {
  const header = singleHeader(request, "cookie");
  if (header === undefined) return { ok: false, reason: "missing" };
  if (header === null || header.length === 0 || header.length > MAX_COOKIE_HEADER_LENGTH) {
    return { ok: false, reason: "invalid" };
  }

  let malformed = false;
  const sessionValues: string[] = [];
  for (const field of header.split(";")) {
    const cookie = field.trim();
    const separator = cookie.indexOf("=");
    if (separator < 1) {
      malformed = true;
      continue;
    }
    const name = cookie.slice(0, separator).trim();
    const value = cookie.slice(separator + 1).trim();
    if (!name || !value) {
      malformed = true;
      continue;
    }
    if (name === SESSION_COOKIE_NAME) sessionValues.push(value);
  }

  if (malformed) return { ok: false, reason: "invalid" };
  if (sessionValues.length === 0) return { ok: false, reason: "missing" };
  const value = sessionValues.length === 1 ? sessionValues[0] : undefined;
  if (!value || !validRawCredential(value)) return { ok: false, reason: "invalid" };
  return { ok: true, tokenHash: credentialHash(value) };
}

/** Reads and hashes the double-submit CSRF credential from one bounded header. */
export function readCsrfCredential(
  request: IncomingMessage,
): TransportCredentialResult {
  const header = singleHeader(request, SESSION_CSRF_HEADER);
  if (header === undefined) return { ok: false, reason: "missing" };
  if (header === null || !validRawCredential(header)) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, tokenHash: credentialHash(header) };
}

/**
 * Browser mutations must carry an exact Origin matching the externally visible
 * host and protocol. Cloud Run supplies x-forwarded-proto; local tests use the
 * socket protocol when the header is absent.
 */
export function requestIsSameOrigin(request: IncomingMessage) {
  const origin = singleHeader(request, "origin");
  const host = singleHeader(request, "host");
  const forwardedProtocol = singleHeader(request, "x-forwarded-proto");
  if (!origin || origin === null || !host || host === null || forwardedProtocol === null) {
    return false;
  }
  if (origin.includes(",") || host.includes(",")) return false;

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.origin !== origin || parsed.username || parsed.password) return false;

  const protocol = forwardedProtocol ??
    ((request.socket as typeof request.socket & { encrypted?: boolean }).encrypted
      ? "https"
      : "http");
  if (protocol !== "http" && protocol !== "https") return false;
  return parsed.protocol === `${protocol}:` &&
    parsed.host.toLowerCase() === host.trim().toLowerCase();
}
