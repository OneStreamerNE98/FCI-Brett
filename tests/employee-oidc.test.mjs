import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const vite = await createServer({
  root: fileURLToPath(new URL("../", import.meta.url)),
  cacheDir: "work/vite-tests/employee-oidc",
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, hmr: { port: 24723 } },
});
const {
  EMPLOYEE_OIDC_ATTEMPT_COOKIE_NAME,
  EMPLOYEE_OIDC_ATTEMPT_LIFETIME_MS,
  createEmployeeOidcClient,
} = await vite.ssrLoadModule("/app/platform/google-cloud/employee-oidc.ts");

after(async () => {
  await vite.close();
});

const NOW = Date.UTC(2026, 6, 19, 12, 0, 0);
const INVITATION_CREDENTIAL = Buffer.alloc(32, 0x51).toString("base64url");
const SESSION_SECRET = Buffer.alloc(32, 0x52).toString("base64url");
const CLIENT_ID = "employee-login.apps.googleusercontent.com";
const REDIRECT_URI = "https://operations.cherryhillfci.com/api/v1/session/google/callback";
const SUBJECT = "109876543210987654321";
const KEY_ID = "fci-test-google-key";
const keyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = {
  ...keyPair.publicKey.export({ format: "jwk" }),
  kid: KEY_ID,
  use: "sig",
  alg: "RS256",
};

const CONFIG = Object.freeze({
  clientId: CLIENT_ID,
  clientSecret: "FCI TEST — DO NOT USE client secret",
  clientSecretSource: "environment",
  sessionSecret: SESSION_SECRET,
  sessionSecretSource: "environment",
  redirectUri: REDIRECT_URI,
  allowedHostedDomain: "cherryhillfci.com",
});

function deterministicRandom() {
  let call = 0;
  return (size) => Buffer.alloc(size, ++call);
}

function attemptCookieValue(setCookie) {
  const match = setCookie.match(
    new RegExp(`^${EMPLOYEE_OIDC_ATTEMPT_COOKIE_NAME}=([^;]+);`),
  );
  assert.ok(match);
  return match[1];
}

function signedIdToken(claims, privateKey = keyPair.privateKey) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: KEY_ID }))
    .toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signingInput = `${header}.${payload}`;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput, "ascii"), privateKey)
    .toString("base64url");
  return `${signingInput}.${signature}`;
}

function provider(options = {}) {
  const calls = [];
  let expectedNonce = null;
  const fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === "https://oauth2.googleapis.com/token") {
      const claims = {
        iss: "https://accounts.google.com",
        aud: CLIENT_ID,
        sub: SUBJECT,
        email: "pm@cherryhillfci.com",
        email_verified: true,
        hd: "cherryhillfci.com",
        name: "FCI Test Project Manager",
        nonce: expectedNonce,
        iat: Math.floor(NOW / 1_000),
        exp: Math.floor((NOW + 60 * 60_000) / 1_000),
        ...options.claims,
      };
      return new Response(JSON.stringify({
        access_token: "unused-test-token",
        token_type: "Bearer",
        expires_in: 3_600,
        id_token: signedIdToken(claims, options.signingKey),
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url === "https://www.googleapis.com/oauth2/v3/certs") {
      return new Response(JSON.stringify({ keys: [options.jwk ?? publicJwk] }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=300",
        },
      });
    }
    assert.fail(`unexpected employee OIDC URL: ${url}`);
  };
  return {
    calls,
    fetch,
    setExpectedNonce(value) {
      expectedNonce = value;
    },
  };
}

function initiatedClient(providerOptions = {}, invitationCredential = INVITATION_CREDENTIAL) {
  const google = provider(providerOptions);
  const client = createEmployeeOidcClient(CONFIG, {
    fetch: google.fetch,
    randomBytes: deterministicRandom(),
  });
  const initiation = client.initiate(invitationCredential, NOW);
  const authorization = new URL(initiation.authorizationUrl);
  google.setExpectedNonce(authorization.searchParams.get("nonce"));
  return { authorization, client, google, initiation };
}

async function completes({ client, initiation, authorization }, overrides = {}) {
  return client.complete({
    attemptCookie: attemptCookieValue(initiation.attemptCookie),
    state: authorization.searchParams.get("state"),
    code: "FCI-TEST-AUTHORIZATION-CODE",
    completedAt: NOW + 1_000,
    ...overrides,
  });
}

test("employee OIDC uses state, nonce, PKCE, an encrypted invitation, and immutable Google sub", async () => {
  const setup = initiatedClient();
  const { authorization, google, initiation } = setup;

  assert.equal(authorization.origin, "https://accounts.google.com");
  assert.equal(authorization.pathname, "/o/oauth2/v2/auth");
  assert.equal(authorization.searchParams.get("client_id"), CLIENT_ID);
  assert.equal(authorization.searchParams.get("redirect_uri"), REDIRECT_URI);
  assert.equal(authorization.searchParams.get("response_type"), "code");
  assert.equal(authorization.searchParams.get("scope"), "openid email profile");
  assert.match(authorization.searchParams.get("state") ?? "", /^[A-Za-z0-9_-]{43}$/);
  assert.match(authorization.searchParams.get("nonce") ?? "", /^[A-Za-z0-9_-]{43}$/);
  assert.match(authorization.searchParams.get("code_challenge") ?? "", /^[A-Za-z0-9_-]{43}$/);
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorization.searchParams.get("hd"), "cherryhillfci.com");
  assert.equal(authorization.searchParams.get("prompt"), "select_account");
  assert.doesNotMatch(initiation.authorizationUrl, new RegExp(INVITATION_CREDENTIAL));
  assert.doesNotMatch(initiation.attemptCookie, new RegExp(INVITATION_CREDENTIAL));
  assert.match(initiation.attemptCookie, /; Path=\//);
  assert.match(initiation.attemptCookie, /; Max-Age=600/);
  assert.match(initiation.attemptCookie, /; Secure/);
  assert.match(initiation.attemptCookie, /; HttpOnly/);
  assert.match(initiation.attemptCookie, /; SameSite=Lax/);
  assert.doesNotMatch(initiation.attemptCookie, /; Domain=/i);

  const completion = await completes(setup);
  assert.deepEqual(completion, {
    identity: {
      provider: "google_oidc",
      issuer: "https://accounts.google.com",
      subject: SUBJECT,
      email: "pm@cherryhillfci.com",
      hostedDomain: "cherryhillfci.com",
      emailVerified: true,
      displayName: "FCI Test Project Manager",
    },
    invitationCredential: INVITATION_CREDENTIAL,
  });

  assert.equal(google.calls.length, 2);
  const tokenRequest = google.calls[0];
  assert.equal(tokenRequest.url, "https://oauth2.googleapis.com/token");
  assert.equal(tokenRequest.init.method, "POST");
  assert.equal(tokenRequest.init.redirect, "error");
  const tokenBody = new URLSearchParams(tokenRequest.init.body);
  assert.equal(tokenBody.get("client_id"), CLIENT_ID);
  assert.equal(tokenBody.get("client_secret"), CONFIG.clientSecret);
  assert.equal(tokenBody.get("code"), "FCI-TEST-AUTHORIZATION-CODE");
  assert.equal(tokenBody.get("grant_type"), "authorization_code");
  assert.equal(tokenBody.get("redirect_uri"), REDIRECT_URI);
  const verifier = tokenBody.get("code_verifier");
  assert.match(verifier ?? "", /^[A-Za-z0-9_-]{43}$/);
  assert.equal(
    createHash("sha256").update(verifier, "ascii").digest("base64url"),
    authorization.searchParams.get("code_challenge"),
  );
  assert.equal(google.calls[1].url, "https://www.googleapis.com/oauth2/v3/certs");
});

test("employee OIDC rejects a signed token whose hosted-domain claim is not exact", async () => {
  const setup = initiatedClient({ claims: { hd: "other.example" } });
  await assert.rejects(completes(setup), (error) => {
    assert.equal(error.name, "EmployeeOidcFailure");
    assert.equal(error.reason, "outside_domain");
    assert.equal(error.retryable, false);
    return true;
  });
});

test("employee OIDC rejects a token whose signature does not match Google's fixed JWKS", async () => {
  const otherKeyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const setup = initiatedClient({ signingKey: otherKeyPair.privateKey });
  await assert.rejects(completes(setup), (error) => {
    assert.equal(error.name, "EmployeeOidcFailure");
    assert.equal(error.reason, "signature_invalid");
    return true;
  });
});

test("employee OIDC rejects state mismatch and an expired single login attempt before provider exchange", async () => {
  const wrongState = initiatedClient();
  await assert.rejects(
    completes(wrongState, { state: Buffer.alloc(32, 0x77).toString("base64url") }),
    (error) => error.name === "EmployeeOidcFailure" && error.reason === "state_invalid",
  );
  assert.equal(wrongState.google.calls.length, 0);

  const expired = initiatedClient();
  await assert.rejects(
    completes(expired, { completedAt: NOW + EMPLOYEE_OIDC_ATTEMPT_LIFETIME_MS }),
    (error) => error.name === "EmployeeOidcFailure" && error.reason === "attempt_expired",
  );
  assert.equal(expired.google.calls.length, 0);
});
