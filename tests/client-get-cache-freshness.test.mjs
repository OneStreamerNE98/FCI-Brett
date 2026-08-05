import assert from "node:assert/strict";
import test from "node:test";

import {
  clearCachedGets,
  revalidateSubscribedCachedGets,
  subscribeCachedGet,
} from "../app/lib/client-get-cache.ts";

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** Resolves once `predicate` holds, without racing an arbitrary sleep. */
async function until(predicate, label) {
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.fail(`timed out waiting for ${label}`);
}

/**
 * SET-42 deleted the six manual refresh buttons and replaced them with
 * focus/visibility/navigation revalidation, so a dropped trigger is now a
 * dropped refresh with no user-reachable fallback.
 *
 * The census reads every subscribed URL concurrently, and they do not land
 * together: on /settings the Workspace resources read is fast while the
 * directory reads hit the real server. A trigger arriving after the fast read
 * has already been delivered cannot be satisfied by the round still running —
 * that round has already taken delivery of the state it is going to report.
 */
test("a trigger arriving after a census read has landed gets its own round", async () => {
  const fast = "/api/v1/test/census-fast";
  const slow = "/api/v1/test/census-slow";
  const reads = { [fast]: 0, [slow]: 0 };
  const originalFetch = globalThis.fetch;
  let releaseSlow;

  try {
    clearCachedGets();
    globalThis.fetch = async (url) => {
      reads[url] += 1;
      if (url === slow && reads[slow] === 1) {
        return new Promise((resolve) => {
          releaseSlow = () => resolve(jsonResponse({ round: 1 }));
        });
      }
      return jsonResponse({ round: reads[url] });
    };

    let fastDelivered = 0;
    const stopFast = subscribeCachedGet(fast, () => { fastDelivered += 1; });
    const stopSlow = subscribeCachedGet(slow, () => {});
    try {
      void revalidateSubscribedCachedGets();
      // Gate on DELIVERY, not on the request starting: the census notifies this
      // subscriber only once the read has actually landed.
      await until(() => fastDelivered === 1, "the first census round to deliver the fast read");

      // The administrator tabs back at this instant.
      const triggered = revalidateSubscribedCachedGets();
      await until(() => releaseSlow !== undefined, "the slow read to start");
      releaseSlow();
      await triggered;

      assert.equal(
        reads[fast],
        2,
        "a trigger landing after a read was delivered must produce its own read of that URL",
      );
    } finally {
      stopFast();
      stopSlow();
    }
  } finally {
    clearCachedGets();
    globalThis.fetch = originalFetch;
  }
});

/**
 * The counterpart invariant, and the reason the rule is "has a response landed"
 * rather than "is a census running": while every read is still open, each one
 * will answer with server state observed after the new trigger, so the running
 * round already satisfies it. Revalidation must stay single-flight there.
 */
test("triggers arriving before any response lands stay single-flight", async () => {
  const url = "/api/v1/test/census-single-flight";
  const originalFetch = globalThis.fetch;
  let reads = 0;
  let release;

  try {
    clearCachedGets();
    globalThis.fetch = async () => {
      reads += 1;
      return new Promise((resolve) => {
        release = () => resolve(jsonResponse({ read: reads }));
      });
    };

    const stop = subscribeCachedGet(url, () => {});
    try {
      const first = revalidateSubscribedCachedGets();
      const second = revalidateSubscribedCachedGets();
      const third = revalidateSubscribedCachedGets();
      assert.equal(reads, 1, "triggers before any response lands must join one census");
      release();
      await Promise.all([first, second, third]);
      assert.equal(reads, 1, "joining triggers must not each queue their own round");
    } finally {
      stop();
    }
  } finally {
    clearCachedGets();
    globalThis.fetch = originalFetch;
  }
});

/** A burst after delivery coalesces into one extra round, not one per trigger. */
test("a burst of triggers after delivery coalesces into a single extra round", async () => {
  const fast = "/api/v1/test/burst-fast";
  const slow = "/api/v1/test/burst-slow";
  const reads = { [fast]: 0, [slow]: 0 };
  const originalFetch = globalThis.fetch;
  let releaseSlow;

  try {
    clearCachedGets();
    globalThis.fetch = async (url) => {
      reads[url] += 1;
      if (url === slow && reads[slow] === 1) {
        return new Promise((resolve) => {
          releaseSlow = () => resolve(jsonResponse({ round: 1 }));
        });
      }
      return jsonResponse({ round: reads[url] });
    };

    let fastDelivered = 0;
    const stopFast = subscribeCachedGet(fast, () => { fastDelivered += 1; });
    const stopSlow = subscribeCachedGet(slow, () => {});
    try {
      void revalidateSubscribedCachedGets();
      await until(() => fastDelivered === 1, "the first census round to deliver the fast read");

      const triggered = [
        revalidateSubscribedCachedGets(),
        revalidateSubscribedCachedGets(),
        revalidateSubscribedCachedGets(),
      ];
      await until(() => releaseSlow !== undefined, "the slow read to start");
      releaseSlow();
      await Promise.all(triggered);

      assert.equal(reads[fast], 2, "three triggers must coalesce into one extra round");
    } finally {
      stopFast();
      stopSlow();
    }
  } finally {
    clearCachedGets();
    globalThis.fetch = originalFetch;
  }
});
