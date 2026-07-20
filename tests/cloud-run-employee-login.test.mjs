import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer as createViteServer } from "vite";

const vite = await createViteServer({
  root: fileURLToPath(new URL("../", import.meta.url)),
  cacheDir: "work/vite-tests/cloud-run-employee-login",
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, hmr: { port: 24727 } },
});
const { createEmployeeRequestRouter } = await vite.ssrLoadModule(
  "/app/platform/google-cloud/employee-request-router.ts",
);
const { EmployeeOidcFailure } = await vite.ssrLoadModule(
  "/app/platform/google-cloud/employee-oidc.ts",
);

after(async () => {
  await vite.close();
});

const NOW = Date.UTC(2026, 6, 19, 12, 0, 0);
const INVITATION_CREDENTIAL = Buffer.alloc(32, 0x61).toString("base64url");
const SESSION_CREDENTIAL = Buffer.alloc(32, 0x62).toString("base64url");
const CSRF_CREDENTIAL = Buffer.alloc(32, 0x63).toString("base64url");
const ATTEMPT_COOKIE_VALUE = "v1.encrypted.test-attempt";
const AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth?state=FCI_TEST_STATE";

function sha256(value) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function setCookies(response) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie();
  }
  const header = response.headers.get("set-cookie");
  return header === null ? [] : [header];
}

async function startHarness(options = {}) {
  const initiations = [];
  const completions = [];
  const identityCalls = [];
  const audits = [];
  const oidc = {
    initiate(invitationCredential, initiatedAt) {
      initiations.push({ invitationCredential, initiatedAt });
      return {
        authorizationUrl: AUTHORIZATION_URL,
        attemptCookie:
          `__Host-fci_oidc_attempt=${ATTEMPT_COOKIE_VALUE}; Path=/; Max-Age=600; `
          + "Secure; HttpOnly; SameSite=Lax",
      };
    },
    async complete(input) {
      completions.push(input);
      if (options.completionError) throw options.completionError;
      return {
        identity: {
          provider: "google_oidc",
          issuer: "https://accounts.google.com",
          subject: "google-immutable-subject-123",
          email: "pm@cherryhillfci.com",
          hostedDomain: "cherryhillfci.com",
          emailVerified: true,
          displayName: "FCI Test Project Manager",
        },
        invitationCredential: INVITATION_CREDENTIAL,
      };
    },
  };
  const identity = {
    async authenticateEmployeeSession(intent) {
      identityCalls.push(intent);
      return options.identityResult ?? {
        outcome: "accepted",
        userId: "11111111-1111-4111-8111-111111111111",
        email: "pm@cherryhillfci.com",
        authorizationVersion: "1",
        sessionVersion: "1",
        invitationRedeemed: true,
      };
    },
  };
  const audit = {
    async append(event) {
      audits.push(event);
      return { id: event.id };
    },
  };
  const dependencies = {
    authorization: {},
    repository: {},
    adminAudit: {},
    adminAccess: {},
    audit,
    now: () => NOW,
    newId: randomUUID,
    newSessionCredential: () => SESSION_CREDENTIAL,
    newCsrfCredential: () => CSRF_CREDENTIAL,
    ...(options.loginDisabled ? {} : { oidc, identity }),
  };
  const router = createEmployeeRequestRouter(dependencies);
  const server = createHttpServer((request, response) => {
    void router(request, response).catch(() => {
      if (!response.headersSent) {
        response.writeHead(500, { "Content-Type": "application/json" });
        response.end('{"error":"test_router_rejected"}');
      } else {
        response.destroy();
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;

  async function request(path, requestOptions = {}) {
    const headers = new Headers(requestOptions.headers);
    if (requestOptions.sameOrigin) headers.set("Origin", origin);
    let body;
    if (Object.hasOwn(requestOptions, "json")) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(requestOptions.json);
    }
    return fetch(origin + path, {
      method: requestOptions.method ?? "GET",
      headers,
      redirect: "manual",
      ...(body === undefined ? {} : { body }),
    });
  }

  async function close() {
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections?.();
    });
  }

  return {
    audits,
    close,
    completions,
    identityCalls,
    initiations,
    request,
  };
}

test("Cloud Run login start and callback issue only hashed persistence credentials with fixed expiries", async () => {
  const running = await startHarness();
  try {
    const start = await running.request("/api/v1/session/google/start", {
      method: "POST",
      sameOrigin: true,
      json: { invitationCredential: INVITATION_CREDENTIAL },
    });
    assert.equal(start.status, 303);
    assert.equal(start.headers.get("location"), AUTHORIZATION_URL);
    assert.equal(start.headers.get("cache-control"), "no-store");
    assert.deepEqual(running.initiations, [{
      invitationCredential: INVITATION_CREDENTIAL,
      initiatedAt: NOW,
    }]);
    const startCookies = setCookies(start);
    assert.equal(startCookies.length, 1);
    assert.match(startCookies[0], new RegExp(
      `^__Host-fci_oidc_attempt=${ATTEMPT_COOKIE_VALUE};`,
    ));
    assert.match(startCookies[0], /; Secure/);
    assert.match(startCookies[0], /; HttpOnly/);
    assert.match(startCookies[0], /; SameSite=Lax/);

    const callback = await running.request(
      "/api/v1/session/google/callback?state=FCI_TEST_STATE&code=FCI_TEST_CODE"
        + "&scope=openid%20email%20profile&authuser=0&hd=cherryhillfci.com"
        + "&prompt=consent",
      {
        headers: {
          Cookie: `__Host-fci_oidc_attempt=${ATTEMPT_COOKIE_VALUE}`,
        },
      },
    );
    assert.equal(callback.status, 200);
    assert.equal(callback.headers.get("cache-control"), "no-store");
    assert.deepEqual(await callback.json(), {
      data: {
        outcome: "authenticated",
        csrfToken: CSRF_CREDENTIAL,
        idleExpiresAt: NOW + 30 * 60_000,
        absoluteExpiresAt: NOW + 8 * 60 * 60_000,
      },
    });
    assert.deepEqual(running.completions, [{
      attemptCookie: ATTEMPT_COOKIE_VALUE,
      state: "FCI_TEST_STATE",
      code: "FCI_TEST_CODE",
      completedAt: NOW,
    }]);

    assert.equal(running.identityCalls.length, 1);
    const intent = running.identityCalls[0];
    assert.equal(intent.identity.subject, "google-immutable-subject-123");
    assert.equal(intent.invitationTokenHash, sha256(INVITATION_CREDENTIAL));
    assert.equal(intent.session.tokenHash, sha256(SESSION_CREDENTIAL));
    assert.equal(intent.session.csrfHash, sha256(CSRF_CREDENTIAL));
    assert.equal(intent.session.issuedAt, NOW);
    assert.equal(intent.session.idleExpiresAt, NOW + 30 * 60_000);
    assert.equal(intent.session.absoluteExpiresAt, NOW + 8 * 60 * 60_000);
    assert.equal(intent.session.purgeAfter, NOW + 8 * 60 * 60_000 + 7 * 24 * 60 * 60_000);
    assert.match(intent.session.id, /^[0-9a-f-]{36}$/i);
    assert.match(intent.newUserId, /^[0-9a-f-]{36}$/i);
    assert.match(intent.newExternalIdentityId, /^[0-9a-f-]{36}$/i);
    assert.doesNotMatch(JSON.stringify(intent), new RegExp(SESSION_CREDENTIAL));
    assert.doesNotMatch(JSON.stringify(intent), new RegExp(CSRF_CREDENTIAL));
    assert.doesNotMatch(JSON.stringify(intent), new RegExp(INVITATION_CREDENTIAL));

    const callbackCookies = setCookies(callback);
    assert.equal(callbackCookies.length, 2);
    assert.ok(callbackCookies.some((cookie) =>
      cookie.startsWith("__Host-fci_oidc_attempt=;") && cookie.includes("Max-Age=0")));
    const sessionCookie = callbackCookies.find((cookie) =>
      cookie.startsWith(`__Host-fci_session=${SESSION_CREDENTIAL};`));
    assert.ok(sessionCookie);
    assert.match(sessionCookie, /; Max-Age=28800/);
    assert.match(sessionCookie, /; Secure/);
    assert.match(sessionCookie, /; HttpOnly/);
    assert.match(sessionCookie, /; SameSite=Strict/);
    assert.doesNotMatch(sessionCookie, /; Domain=/i);
  } finally {
    await running.close();
  }
});

test("Cloud Run records provider cancellation and rejects ambiguous callback credentials", async () => {
  const cancelled = await startHarness();
  try {
    const response = await cancelled.request(
      "/api/v1/session/google/callback?error=access_denied&state=FCI_TEST_STATE"
        + "&error_description=The%20user%20cancelled",
      {
        headers: {
          Cookie: `__Host-fci_oidc_attempt=${ATTEMPT_COOKIE_VALUE}`,
        },
      },
    );
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "login_not_authorized" });
    assert.equal(cancelled.completions.length, 0);
    assert.equal(cancelled.identityCalls.length, 0);
    assert.equal(cancelled.audits.length, 1);
    assert.equal(cancelled.audits[0].action, "identity.login_failed");
    assert.equal(cancelled.audits[0].reasonCode, "authorization_denied");
    const cookies = setCookies(response);
    assert.equal(cookies.length, 1);
    assert.match(cookies[0], /^__Host-fci_oidc_attempt=;/);
    assert.match(cookies[0], /Max-Age=0/);
  } finally {
    await cancelled.close();
  }

  for (const query of [
    "code=FIRST&code=SECOND&state=FCI_TEST_STATE",
    "code=FCI_TEST_CODE&state=FIRST&state=SECOND",
  ]) {
    const ambiguous = await startHarness();
    try {
      const response = await ambiguous.request(
        `/api/v1/session/google/callback?${query}`,
        {
          headers: {
            Cookie: `__Host-fci_oidc_attempt=${ATTEMPT_COOKIE_VALUE}`,
          },
        },
      );
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: "login_not_authorized" });
      assert.equal(ambiguous.completions.length, 0);
      assert.equal(ambiguous.identityCalls.length, 0);
      assert.equal(ambiguous.audits.at(-1)?.reasonCode, "authorization_denied");
    } finally {
      await ambiguous.close();
    }
  }
});

test("Cloud Run maps OIDC completion failures, audits them, and clears the attempt", async (t) => {
  const cases = [
    ["nonretryable", new EmployeeOidcFailure("outside_domain"), 403, "login_not_authorized"],
    [
      "retryable",
      new EmployeeOidcFailure("provider_unavailable", true),
      503,
      "login_unavailable",
    ],
  ];

  for (const [label, completionError, status, responseError] of cases) {
    await t.test(label, async () => {
      const running = await startHarness({ completionError });
      try {
        const response = await running.request(
          "/api/v1/session/google/callback?code=FCI_TEST_CODE&state=FCI_TEST_STATE",
          {
            headers: {
              Cookie: `__Host-fci_oidc_attempt=${ATTEMPT_COOKIE_VALUE}`,
            },
          },
        );
        assert.equal(response.status, status);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.deepEqual(await response.json(), { error: responseError });
        assert.equal(running.completions.length, 1);
        assert.equal(running.identityCalls.length, 0);
        assert.equal(running.audits.length, 1);
        assert.equal(running.audits[0].action, "identity.login_failed");
        assert.equal(running.audits[0].result, "denied");
        assert.equal(running.audits[0].reasonCode, completionError.reason);
        assert.equal(running.audits[0].source, "employee_login");

        const cookies = setCookies(response);
        assert.equal(cookies.length, 1);
        assert.match(cookies[0], /^__Host-fci_oidc_attempt=;/);
        assert.match(cookies[0], /Max-Age=0/);
        assert.doesNotMatch(cookies[0], /__Host-fci_session=/);
      } finally {
        await running.close();
      }
    });
  }
});

test("Cloud Run denies cross-origin employee login start before OIDC initiation", async () => {
  const running = await startHarness();
  try {
    const response = await running.request("/api/v1/session/google/start", {
      method: "POST",
      headers: { Origin: "https://attacker.example.test" },
      json: { invitationCredential: INVITATION_CREDENTIAL },
    });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { error: "request_not_authorized" });
    assert.equal(running.initiations.length, 0);
    assert.equal(running.completions.length, 0);
    assert.equal(running.identityCalls.length, 0);
    assert.equal(running.audits.length, 1);
    assert.equal(running.audits[0].action, "authorization.transport_denied");
    assert.equal(running.audits[0].result, "denied");
    assert.equal(running.audits[0].reasonCode, "origin_mismatch");
    assert.equal(running.audits[0].source, "employee_route_transport");
    assert.equal(setCookies(response).length, 0);
  } finally {
    await running.close();
  }
});

test("Cloud Run denies a rejected invitation without issuing a session and clears the OIDC attempt", async () => {
  const running = await startHarness({
    identityResult: { outcome: "denied", reason: "invitation_invalid" },
  });
  try {
    const response = await running.request(
      "/api/v1/session/google/callback?code=FCI_TEST_CODE&state=FCI_TEST_STATE",
      {
        headers: {
          Cookie: `__Host-fci_oidc_attempt=${ATTEMPT_COOKIE_VALUE}`,
        },
      },
    );
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "login_not_authorized" });
    const cookies = setCookies(response);
    assert.equal(cookies.length, 1);
    assert.match(cookies[0], /^__Host-fci_oidc_attempt=;/);
    assert.match(cookies[0], /Max-Age=0/);
    assert.doesNotMatch(cookies[0], /__Host-fci_session=/);
    assert.equal(running.identityCalls.length, 1);
  } finally {
    await running.close();
  }
});

test("Cloud Run keeps employee login routes absent until the complete OIDC composition exists", async () => {
  const running = await startHarness({ loginDisabled: true });
  try {
    const start = await running.request("/api/v1/session/google/start", {
      method: "POST",
      sameOrigin: true,
      json: { invitationCredential: null },
    });
    assert.equal(start.status, 404);
    assert.deepEqual(await start.json(), { error: "not_found" });

    const callback = await running.request(
      "/api/v1/session/google/callback?code=code&state=state",
    );
    assert.equal(callback.status, 404);
    assert.deepEqual(await callback.json(), { error: "not_found" });
  } finally {
    await running.close();
  }
});
