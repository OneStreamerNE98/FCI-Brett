import assert from "node:assert/strict";
import test from "node:test";

const {
  cachedGetJson,
  clearCachedGets,
  revalidateSubscribedCachedGets,
  subscribeCachedGet,
} = await import("../app/lib/client-get-cache.ts");

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

/** Resolves once `predicate` holds, without racing an arbitrary sleep. */
async function until(predicate, label) {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.fail(`timed out waiting for ${label}`);
}

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  clearCachedGets();
});

/**
 * SET-42 states that an explicit retry bypasses a cached failure. A forced read
 * that adopts a background revalidation's in-flight request replays that older
 * request's outcome without ever re-contacting the server, which breaks the
 * doctrine for Retry on Operations health, the OAuth-callback refresh, and every
 * post-mutation read.
 */
test("a forced read starts its own request instead of adopting a background revalidation", async () => {
  const url = "/api/v1/test/forced-read-vs-background";
  const requested = [];
  let releaseBackground;

  globalThis.fetch = () => {
    const index = requested.length;
    requested.push(index);
    if (index === 1) {
      return new Promise((resolve) => {
        releaseBackground = () => resolve(jsonResponse({ read: "stale-background" }));
      });
    }
    return Promise.resolve(jsonResponse({ read: index === 0 ? "seed" : "forced-fresh" }));
  };

  // Seed a value that is already stale, so the next plain read returns it and
  // kicks off exactly one background revalidation.
  assert.deepEqual(await cachedGetJson(url, { ttlMs: 0 }), { read: "seed" });
  assert.deepEqual(await cachedGetJson(url), { read: "seed" });
  await until(() => requested.length === 2, "the background revalidation to start");

  const forced = cachedGetJson(url, { force: true });
  await until(() => requested.length === 3, "the forced read to contact the server itself");

  releaseBackground();
  assert.deepEqual(
    await forced,
    { read: "forced-fresh" },
    "a forced read must surface its own response, not the background request's",
  );
  assert.equal(requested.length, 3, "the forced read must issue its own GET");
});

/**
 * The same defect, stated as the user-visible symptom: an administrator clicks
 * Retry after a failure and is shown the outcome of a request that was already
 * in flight before they clicked, without the server being re-contacted.
 */
test("a forced retry does not replay an in-flight background failure", async () => {
  const url = "/api/v1/test/forced-retry-after-failure";
  const requested = [];
  let releaseBackground;

  globalThis.fetch = () => {
    const index = requested.length;
    requested.push(index);
    if (index === 1) {
      return new Promise((resolve) => {
        releaseBackground = () => resolve(jsonResponse({ error: "upstream exploded" }, 500));
      });
    }
    return Promise.resolve(jsonResponse({ read: index === 0 ? "seed" : "recovered" }));
  };

  assert.deepEqual(await cachedGetJson(url, { ttlMs: 0 }), { read: "seed" });
  await cachedGetJson(url);
  await until(() => requested.length === 2, "the background revalidation to start");

  const retry = cachedGetJson(url, { force: true });
  await until(() => requested.length === 3, "the explicit retry to contact the server");
  releaseBackground();

  assert.deepEqual(
    await retry,
    { read: "recovered" },
    "an explicit retry must reach the server rather than inherit the failure already in flight",
  );
});

/** Two forced reads in the same census legitimately share one GET per URL. */
test("a forced read still joins another forced read already in flight", async () => {
  const url = "/api/v1/test/forced-shares-with-forced";
  let requests = 0;
  let release;

  globalThis.fetch = () => {
    requests += 1;
    return new Promise((resolve) => {
      release = () => resolve(jsonResponse({ read: "single" }));
    });
  };

  const first = cachedGetJson(url, { force: true });
  await until(() => requests === 1, "the first forced read to start");
  const second = cachedGetJson(url, { force: true });
  release();

  assert.deepEqual(await first, { read: "single" });
  assert.deepEqual(await second, { read: "single" });
  assert.equal(requests, 1, "concurrent forced reads of one URL must collapse into one GET");
});

/**
 * SET-42 deleted the manual refresh buttons and replaced them with
 * focus/visibility/navigation revalidation. A trigger that lands while a census
 * is already running is a new freshness demand, not a duplicate: the running
 * pass may already have read every URL before the trigger existed. Dropping it
 * means an administrator who tabs back mid-pass sees no refresh at all.
 */
test("a lifecycle trigger that arrives during a census is served, not dropped", async () => {
  const url = "/api/v1/test/lifecycle-trigger-during-census";
  let requests = 0;
  let releaseFirst;

  globalThis.fetch = () => {
    requests += 1;
    if (requests === 1) {
      return new Promise((resolve) => {
        releaseFirst = () => resolve(jsonResponse({ round: 1 }));
      });
    }
    return Promise.resolve(jsonResponse({ round: requests }));
  };

  const unsubscribe = subscribeCachedGet(url, () => {});
  try {
    void revalidateSubscribedCachedGets();
    await until(() => requests === 1, "the first census to issue its read");

    // The administrator tabs back while the first census is still in flight.
    const triggered = revalidateSubscribedCachedGets();
    releaseFirst();
    await triggered;

    assert.equal(
      requests,
      2,
      "a trigger arriving mid-census must still produce its own read of every subscribed URL",
    );
  } finally {
    unsubscribe();
  }
});

/** A burst of triggers during one census queues one extra round, not one per trigger. */
test("a burst of lifecycle triggers during a census queues a single extra round", async () => {
  const url = "/api/v1/test/lifecycle-trigger-burst";
  let requests = 0;
  let releaseFirst;

  globalThis.fetch = () => {
    requests += 1;
    if (requests === 1) {
      return new Promise((resolve) => {
        releaseFirst = () => resolve(jsonResponse({ round: 1 }));
      });
    }
    return Promise.resolve(jsonResponse({ round: requests }));
  };

  const unsubscribe = subscribeCachedGet(url, () => {});
  try {
    void revalidateSubscribedCachedGets();
    await until(() => requests === 1, "the first census to issue its read");

    const triggered = [
      revalidateSubscribedCachedGets(),
      revalidateSubscribedCachedGets(),
      revalidateSubscribedCachedGets(),
    ];
    releaseFirst();
    await Promise.all(triggered);

    assert.equal(requests, 2, "three triggers in one census must coalesce into one extra round");
  } finally {
    unsubscribe();
  }
});
