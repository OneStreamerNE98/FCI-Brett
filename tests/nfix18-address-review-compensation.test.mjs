import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const NOW = Date.UTC(2026, 7, 9, 16);
const REVIEW_ID = "review-nfix18";
const ACTOR = "office@cherryhillfci.com";
const ADDRESS = "123 Test Street, Portland, ME 04101";
const rootUrl = new URL("../", import.meta.url);

const vite = await createServer({
  root: fileURLToPath(rootUrl),
  cacheDir: fileURLToPath(new URL("../node_modules/.vite-nfix18-address-review", import.meta.url)),
  configFile: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, hmr: false },
});

const [mutation, reviews] = await Promise.all([
  vite.ssrLoadModule("/app/lib/address-mutation-sites.ts"),
  vite.ssrLoadModule("/app/adapters/d1/address-validation-reviews.ts"),
]);

after(async () => {
  await vite.close();
});

class AddressReviewDatabase {
  constructor(rows) {
    this.rows = rows;
    this.releaseFailuresRemaining = 0;
    this.releaseAttempts = 0;
  }

  prepare(sql) {
    const statement = {
      values: [],
      bind: (...values) => {
        statement.values = values;
        return statement;
      },
      run: async () => {
        if (/SET consumed_at = \?/u.test(sql)) {
          const [consumedAt, id, actorId, entityKind, targetId, inputAddress, now] = statement.values;
          const row = this.rows.find((candidate) => (
            candidate.id === id
            && candidate.actor_id === actorId
            && candidate.entity_kind === entityKind
            && candidate.target_id === targetId
            && candidate.input_address === inputAddress
            && candidate.consumed_at === null
            && candidate.expires_at > now
          ));
          if (!row) return { meta: { changes: 0 } };
          row.consumed_at = consumedAt;
          return { meta: { changes: 1 } };
        }
        if (/SET consumed_at = NULL/u.test(sql)) {
          this.releaseAttempts += 1;
          if (this.releaseFailuresRemaining > 0) {
            this.releaseFailuresRemaining -= 1;
            throw new Error("FCI TEST transient D1 release failure");
          }
          const [id, actorId, entityKind, targetId, inputAddress, consumedAt] = statement.values;
          const row = this.rows.find((candidate) => (
            candidate.id === id
            && candidate.actor_id === actorId
            && candidate.entity_kind === entityKind
            && candidate.target_id === targetId
            && candidate.input_address === inputAddress
            && candidate.consumed_at === consumedAt
          ));
          if (row) row.consumed_at = null;
          return { meta: { changes: row ? 1 : 0 } };
        }
        throw new Error(`Unexpected mutation query: ${sql}`);
      },
      first: async () => {
        if (!/FROM address_validation_reviews/u.test(sql)) {
          throw new Error(`Unexpected read query: ${sql}`);
        }
        const [id, actorId, consumedAt] = statement.values;
        return this.rows.find((row) => (
          row.id === id && row.actor_id === actorId && row.consumed_at === consumedAt
        )) ?? null;
      },
      all: async () => {
        if (!/WHERE consumed_at IS NOT NULL AND consumed_at <= \?/u.test(sql)) {
          throw new Error(`Unexpected reconciliation query: ${sql}`);
        }
        const [staleBefore, limit] = statement.values;
        return {
          results: this.rows
            .filter((row) => row.consumed_at !== null && row.consumed_at <= staleBefore)
            .sort((left, right) => right.consumed_at - left.consumed_at)
            .slice(0, limit),
        };
      },
    };
    return statement;
  }
}

function reviewRow(overrides = {}) {
  return {
    id: REVIEW_ID,
    actor_id: ACTOR,
    entity_kind: "client",
    target_id: "client-1",
    input_address: ADDRESS,
    standardized_address: "123 Test St, Portland, ME 04101",
    latitude: 43.6591,
    longitude: -70.2568,
    verdict: "validated",
    failure_code: null,
    simulated: 0,
    created_at: NOW,
    expires_at: NOW + (15 * 60 * 1_000),
    consumed_at: null,
    ...overrides,
  };
}

test("NFIX-18 retries a thrown release and does not leak the consumed claim", async () => {
  const row = reviewRow();
  const database = new AddressReviewDatabase([row]);
  const resolution = await mutation.resolveAddressMutation(database, {
    actorId: ACTOR,
    entityKind: "client",
    targetId: "client-1",
    rawAddress: ADDRESS,
    rawReview: { id: REVIEW_ID, choice: "typed" },
    now: NOW + 1,
  });
  assert.equal(resolution.ok, true);
  assert.equal(row.consumed_at, NOW + 1);

  database.releaseFailuresRemaining = 1;
  await mutation.releaseFailedAddressMutation(database, resolution);

  assert.equal(database.releaseAttempts, 2);
  assert.equal(row.consumed_at, null);
});

test("NFIX-18 reconciliation read exposes only claims beyond normal retention", async () => {
  const stale = reviewRow({
    id: "review-stale",
    consumed_at: NOW - reviews.ADDRESS_REVIEW_CONSUMED_RETENTION_MS - 1,
  });
  const recent = reviewRow({ id: "review-recent", consumed_at: NOW - 1_000 });
  const database = new AddressReviewDatabase([stale, recent]);

  const claims = await mutation.listStaleAddressReviewClaims(database, { now: NOW, limit: 51 });
  assert.deepEqual(claims.map((claim) => claim.id), ["review-stale"]);

  const [routeSource, cardSource] = await Promise.all([
    readFile(new URL("../app/api/v1/integrations/google/operations/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/settings/components/workspace-operations/WorkspaceOperationsHealthCard.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(routeSource, /listStaleAddressReviewClaims\(env\.DB/u);
  assert.match(routeSource, /addressReviewClaims:/u);
  assert.match(cardSource, /Stale address-review claim/u);
  assert.match(cardSource, /Do not reopen review rows by hand\./u);
});
