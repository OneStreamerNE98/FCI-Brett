import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  CLEAR_SESSION_COOKIE,
  SESSION_COOKIE_NAME,
  SESSION_CSRF_HEADER,
  readCsrfCredential,
  readSessionCredential,
  requestIsSameOrigin,
} from "../app/platform/google-cloud/secure-session-transport.ts";

const SESSION_CREDENTIAL = Buffer.alloc(32, 0x31).toString("base64url");
const CSRF_CREDENTIAL = Buffer.alloc(32, 0x32).toString("base64url");

function sha256(value) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function request(headers = {}) {
  return {
    headers: Object.fromEntries(
      Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
    ),
  };
}

test("exports the fixed host-only session transport names and clearing cookie", () => {
  assert.equal(SESSION_COOKIE_NAME, "__Host-fci_session");
  assert.equal(SESSION_CSRF_HEADER, "x-fci-csrf-token");
  assert.match(CLEAR_SESSION_COOKIE, /^__Host-fci_session=/);
  assert.match(CLEAR_SESSION_COOKIE, /(?:^|;\s*)Path=\//i);
  assert.match(CLEAR_SESSION_COOKIE, /(?:^|;\s*)HttpOnly(?:;|$)/i);
  assert.match(CLEAR_SESSION_COOKIE, /(?:^|;\s*)Secure(?:;|$)/i);
  assert.match(CLEAR_SESSION_COOKIE, /(?:^|;\s*)SameSite=Strict(?:;|$)/i);
  assert.match(CLEAR_SESSION_COOKIE, /(?:^|;\s*)Max-Age=0(?:;|$)/i);
  assert.doesNotMatch(CLEAR_SESSION_COOKIE, /(?:^|;\s*)Domain=/i);
});

test("reads exactly one bounded session cookie and exposes only its canonical digest", () => {
  const expectedHash = sha256(SESSION_CREDENTIAL);
  const result = readSessionCredential(request({
    cookie: `theme=dark; ${SESSION_COOKIE_NAME}=${SESSION_CREDENTIAL}; compact=true`,
  }));

  assert.deepEqual(result, { ok: true, tokenHash: expectedHash });
  assert.equal(JSON.stringify(result).includes(SESSION_CREDENTIAL), false);
  assert.match(result.tokenHash, /^sha256:[0-9a-f]{64}$/);
});

test("rejects missing, duplicate, malformed, and oversized session cookies", () => {
  for (const [label, cookie, reason] of [
    ["missing header", undefined, "missing"],
    ["unrelated cookie", "theme=dark", "missing"],
    [
      "duplicate session cookie",
      `${SESSION_COOKIE_NAME}=${SESSION_CREDENTIAL}; ${SESSION_COOKIE_NAME}=${SESSION_CREDENTIAL}`,
      "invalid",
    ],
    ["empty credential", `${SESSION_COOKIE_NAME}=`, "invalid"],
    ["percent-encoded credential", `${SESSION_COOKIE_NAME}=${SESSION_CREDENTIAL}%2F`, "invalid"],
    ["credential with separator", `${SESSION_COOKIE_NAME}=${SESSION_CREDENTIAL}.`, "invalid"],
    ["short credential", `${SESSION_COOKIE_NAME}=short`, "invalid"],
    ["oversized cookie header", `padding=${"a".repeat(9_000)}; ${SESSION_COOKIE_NAME}=${SESSION_CREDENTIAL}`, "invalid"],
  ]) {
    const headers = cookie === undefined ? {} : { cookie };
    assert.deepEqual(readSessionCredential(request(headers)), { ok: false, reason }, label);
  }

  assert.deepEqual(
    readSessionCredential(request({ cookie: [`${SESSION_COOKIE_NAME}=${SESSION_CREDENTIAL}`] })),
    { ok: false, reason: "invalid" },
  );
});

test("reads one CSRF credential as a digest and rejects ambiguity or malformed values", () => {
  const accepted = readCsrfCredential(request({
    [SESSION_CSRF_HEADER]: CSRF_CREDENTIAL,
  }));
  assert.deepEqual(accepted, { ok: true, tokenHash: sha256(CSRF_CREDENTIAL) });
  assert.equal(JSON.stringify(accepted).includes(CSRF_CREDENTIAL), false);

  for (const [label, value, reason] of [
    ["missing", undefined, "missing"],
    ["empty", "", "invalid"],
    ["short", "short", "invalid"],
    ["comma-joined duplicate", `${CSRF_CREDENTIAL}, ${CSRF_CREDENTIAL}`, "invalid"],
    ["whitespace", ` ${CSRF_CREDENTIAL}`, "invalid"],
    ["array duplicate", [CSRF_CREDENTIAL, CSRF_CREDENTIAL], "invalid"],
  ]) {
    const headers = value === undefined ? {} : { [SESSION_CSRF_HEADER]: value };
    assert.deepEqual(readCsrfCredential(request(headers)), { ok: false, reason }, label);
  }
});

test("same-origin validation requires one exact HTTPS origin and host", () => {
  assert.equal(requestIsSameOrigin(request({
    host: "operations.cherryhillfci.com",
    origin: "https://operations.cherryhillfci.com",
    "x-forwarded-proto": "https",
  })), true);

  for (const [label, headers] of [
    ["missing origin", {
      host: "operations.cherryhillfci.com",
      "x-forwarded-proto": "https",
    }],
    ["cross origin", {
      host: "operations.cherryhillfci.com",
      origin: "https://attacker.example",
      "x-forwarded-proto": "https",
    }],
    ["wrong scheme", {
      host: "operations.cherryhillfci.com",
      origin: "http://operations.cherryhillfci.com",
      "x-forwarded-proto": "https",
    }],
    ["origin path", {
      host: "operations.cherryhillfci.com",
      origin: "https://operations.cherryhillfci.com/path",
      "x-forwarded-proto": "https",
    }],
    ["opaque origin", {
      host: "operations.cherryhillfci.com",
      origin: "null",
      "x-forwarded-proto": "https",
    }],
    ["ambiguous forwarded protocol", {
      host: "operations.cherryhillfci.com",
      origin: "https://operations.cherryhillfci.com",
      "x-forwarded-proto": "https,http",
    }],
    ["ambiguous host", {
      host: ["operations.cherryhillfci.com", "attacker.example"],
      origin: "https://operations.cherryhillfci.com",
      "x-forwarded-proto": "https",
    }],
  ]) {
    assert.equal(requestIsSameOrigin(request(headers)), false, label);
  }
});
