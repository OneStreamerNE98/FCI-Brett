import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer as createViteServer } from "vite";

const rootUrl = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, rootUrl), "utf8");

const vite = await createViteServer({
  root: fileURLToPath(rootUrl),
  cacheDir: "work/vite-tests/job-site-maps",
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, hmr: { port: 24740 } },
});

const [maps, cardModule, securityHeaders] = await Promise.all([
  vite.ssrLoadModule("/app/features/maps/job-site-map.ts"),
  vite.ssrLoadModule("/app/features/maps/JobSiteMapCard.tsx"),
  vite.ssrLoadModule("/worker/security-headers.ts"),
]);

after(async () => {
  await vite.close();
});

const addressLocation = maps.normalizeJobSiteLocation({
  address: "  201 E2E Test Ave,   Cherry Hill, NJ  ",
});
const geocodedLocation = maps.normalizeJobSiteLocation({
  latitude: "39.9268",
  longitude: -75.0246,
});
const liveRuntime = maps.resolveJobSiteMapsRuntimeConfig({
  simulation: false,
  browserApiKey: "FCI TEST browser/key",
});

function renderCard(location, runtime, contextLabel = "CF-2026-E2E00001 Test project") {
  return renderToStaticMarkup(React.createElement(cardModule.JobSiteMapCard, {
    location,
    runtime,
    contextLabel,
  }));
}

test("normalizes stored addresses and complete geocodes without mapping display sentinels", () => {
  assert.deepEqual(addressLocation, {
    address: "201 E2E Test Ave, Cherry Hill, NJ",
    latitude: null,
    longitude: null,
  });
  assert.deepEqual(geocodedLocation, {
    address: null,
    latitude: 39.9268,
    longitude: -75.0246,
  });
  assert.equal(maps.normalizeJobSiteLocation({ address: "Site pending" }), null);
  assert.equal(maps.normalizeJobSiteLocation({ address: "   " }), null);
  assert.equal(maps.normalizeJobSiteLocation({ latitude: 39.9 }), null);
  assert.equal(maps.normalizeJobSiteLocation({ latitude: 91, longitude: -75 }), null);
  assert.equal(maps.normalizeJobSiteLocation({ latitude: "  ", longitude: "  " }), null);
  assert.equal(maps.normalizeJobSiteLocation({ latitude: false, longitude: true }), null);
});

test("pins the exact keyless directions URL and direct satellite Embed v1 URL", () => {
  assert.equal(
    maps.buildGoogleMapsDirectionsUrl(addressLocation),
    "https://www.google.com/maps/dir/?api=1&destination=201%20E2E%20Test%20Ave%2C%20Cherry%20Hill%2C%20NJ",
  );
  assert.equal(
    maps.buildGoogleMapsDirectionsUrl(geocodedLocation),
    "https://www.google.com/maps/dir/?api=1&destination=39.9268%2C-75.0246",
  );
  assert.equal(
    maps.buildGoogleMapsEmbedUrl(geocodedLocation, "FCI TEST browser/key"),
    "https://www.google.com/maps/embed/v1/place?key=FCI%20TEST%20browser%2Fkey&q=39.9268%2C-75.0246&maptype=satellite",
  );
});

test("resolves no-address, simulation, missing-key, and live states fail closed", () => {
  const simulationRuntime = maps.resolveJobSiteMapsRuntimeConfig({
    simulation: true,
    browserApiKey: "must-not-render",
  });
  const missingKeyRuntime = maps.resolveJobSiteMapsRuntimeConfig({
    simulation: false,
    browserApiKey: "   ",
  });

  assert.deepEqual(simulationRuntime, { simulation: true, browserApiKey: null });
  assert.equal(maps.resolveJobSiteMapState(null, liveRuntime).kind, "no-address");
  assert.equal(maps.resolveJobSiteMapState(addressLocation, simulationRuntime).kind, "simulation");
  assert.equal(maps.resolveJobSiteMapState(addressLocation, missingKeyRuntime).kind, "missing-key");
  assert.equal(maps.resolveJobSiteMapState(addressLocation, liveRuntime).kind, "live");
  assert.equal(maps.resolveJobSiteMapState(addressLocation, missingKeyRuntime).embedUrl, null);
  assert.ok(maps.resolveJobSiteMapState(addressLocation, missingKeyRuntime).directionsUrl);
});

test("renders address, no-address, simulation, and missing-key cards without false live embeds", () => {
  const live = renderCard(geocodedLocation, liveRuntime);
  assert.match(live, /data-map-state="live"/);
  assert.match(live, /<iframe/);
  assert.match(live, /maptype=satellite/);
  assert.match(live, /Coordinates 39\.9268,-75\.0246/);
  assert.match(live, /referrerPolicy="strict-origin-when-cross-origin"/);
  assert.match(live, /Open directions/);

  const noAddress = renderCard(null, liveRuntime, "E2E-CLIENT No-address client");
  assert.match(noAddress, /data-map-state="no-address"/);
  assert.match(noAddress, /No job-site address is stored/);
  assert.doesNotMatch(noAddress, /<iframe|<a\b/);

  const simulation = renderCard(
    addressLocation,
    maps.resolveJobSiteMapsRuntimeConfig({ simulation: true, browserApiKey: "must-not-render" }),
  );
  assert.match(simulation, /data-map-state="simulation"/);
  assert.match(simulation, /Simulation shows this placeholder without loading Google Maps/);
  assert.match(simulation, /Open directions/);
  assert.doesNotMatch(simulation, /<iframe|must-not-render/);

  const missingKey = renderCard(
    addressLocation,
    maps.resolveJobSiteMapsRuntimeConfig({ simulation: false }),
  );
  assert.match(missingKey, /data-map-state="missing-key"/);
  assert.match(missingKey, /restricted Maps browser key is not configured/);
  assert.match(missingKey, /Open directions/);
  assert.doesNotMatch(missingKey, /<iframe/);
});

test("pins the HTML CSP without changing non-HTML responses", () => {
  assert.equal(
    securityHeaders.APPLICATION_CONTENT_SECURITY_POLICY,
    "frame-src 'self' https://www.google.com",
  );
  const htmlResponse = securityHeaders.applyApplicationSecurityHeaders(new Response("<html></html>", {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  }));
  assert.equal(
    htmlResponse.headers.get("content-security-policy"),
    "frame-src 'self' https://www.google.com",
  );
  const protectedHtmlResponse = securityHeaders.applyApplicationSecurityHeaders(new Response("<html></html>", {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'self'; frame-ancestors 'none'; frame-src https://drive.google.com",
    },
  }));
  assert.equal(
    protectedHtmlResponse.headers.get("content-security-policy"),
    "default-src 'self'; frame-ancestors 'none'; frame-src https://drive.google.com 'self' https://www.google.com",
  );
  const jsonResponse = securityHeaders.applyApplicationSecurityHeaders(new Response("{}", {
    headers: { "Content-Type": "application/json" },
  }));
  assert.equal(jsonResponse.headers.get("content-security-policy"), null);
});

test("uses a direct browser iframe and ships no server Maps tile proxy", async () => {
  const apiEntries = await readdir(new URL("app/api/", rootUrl), { recursive: true });
  const routePaths = apiEntries
    .map((entry) => String(entry).replaceAll("\\", "/"))
    .filter((entry) => entry.endsWith("/route.ts") || entry === "route.ts");
  const serverSource = (await Promise.all([
    ...routePaths.map((path) => read(`app/api/${path}`)),
    read("worker/index.ts"),
    read("app/platform/google-cloud/employee-request-router.ts"),
  ])).join("\n");
  const [cardSource, helperSource] = await Promise.all([
    read("app/features/maps/JobSiteMapCard.tsx"),
    read("app/features/maps/job-site-map.ts"),
  ]);

  assert.match(cardSource, /<iframe/);
  assert.match(helperSource, /https:\/\/www\.google\.com/);
  assert.doesNotMatch(cardSource, /\bfetch\s*\(/);
  assert.doesNotMatch(serverSource, /www\.google\.com\/maps|maps\/embed\/v1|maps\/tiles/i);
  assert.equal(routePaths.some((path) => /(?:^|\/)maps(?:\/|$)|tiles/i.test(path)), false);
});
