import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { after, beforeEach, test } from "node:test";
import { NextRequest } from "next/server.js";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const APP_ORIGIN = "https://fci.example.test";
const ACTOR = "office@cherryhillfci.com";
const TEST_ADDRESS = "123 Test Street, Portland, ME 04101";
const NOW = Date.UTC(2026, 7, 3, 14);
const rootUrl = new URL("../", import.meta.url);
const workerEnvironment = {};
const originalNodeEnvironment = process.env.NODE_ENV;
globalThis.__FCI_TEST_CLOUDFLARE_ENV__ = workerEnvironment;
process.env.NODE_ENV = "test";

const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: fileURLToPath(new URL("../node_modules/.vite-gi04-address-validation", import.meta.url)),
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(new URL("fixtures/cloudflare-workers.mjs", import.meta.url)),
    },
  },
  server: { middlewareMode: true, hmr: { port: 24804 } },
});

const [
  domain,
  engine,
  reviews,
  mutation,
  config,
  route,
  autocompleteSession,
  mapsSites,
  addressField,
  googleFormIntake,
  firstRunImport,
  leadPatchRoute,
] = await Promise.all([
  vite.ssrLoadModule("/app/domain/address-validation.ts"),
  vite.ssrLoadModule("/app/features/address-validation/address-validation.ts"),
  vite.ssrLoadModule("/app/adapters/d1/address-validation-reviews.ts"),
  vite.ssrLoadModule("/app/lib/address-mutation-sites.ts"),
  vite.ssrLoadModule("/app/lib/address-validation-sites.ts"),
  vite.ssrLoadModule("/app/api/v1/address-validation/route.ts"),
  vite.ssrLoadModule("/app/features/address-validation/address-autocomplete-session.ts"),
  vite.ssrLoadModule("/app/lib/job-site-maps-sites.ts"),
  vite.ssrLoadModule("/app/features/address-validation/AddressValidationField.tsx"),
  vite.ssrLoadModule("/app/domain/google-form-lead-intake.ts"),
  vite.ssrLoadModule("/app/domain/first-run-import.ts"),
  vite.ssrLoadModule("/app/api/v1/leads/[leadId]/route.ts"),
]);

after(async () => {
  if (originalNodeEnvironment === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnvironment;
  delete globalThis.__FCI_TEST_CLOUDFLARE_ENV__;
  await vite.close();
});

beforeEach(() => {
  for (const key of Object.keys(workerEnvironment)) delete workerEnvironment[key];
});

test("autocomplete reuses one token and rotates after every settled review attempt", async () => {
  const generated = ["autocomplete-session-one", "autocomplete-session-two"];
  const session = autocompleteSession.createAddressAutocompleteSession(() => generated.shift());
  assert.equal(session.token(), "autocomplete-session-one");
  assert.equal(session.token(), "autocomplete-session-one");
  session.complete();
  assert.equal(session.token(), "autocomplete-session-two");

  const component = await readFile(
    new URL("../app/features/address-validation/AddressValidationField.tsx", import.meta.url),
    "utf8",
  );
  assert.equal(component.match(/sessionRef\.current\.token\(\)/gu)?.length, 2);
  assert.match(
    component,
    /\} catch \(caught\) \{[\s\S]{0,500}\} finally \{[\s\S]{0,500}sessionRef\.current\.complete\(\);[\s\S]{0,100}setValidating\(false\);/u,
  );
});

test("Places autocomplete requires the owner gate and both key configurations", async () => {
  const runtime = {
    simulation: false,
    browserApiKey: "  FCI_TEST_BROWSER_KEY  ",
    addressValidationEnabled: false,
    serverAddressValidationAvailable: true,
  };
  assert.equal(autocompleteSession.placesAutocompleteBrowserKey(runtime), null);
  assert.equal(autocompleteSession.placesAutocompleteBrowserKey({
    ...runtime,
    addressValidationEnabled: true,
  }), "FCI_TEST_BROWSER_KEY");
  assert.equal(autocompleteSession.placesAutocompleteBrowserKey({
    ...runtime,
    simulation: true,
    addressValidationEnabled: true,
  }), null);
  assert.equal(autocompleteSession.placesAutocompleteBrowserKey({
    ...runtime,
    addressValidationEnabled: true,
    serverAddressValidationAvailable: false,
  }), null);

  assert.equal(autocompleteSession.addressAvailabilityHint({
    simulation: true,
    addressValidationEnabled: false,
    serverAddressValidationAvailable: false,
  }), null);
  assert.equal(autocompleteSession.addressAvailabilityHint(runtime),
    "Maps address validation and autocomplete are unavailable until the owner enables them. Typed addresses stay unvalidated with no coordinates.");
  assert.equal(autocompleteSession.addressAvailabilityHint({
    ...runtime,
    addressValidationEnabled: true,
    browserApiKey: " ",
  }), "Autocomplete is unavailable because its browser configuration is missing. Server review remains available and reports whether validation succeeded.");
  assert.equal(autocompleteSession.addressAvailabilityHint({
    ...runtime,
    addressValidationEnabled: true,
    serverAddressValidationAvailable: false,
  }), "Address review and autocomplete are unavailable because the server validation configuration is missing. Typed addresses stay unvalidated with no coordinates.");
  assert.equal(autocompleteSession.addressAvailabilityHint({
    ...runtime,
    addressValidationEnabled: true,
    browserApiKey: null,
    serverAddressValidationAvailable: false,
  }), "Address review and autocomplete are unavailable because both Maps key configurations are missing. Typed addresses stay unvalidated with no coordinates.");
  assert.equal(autocompleteSession.addressAvailabilityHint({
    ...runtime,
    addressValidationEnabled: true,
  }), null);
  assert.equal(autocompleteSession.placesAutocompleteBrowserKey({
    ...runtime,
    browserApiKey: undefined,
    addressValidationEnabled: true,
  }), null);

  Object.assign(workerEnvironment, {
    GOOGLE_INTEGRATION_MODE: "workspace",
    GOOGLE_MAPS_ADDRESS_VALIDATION_ENABLED: "true",
    GOOGLE_MAPS_BROWSER_API_KEY: "FCI_TEST_BROWSER_KEY",
    GOOGLE_MAPS_SERVER_API_KEY: "FCI_TEST_SERVER_KEY_MUST_NOT_LEAK",
  });
  assert.deepEqual(mapsSites.getSitesJobSiteMapsRuntimeConfig(), {
    simulation: false,
    browserApiKey: "FCI_TEST_BROWSER_KEY",
    addressValidationEnabled: true,
    serverAddressValidationAvailable: true,
  });
  workerEnvironment.GOOGLE_MAPS_SERVER_API_KEY = "   ";
  assert.deepEqual(mapsSites.getSitesJobSiteMapsRuntimeConfig(), {
    simulation: false,
    browserApiKey: "FCI_TEST_BROWSER_KEY",
    addressValidationEnabled: true,
    serverAddressValidationAvailable: false,
  });
  const serverMissingMarkup = renderToStaticMarkup(React.createElement(
    addressField.AddressValidationField,
    {
      id: "server-rendered-address",
      name: "site",
      label: "Site",
      value: "123 Test Street",
      entityKind: "project",
      targetId: "new",
      mapsRuntime: mapsSites.getSitesJobSiteMapsRuntimeConfig(),
      onChange() {},
      onReviewChange() {},
    },
  ));
  assert.match(
    serverMissingMarkup,
    /Address review and autocomplete are unavailable because the server validation configuration is missing\./u,
  );
  assert.doesNotMatch(serverMissingMarkup, /FCI_TEST_SERVER_KEY_MUST_NOT_LEAK/u);

  const component = await readFile(
    new URL("../app/features/address-validation/AddressValidationField.tsx", import.meta.url),
    "utf8",
  );
  assert.match(component, /placesAutocompleteBrowserKey\(mapsRuntime\)/u);
  assert.match(component, /addressAvailabilityHint\(mapsRuntime\)/u);
  assert.match(component, /"X-Goog-Api-Key": apiKey/u);
  assert.match(component, /className=\{styles\.attribution\} translate="no">Google Maps/u);
  assert.doesNotMatch(component, /SERVER_API_KEY|serverApiKey/u);
  assert.match(component, /useEffect\(\(\) => \(\) => \{[\s\S]{0,300}sessionRef\.current\?\.complete\(\);/u);
  assert.match(component, /Review this address before saving because autocomplete was used\./u);
  assert.match(component, /\|\| validating/u);
  assert.match(
    component,
    /suggestionRequestRef\.current \+= 1;[\s\S]{0,200}suggestionAbortRef\.current\?\.abort\(\)/u,
  );
  assert.match(component, /reviewAbortRef\.current\?\.abort\(\)/u);
  assert.match(component, /signal: reviewController\.signal/u);
  assert.doesNotMatch(component, /keepalive|sendBeacon/u);

  const mapsSitesSource = await readFile(
    new URL("../app/lib/job-site-maps-sites.ts", import.meta.url),
    "utf8",
  );
  assert.match(mapsSitesSource, /serverAddressValidationAvailable:\s*\n?\s*Boolean\(runtimeValue\(GOOGLE_MAPS_SERVER_API_KEY_ENV\)\?\.trim\(\)\)/u);
  assert.doesNotMatch(mapsSitesSource, /serverApiKey\s*:/u);
});

test("seeded mounts never autofire autocomplete and the field meets the shared control tiers", async () => {
  const component = await readFile(
    new URL("../app/features/address-validation/AddressValidationField.tsx", import.meta.url),
    "utf8",
  );
  // Mount, seeding, and rehydration must never fire a Places request: the
  // suggestion effect requires a user edit that moved the value off the seed.
  assert.match(component, /const \[userEditedAddress, setUserEditedAddress\] = useState\(false\);/u);
  assert.match(component, /const seededValueRef = useRef\(value\);/u);
  assert.match(component, /\|\| !userEditedAddress\s+\|\| value === seededValueRef\.current/u);
  assert.match(component, /setUserEditedAddress\(true\);\s+resetReview\(event\.target\.value\);/u);
  // The autocomplete save-block applies only to an address the user actually
  // edited this session; an untouched seeded address never blocks submit.
  assert.match(component, /tokenizedAutocompleteStarted && userEditedAddress/u);
  // The listbox dismisses on focus-out of the field group and on any pointer
  // press outside the container, so it cannot hijack covered controls.
  assert.match(component, /event\.currentTarget\.contains\(event\.relatedTarget\)/u);
  assert.match(component, /document\.addEventListener\("pointerdown", handlePointerDown\)/u);
  // The Reviewing state reuses the app's shared spinner idiom.
  assert.match(component, /LoaderCircle className=\{styles\.spinner\}/u);

  const componentStyles = await readFile(
    new URL("../app/features/address-validation/AddressValidationField.module.css", import.meta.url),
    "utf8",
  );
  assert.match(componentStyles, /animation: spin 0\.8s linear infinite;/u);
  // Desktop control tier plus the 560px touch tier NFIX-04 standardized.
  assert.match(componentStyles, /min-height: var\(--control-standard, 40px\);/u);
  assert.match(componentStyles, /@media \(max-width: 560px\)/u);
  assert.doesNotMatch(componentStyles, /max-width: 640px/u);
  assert.equal(componentStyles.match(/min-height: var\(--target-min, 44px\);/gu)?.length, 2);
  // The global `.modal label` field-wrapper margin never leaks into the
  // module label, and the modal keeps the standard inter-field separation.
  assert.match(componentStyles, /\.field \.label \{\s+margin-bottom: 0;\s+\}/u);
  const app = await readFile(new URL("../app/FloorOpsApp.tsx", import.meta.url), "utf8");
  assert.equal(app.match(/className="modal-address-field"/gu)?.length, 5);
});

class SqliteD1Statement {
  constructor(statement) {
    this.statement = statement;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async first() {
    return this.statement.get(...this.values) ?? null;
  }

  async all() {
    return { results: this.statement.all(...this.values) };
  }

  async run() {
    const result = this.statement.run(...this.values);
    return { meta: { changes: Number(result.changes) } };
  }
}

class AddressReviewDatabase {
  constructor() {
    this.database = new DatabaseSync(":memory:");
    this.database.exec(`
      CREATE TABLE address_validation_reviews (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        entity_kind TEXT NOT NULL,
        target_id TEXT NOT NULL,
        input_address TEXT NOT NULL,
        standardized_address TEXT,
        latitude REAL,
        longitude REAL,
        verdict TEXT NOT NULL,
        failure_code TEXT,
        simulated INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER
      );
    `);
  }

  prepare(sql) {
    return new SqliteD1Statement(this.database.prepare(sql));
  }

  async batch(statements) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  row(id) {
    return this.database.prepare(
      "SELECT id, actor_id, entity_kind, target_id, input_address, consumed_at FROM address_validation_reviews WHERE id = ?",
    ).get(id);
  }

  close() {
    this.database.close();
  }
}

function googlePayload(possibleNextAction, overrides = {}) {
  return {
    result: {
      address: { formattedAddress: "123 Test St, Portland, ME 04101, USA" },
      geocode: { location: { latitude: 43.6591, longitude: -70.2568 } },
      verdict: {
        possibleNextAction,
        addressComplete: true,
        hasUnconfirmedComponents: false,
        hasInferredComponents: false,
        hasReplacedComponents: false,
        ...overrides,
      },
    },
  };
}

function reviewResult(overrides = {}) {
  return {
    inputAddress: TEST_ADDRESS,
    standardizedAddress: "123 Test Street, Portland, ME 04101",
    latitude: 43.6591,
    longitude: -70.2568,
    verdict: "validated",
    failureCode: null,
    simulated: false,
    ...overrides,
  };
}

function request(body, email = ACTOR, origin = APP_ORIGIN, signal) {
  const url = new URL("/api/v1/address-validation", APP_ORIGIN);
  const headers = new Headers({
    origin,
    "content-type": "application/json",
  });
  if (email) headers.set("oai-authenticated-user-email", email);
  const value = new Request(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });
  Object.defineProperty(value, "nextUrl", { value: url });
  return value;
}

test("address text, identifiers, and review references are closed and bounded", () => {
  assert.equal(domain.normalizeAddressText(`  ${TEST_ADDRESS}  `), TEST_ADDRESS);
  assert.equal(domain.normalizeAddressText("x".repeat(280)), "x".repeat(280));
  assert.equal(domain.normalizeAddressText("x".repeat(281)), undefined);
  assert.equal(domain.normalizeAddressText("line\nbreak"), undefined);
  assert.equal(domain.normalizeAddressText("", true), undefined);
  assert.equal(domain.normalizeAddressEntityKind("lead"), "lead");
  assert.equal(domain.normalizeAddressEntityKind("future"), null);
  assert.equal(domain.normalizeAddressTargetId("project-1"), "project-1");
  assert.equal(domain.normalizeAddressTargetId("project 1"), null);
  assert.equal(domain.normalizeAddressSessionToken("12345678-1234-4123-8123-123456789abc"), "12345678-1234-4123-8123-123456789abc");
  assert.equal(domain.normalizeAddressSessionToken("x".repeat(37)), null);
  assert.deepEqual(domain.normalizeAddressReviewReference({ id: "review-1", choice: "typed" }), {
    id: "review-1",
    choice: "typed",
  });
  assert.equal(domain.normalizeAddressReviewReference({ id: "review-1", choice: "typed", verdict: "validated" }), null);
});

test("shared 280-character address law rejects Google Form and first-run project overflow", async () => {
  const atLimit = "A".repeat(domain.MAX_ADDRESS_LENGTH);
  const overflows = [
    "B".repeat(domain.MAX_ADDRESS_LENGTH + 1),
    "C".repeat(300),
  ];
  const formRows = await googleFormIntake.mapGoogleFormLeadRows({
    clients: [],
    rows: [atLimit, ...overflows].map((address, index) => ({
      sourceRow: index + 2,
      cells: [
        `2026-08-03T14:0${index}:00Z`,
        `FCI TEST — DO NOT USE — GI-04 address ${index}`,
        address,
        "Office",
        "LVT",
        "gi04@example.test",
      ],
    })),
  });
  assert.equal(formRows[0].state, "ready");
  assert.equal(formRows[0].proposal.site.length, domain.MAX_ADDRESS_LENGTH);
  for (const row of formRows.slice(1)) {
    assert.equal(row.state, "invalid");
    assert.equal(row.proposal.site, "");
    assert.ok(row.reasons.includes("Address contains an unsupported or oversized value."));
    assert.equal(googleFormIntake.parseGoogleFormLeadProposal({
      ...formRows[0].proposal,
      site: overflows[row.sourceRow - 3],
    }), null);
  }

  const projectHeaders = [
    "Project Name",
    "Client Code",
    "Client / Company",
    "Client Email",
    "Site",
    "Status",
    "Estimated Value",
    "Flooring Category",
    "Square Feet",
    "Contract Value",
    "Segment",
  ];
  const storedClient = {
    id: "gi04-client",
    clientCode: "CL-GI040001",
    sourceClientCodes: [],
    name: "FCI TEST — DO NOT USE — GI-04 stored client",
    emails: ["gi04-client@example.test"],
    phones: [],
    addresses: [],
    addressDigests: [],
  };
  const projectPreview = await firstRunImport.previewFirstRunImport({
    entity: "projects",
    expectedHeaders: projectHeaders,
    snapshot: { clients: [storedClient], projects: [] },
    values: [
      projectHeaders,
      ...[atLimit, ...overflows].map((site, index) => [
        `FCI TEST — DO NOT USE — GI-04 project ${index}`,
        storedClient.clientCode,
        storedClient.name,
        storedClient.emails[0],
        site,
        "planning",
        "",
        "",
        "",
        "",
        "",
      ]),
    ],
  });
  assert.deepEqual(projectPreview.rows.map(({ state }) => state), [
    "ready",
    "invalid",
    "invalid",
  ]);
  assert.equal(projectPreview.rows[0].values.project.site.length, domain.MAX_ADDRESS_LENGTH);
  for (const row of projectPreview.rows.slice(1)) {
    assert.ok(row.issues.some(({ code }) => code === "project_site_invalid"));
  }
  assert.equal(projectPreview.confirmable, 1);
});

test("simulation is fixture-only and can never manufacture a live validated verdict", () => {
  assert.deepEqual(engine.simulationAddressValidation(TEST_ADDRESS), {
    inputAddress: TEST_ADDRESS,
    standardizedAddress: TEST_ADDRESS,
    latitude: 43.6591,
    longitude: -70.2568,
    verdict: "simulated",
    failureCode: null,
    simulated: true,
  });
  assert.deepEqual(engine.simulationAddressValidation("999 Unknown Fixture Way"), {
    inputAddress: "999 Unknown Fixture Way",
    standardizedAddress: null,
    latitude: null,
    longitude: null,
    verdict: "unvalidated",
    failureCode: "simulation_fixture_not_found",
    simulated: false,
  });
});

test("Google verdict branches map to validated, confirmation, correction, and safe fallback", () => {
  assert.equal(
    engine.classifyGoogleAddressValidation(TEST_ADDRESS, googlePayload("ACCEPT")).verdict,
    "validated",
  );
  assert.equal(
    engine.classifyGoogleAddressValidation(TEST_ADDRESS, googlePayload("CONFIRM")).verdict,
    "needs-confirmation",
  );
  assert.equal(
    engine.classifyGoogleAddressValidation(TEST_ADDRESS, googlePayload("ACCEPT", {
      hasInferredComponents: true,
    })).verdict,
    "needs-confirmation",
  );
  assert.equal(
    engine.classifyGoogleAddressValidation(TEST_ADDRESS, googlePayload("FIX")).verdict,
    "needs-correction",
  );
  assert.deepEqual(engine.classifyGoogleAddressValidation(TEST_ADDRESS, {}), {
    inputAddress: TEST_ADDRESS,
    standardizedAddress: null,
    latitude: null,
    longitude: null,
    verdict: "unvalidated",
    failureCode: "provider_response_unusable",
    simulated: false,
  });
});

test("the owner gate and server-key check prevent live calls, while an enabled call pins the session token", async () => {
  let calls = 0;
  const noNetwork = async () => {
    calls += 1;
    throw new Error("must not call Google");
  };
  const closed = await engine.validateAddress(
    { address: TEST_ADDRESS, sessionToken: "session-token" },
    { simulation: false, liveEnabled: false, serverApiKey: "FCI_TEST_SECRET", enableUspsCass: false },
    { fetch: noNetwork },
  );
  assert.equal(closed.verdict, "unvalidated");
  assert.equal(closed.failureCode, "owner_gate_closed");
  const missingKey = await engine.validateAddress(
    { address: TEST_ADDRESS, sessionToken: "session-token" },
    { simulation: false, liveEnabled: true, enableUspsCass: false },
    { fetch: noNetwork },
  );
  assert.equal(missingKey.failureCode, "server_key_missing");
  assert.equal(calls, 0);

  let observed;
  const live = await engine.validateAddress(
    { address: TEST_ADDRESS, sessionToken: "same-autocomplete-token" },
    {
      simulation: false,
      liveEnabled: true,
      serverApiKey: "FCI_TEST_SECRET",
      enableUspsCass: true,
    },
    {
      async fetch(url, init) {
        observed = { url, init, body: JSON.parse(init.body) };
        return Response.json(googlePayload("ACCEPT"));
      },
    },
  );
  assert.equal(live.verdict, "validated");
  assert.equal(observed.url, engine.GOOGLE_ADDRESS_VALIDATION_ENDPOINT);
  assert.equal(observed.init.headers["X-Goog-Api-Key"], "FCI_TEST_SECRET");
  assert.equal(observed.body.sessionToken, "same-autocomplete-token");
  assert.equal(observed.body.enableUspsCass, true);
});

test("runtime configuration requires the explicit owner gate even when a server key exists", () => {
  assert.deepEqual(config.getSitesAddressValidationRuntime({
    NODE_ENV: "production",
    GOOGLE_INTEGRATION_MODE: "workspace",
    GOOGLE_MAPS_SERVER_API_KEY: "FCI_TEST_SECRET",
  }), {
    simulation: false,
    liveEnabled: false,
    serverApiKey: "FCI_TEST_SECRET",
    enableUspsCass: false,
  });
  assert.equal(config.getSitesAddressValidationRuntime({
    NODE_ENV: "production",
    GOOGLE_INTEGRATION_MODE: "workspace",
    GOOGLE_MAPS_ADDRESS_VALIDATION_ENABLED: "true",
    GOOGLE_MAPS_SERVER_API_KEY: "FCI_TEST_SECRET",
  }).liveEnabled, true);
});

test("review receipts are actor/entity/target/address bound, expire, and consume once", async () => {
  const database = new AddressReviewDatabase();
  try {
    const id = randomUUID();
    await reviews.insertAddressValidationReview(database, {
      id,
      actorId: ACTOR,
      entityKind: "project",
      targetId: "project-1",
      result: reviewResult({ verdict: "needs-confirmation" }),
      now: NOW,
    });
    for (const attempt of [
      { actorId: "other@example.test", entityKind: "project", targetId: "project-1", inputAddress: TEST_ADDRESS },
      { actorId: ACTOR, entityKind: "lead", targetId: "project-1", inputAddress: TEST_ADDRESS },
      { actorId: ACTOR, entityKind: "project", targetId: "project-2", inputAddress: TEST_ADDRESS },
      { actorId: ACTOR, entityKind: "project", targetId: "project-1", inputAddress: "Changed address" },
    ]) {
      const denied = await reviews.consumeAddressValidationReview(database, {
        ...attempt,
        review: { id, choice: "standardized" },
        now: NOW + 1,
      });
      assert.equal(denied.ok, false);
      assert.equal(database.row(id).consumed_at, null);
    }
    const accepted = await reviews.consumeAddressValidationReview(database, {
      actorId: ACTOR,
      entityKind: "project",
      targetId: "project-1",
      inputAddress: TEST_ADDRESS,
      review: { id, choice: "standardized" },
      now: NOW + 2,
    });
    assert.deepEqual(accepted, {
      ok: true,
      value: {
        address: TEST_ADDRESS,
        latitude: 43.6591,
        longitude: -70.2568,
        verdict: "review-confirmed",
      },
      claim: {
        id,
        actorId: ACTOR,
        entityKind: "project",
        targetId: "project-1",
        inputAddress: TEST_ADDRESS,
        consumedAt: NOW + 2,
      },
    });
    assert.equal(database.row(id).consumed_at, NOW + 2);
    assert.equal((await reviews.consumeAddressValidationReview(database, {
      actorId: ACTOR,
      entityKind: "project",
      targetId: "project-1",
      inputAddress: TEST_ADDRESS,
      review: { id, choice: "typed" },
      now: NOW + 3,
    })).ok, false);

    const expiredId = randomUUID();
    await reviews.insertAddressValidationReview(database, {
      id: expiredId,
      actorId: ACTOR,
      entityKind: "client",
      targetId: "new",
      result: reviewResult(),
      now: NOW,
    });
    assert.equal((await reviews.consumeAddressValidationReview(database, {
      actorId: ACTOR,
      entityKind: "client",
      targetId: "new",
      inputAddress: TEST_ADDRESS,
      review: { id: expiredId, choice: "typed" },
      now: NOW + domain.ADDRESS_REVIEW_TTL_MS,
    })).ok, false);
  } finally {
    database.close();
  }
});

test("typed fallback saves no geocode and never trusts client-supplied validation fields", async () => {
  const database = new AddressReviewDatabase();
  try {
    const id = randomUUID();
    await reviews.insertAddressValidationReview(database, {
      id,
      actorId: ACTOR,
      entityKind: "lead",
      targetId: "new",
      result: reviewResult({
        standardizedAddress: null,
        latitude: null,
        longitude: null,
        verdict: "unvalidated",
        failureCode: "owner_gate_closed",
      }),
      now: NOW,
    });
    assert.deepEqual(await mutation.resolveAddressMutation(database, {
      actorId: ACTOR,
      entityKind: "lead",
      targetId: "new",
      rawAddress: TEST_ADDRESS,
      rawReview: {
        id,
        choice: "typed",
        latitude: 43.6591,
        longitude: -70.2568,
        verdict: "validated",
      },
      required: true,
      now: NOW + 1,
    }), {
      ok: false,
      message: "Address review reference is invalid.",
    });
    assert.deepEqual(await mutation.resolveAddressMutation(database, {
      actorId: ACTOR,
      entityKind: "lead",
      targetId: "new",
      rawAddress: TEST_ADDRESS,
      rawReview: { id, choice: "typed" },
      required: true,
      now: NOW + 2,
    }), {
      ok: true,
      value: {
        address: TEST_ADDRESS,
        latitude: null,
        longitude: null,
        verdict: "unvalidated",
      },
      reviewClaim: {
        id,
        actorId: ACTOR,
        entityKind: "lead",
        targetId: "new",
        inputAddress: TEST_ADDRESS,
        consumedAt: NOW + 2,
      },
    });
  } finally {
    database.close();
  }
});

test("failed record mutations release only their exact provisional review claim", async () => {
  const database = new AddressReviewDatabase();
  try {
    const id = randomUUID();
    await reviews.insertAddressValidationReview(database, {
      id,
      actorId: ACTOR,
      entityKind: "client",
      targetId: "client-1",
      result: reviewResult(),
      now: NOW,
    });
    const first = await mutation.resolveAddressMutation(database, {
      actorId: ACTOR,
      entityKind: "client",
      targetId: "client-1",
      rawAddress: TEST_ADDRESS,
      rawReview: { id, choice: "standardized" },
      now: NOW + 1,
    });
    assert.equal(first.ok, true);
    assert.equal(database.row(id).consumed_at, NOW + 1);

    // A known conflict/duplicate/not-found outcome did not mutate the record.
    await mutation.releaseFailedAddressMutation(database, first);
    assert.equal(database.row(id).consumed_at, null);

    const retry = await mutation.resolveAddressMutation(database, {
      actorId: ACTOR,
      entityKind: "client",
      targetId: "client-1",
      rawAddress: TEST_ADDRESS,
      rawReview: { id, choice: "standardized" },
      now: NOW + 2,
    });
    assert.equal(retry.ok, true);
    assert.equal(database.row(id).consumed_at, NOW + 2);

    // A successful mutation deliberately retains the claim, so replay closes.
    assert.equal((await mutation.resolveAddressMutation(database, {
      actorId: ACTOR,
      entityKind: "client",
      targetId: "client-1",
      rawAddress: TEST_ADDRESS,
      rawReview: { id, choice: "standardized" },
      now: NOW + 3,
    })).ok, false);
  } finally {
    database.close();
  }
});

test("insert-time cleanups never delete a provisionally claimed receipt", async () => {
  const database = new AddressReviewDatabase();
  try {
    // Expiry-sweep leg: a claimed receipt whose TTL lapsed mid-flight
    // survives the sweep a later insert triggers, while an unclaimed
    // expired receipt is still swept.
    const claimedId = randomUUID();
    const unclaimedExpiredId = randomUUID();
    await reviews.insertAddressValidationReview(database, {
      id: claimedId,
      actorId: ACTOR,
      entityKind: "project",
      targetId: "project-1",
      result: reviewResult(),
      now: NOW,
    });
    await reviews.insertAddressValidationReview(database, {
      id: unclaimedExpiredId,
      actorId: ACTOR,
      entityKind: "client",
      targetId: "client-1",
      result: reviewResult(),
      now: NOW,
    });
    const claimed = await reviews.consumeAddressValidationReview(database, {
      actorId: ACTOR,
      entityKind: "project",
      targetId: "project-1",
      inputAddress: TEST_ADDRESS,
      review: { id: claimedId, choice: "standardized" },
      now: NOW + 1,
    });
    assert.equal(claimed.ok, true);
    const afterExpiry = NOW + domain.ADDRESS_REVIEW_TTL_MS + 1;
    await reviews.insertAddressValidationReview(database, {
      id: randomUUID(),
      actorId: "second-office@cherryhillfci.com",
      entityKind: "lead",
      targetId: "new",
      result: reviewResult(),
      now: afterExpiry,
    });
    assert.equal(database.row(unclaimedExpiredId), undefined);
    assert.equal(database.row(claimedId).consumed_at, NOW + 1);
    await reviews.releaseAddressValidationReview(database, claimed.claim);
    assert.equal(database.row(claimedId).consumed_at, null);

    // Cap-trim leg: the per-actor cap orders by recency, so a claimed
    // receipt that became the actor's oldest row must still survive while
    // the oldest unclaimed rows are trimmed.
    const capActor = "cap-office@cherryhillfci.com";
    const base = afterExpiry;
    const capClaimedId = randomUUID();
    await reviews.insertAddressValidationReview(database, {
      id: capClaimedId,
      actorId: capActor,
      entityKind: "project",
      targetId: "project-cap",
      result: reviewResult(),
      now: base,
    });
    const capClaim = await reviews.consumeAddressValidationReview(database, {
      actorId: capActor,
      entityKind: "project",
      targetId: "project-cap",
      inputAddress: TEST_ADDRESS,
      review: { id: capClaimedId, choice: "standardized" },
      now: base + 1,
    });
    assert.equal(capClaim.ok, true);
    const oldestUnclaimedId = randomUUID();
    await reviews.insertAddressValidationReview(database, {
      id: oldestUnclaimedId,
      actorId: capActor,
      entityKind: "client",
      targetId: "client-cap",
      result: reviewResult(),
      now: base + 2,
    });
    for (let index = 0; index < 25; index += 1) {
      await reviews.insertAddressValidationReview(database, {
        id: randomUUID(),
        actorId: capActor,
        entityKind: "lead",
        targetId: `lead-cap-${index}`,
        result: reviewResult(),
        now: base + 3 + index,
      });
    }
    assert.equal(database.row(oldestUnclaimedId), undefined);
    assert.equal(database.row(capClaimedId).consumed_at, base + 1);
    await reviews.releaseAddressValidationReview(database, capClaim.claim);
    assert.equal(database.row(capClaimedId).consumed_at, null);
  } finally {
    database.close();
  }
});

test("releasing a claim whose receipt vanished is a tolerant no-op", async () => {
  const database = new AddressReviewDatabase();
  try {
    const id = randomUUID();
    await reviews.insertAddressValidationReview(database, {
      id,
      actorId: ACTOR,
      entityKind: "client",
      targetId: "client-1",
      result: reviewResult(),
      now: NOW,
    });
    const resolved = await mutation.resolveAddressMutation(database, {
      actorId: ACTOR,
      entityKind: "client",
      targetId: "client-1",
      rawAddress: TEST_ADDRESS,
      rawReview: { id, choice: "standardized" },
      now: NOW + 1,
    });
    assert.equal(resolved.ok, true);
    database.database.prepare("DELETE FROM address_validation_reviews WHERE id = ?").run(id);
    // The receipt is already gone; the failure response must still reach the
    // user, so both release layers resolve instead of throwing.
    await mutation.releaseFailedAddressMutation(database, resolved);
    await reviews.releaseAddressValidationReview(database, resolved.reviewClaim);
    assert.equal(database.row(id), undefined);
  } finally {
    database.close();
  }
});

class LeadEditDatabase extends AddressReviewDatabase {
  constructor() {
    super();
    this.database.exec(`
      CREATE TABLE leads (
        id TEXT PRIMARY KEY,
        lead_number TEXT NOT NULL,
        company TEXT NOT NULL,
        contact_name TEXT NOT NULL,
        contact_email TEXT,
        contact_phone TEXT,
        project_name TEXT NOT NULL,
        source TEXT NOT NULL,
        stage TEXT NOT NULL,
        site TEXT NOT NULL,
        latitude REAL,
        longitude REAL,
        address_validation_verdict TEXT,
        estimated_value INTEGER NOT NULL,
        next_action TEXT NOT NULL,
        next_action_at INTEGER,
        owner_email TEXT NOT NULL,
        status TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        version INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE activity_events (
        id TEXT PRIMARY KEY,
        record_id TEXT NOT NULL,
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        detail TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    this.beforeLeadUpdate = null;
  }

  prepare(sql) {
    const statement = super.prepare(sql);
    if (/^UPDATE leads SET /u.test(sql)) {
      const originalRun = statement.run.bind(statement);
      statement.run = async () => {
        const sabotage = this.beforeLeadUpdate;
        this.beforeLeadUpdate = null;
        if (sabotage) sabotage();
        return originalRun();
      };
    }
    return statement;
  }

  seedLead() {
    this.database.prepare(`
      INSERT INTO leads (
        id, lead_number, company, contact_name, contact_email, contact_phone,
        project_name, source, stage, site, estimated_value, next_action,
        next_action_at, owner_email, status, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "lead-gi04-conflict",
      "L-2026-GI040001",
      "FCI TEST — DO NOT USE",
      "Test Contact",
      null,
      null,
      "Test Flooring",
      "Referral",
      "Qualified",
      "Old site",
      125_000,
      "Schedule site walk",
      null,
      ACTOR,
      "active",
      ACTOR,
      NOW,
      NOW,
    );
  }
}

test("a receipt that vanishes mid-flight still yields the graceful 409 conflict payload", async () => {
  const database = new LeadEditDatabase();
  try {
    database.seedLead();
    Object.assign(workerEnvironment, {
      NODE_ENV: "test",
      FCI_OFFICE_EMAILS: ACTOR,
      DB: database,
    });
    const id = randomUUID();
    await reviews.insertAddressValidationReview(database, {
      id,
      actorId: ACTOR,
      entityKind: "lead",
      targetId: "lead-gi04-conflict",
      result: reviewResult(),
      now: Date.now(),
    });
    database.beforeLeadUpdate = () => {
      // A concurrent editor wins the version race, and the provisional
      // receipt vanishes before the losing request can release its claim.
      database.database.exec(
        "UPDATE leads SET version = version + 1 WHERE id = 'lead-gi04-conflict'",
      );
      database.database.exec("DELETE FROM address_validation_reviews");
    };
    const response = await leadPatchRoute.PATCH(
      new NextRequest(`${APP_ORIGIN}/api/v1/leads/lead-gi04-conflict`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          origin: APP_ORIGIN,
          "oai-authenticated-user-email": ACTOR,
        },
        body: JSON.stringify({
          version: "1",
          site: TEST_ADDRESS,
          addressReview: { id, choice: "standardized" },
        }),
      }),
      { params: Promise.resolve({ leadId: "lead-gi04-conflict" }) },
    );
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: "Lead changed since it was loaded.",
      currentVersion: "2",
      currentValues: { site: "Old site" },
    });
    assert.equal(
      database.database
        .prepare("SELECT site FROM leads WHERE id = 'lead-gi04-conflict'")
        .get().site,
      "Old site",
    );
  } finally {
    database.close();
  }
});

test("all six record routes preserve provisional review claims on known mutation failures", async () => {
  const routeCalls = new Map([
    ["../app/api/v1/leads/route.ts", 1],
    ["../app/api/v1/clients/route.ts", 1],
    ["../app/api/v1/projects/route.ts", 1],
    ["../app/api/v1/leads/[leadId]/route.ts", 2],
    ["../app/api/v1/clients/[clientId]/route.ts", 1],
    ["../app/api/v1/projects/[projectId]/route.ts", 1],
  ]);
  for (const [path, expectedCalls] of routeCalls) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.equal(
      source.match(/await releaseFailedAddressMutation\(/gu)?.length,
      expectedCalls,
      path,
    );
  }
  const leadPatch = await readFile(
    new URL("../app/api/v1/leads/[leadId]/route.ts", import.meta.url),
    "utf8",
  );
  assert.ok(
    leadPatch.indexOf("normalized.value.version !== current.version")
      < leadPatch.indexOf("resolveAddressMutation(database"),
    "lead conflict comparison must happen before a review claim",
  );
});

test("the shared route is bounded, closed-key, simulation-backed, and never returns a key", async () => {
  const database = new AddressReviewDatabase();
  try {
    Object.assign(workerEnvironment, {
      NODE_ENV: "test",
      FCI_OFFICE_EMAILS: ACTOR,
      GOOGLE_INTEGRATION_MODE: "simulation",
      GOOGLE_MAPS_SERVER_API_KEY: "FCI_TEST_SECRET_MUST_NOT_LEAK",
      DB: database,
    });
    const valid = await route.POST(request({
      address: TEST_ADDRESS,
      entityKind: "client",
      targetId: "new",
      sessionToken: "12345678-1234-4123-8123-123456789abc",
    }));
    assert.equal(valid.status, 200);
    assert.equal(valid.headers.get("cache-control"), "no-store");
    const payload = await valid.json();
    assert.equal(payload.availability, "simulation");
    assert.equal(payload.review.verdict, "simulated");
    assert.equal(payload.review.simulated, true);
    assert.doesNotMatch(JSON.stringify(payload), /FCI_TEST_SECRET_MUST_NOT_LEAK/u);

    const tooLong = await route.POST(request({
      address: "x".repeat(281),
      entityKind: "client",
      targetId: "new",
      sessionToken: "12345678-1234-4123-8123-123456789abd",
    }));
    assert.equal(tooLong.status, 400);
    const unknownKey = await route.POST(request({
      address: TEST_ADDRESS,
      entityKind: "client",
      targetId: "new",
      sessionToken: "12345678-1234-4123-8123-123456789abe",
      verdict: "validated",
    }));
    assert.equal(unknownKey.status, 400);
    assert.equal(database.database.prepare(
      "SELECT COUNT(*) AS count FROM address_validation_reviews",
    ).get().count, 1);
  } finally {
    database.close();
  }
});

test("client cancellation aborts the provider and inserts no review receipt", async () => {
  const database = new AddressReviewDatabase();
  const originalFetch = globalThis.fetch;
  let providerStarted;
  const started = new Promise((resolve) => {
    providerStarted = resolve;
  });
  let providerAborted = false;
  globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
    providerStarted();
    init.signal.addEventListener("abort", () => {
      providerAborted = true;
      reject(new DOMException("canceled", "AbortError"));
    }, { once: true });
  });
  try {
    Object.assign(workerEnvironment, {
      NODE_ENV: "test",
      FCI_OFFICE_EMAILS: ACTOR,
      GOOGLE_INTEGRATION_MODE: "workspace",
      GOOGLE_MAPS_ADDRESS_VALIDATION_ENABLED: "true",
      GOOGLE_MAPS_SERVER_API_KEY: "FCI_TEST_SECRET",
      DB: database,
    });
    const controller = new AbortController();
    const responsePromise = route.POST(request({
      address: TEST_ADDRESS,
      entityKind: "project",
      targetId: "project-canceled",
      sessionToken: "12345678-1234-4123-8123-123456789abf",
    }, ACTOR, APP_ORIGIN, controller.signal));
    await started;
    controller.abort();
    const response = await responsePromise;
    assert.equal(response.status, 499);
    assert.equal(providerAborted, true);
    assert.deepEqual(await response.json(), { error: "Address review was canceled." });
    assert.equal(database.database.prepare(
      "SELECT COUNT(*) AS count FROM address_validation_reviews",
    ).get().count, 0);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});
