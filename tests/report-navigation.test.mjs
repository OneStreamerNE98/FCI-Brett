import assert from "node:assert/strict";
import test from "node:test";
import {
  clearReportReturnFocusFromCurrentHistoryEntry,
  rememberReportReturnFocus,
  reportsReturnFocusHistoryKey,
} from "../app/features/reports/report-navigation.ts";

function reportWindow(initialState = null) {
  let historyState = initialState;
  let replaceCount = 0;
  const storage = new Map();

  return {
    window: {
      history: {
        get state() {
          return historyState;
        },
        replaceState(nextState, _unused, url) {
          historyState = nextState;
          replaceCount += 1;
          this.lastUrl = url;
        },
        lastUrl: null,
      },
      location: { href: "https://example.test/reports" },
      sessionStorage: {
        getItem(key) {
          return storage.get(key) ?? null;
        },
        setItem(key, value) {
          storage.set(key, String(value));
        },
        removeItem(key) {
          storage.delete(key);
        },
      },
    },
    state: () => historyState,
    replaceCount: () => replaceCount,
    storage,
  };
}

test("report navigation preserves unrelated history state and clears only its focus marker", () => {
  const originalWindow = globalThis.window;
  const harness = reportWindow({ durableRoute: "reports" });
  globalThis.window = harness.window;

  try {
    rememberReportReturnFocus("report-project-mobilizing", "project:mobilizing");

    assert.deepEqual(harness.state(), {
      durableRoute: "reports",
      [reportsReturnFocusHistoryKey]: "report-project-mobilizing",
    });
    assert.equal(harness.storage.get("fci-reports-destination-focus"), "project:mobilizing");
    assert.equal(harness.window.history.lastUrl, "https://example.test/reports");

    clearReportReturnFocusFromCurrentHistoryEntry();

    assert.deepEqual(harness.state(), { durableRoute: "reports" });
    assert.equal(harness.replaceCount(), 2);

    clearReportReturnFocusFromCurrentHistoryEntry();
    assert.equal(harness.replaceCount(), 2);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
