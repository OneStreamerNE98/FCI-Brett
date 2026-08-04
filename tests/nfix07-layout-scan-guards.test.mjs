import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const scannerPath = resolve(repositoryRoot, "tools/nightly/layout-scan.mjs");
const scannerSource = readFileSync(scannerPath, "utf8");

// Importing the module must NOT start a scan: the scanner guards its entrypoint so the
// exported vacuity predicate is testable. If this import ever launches a browser, the
// entrypoint guard has been removed and this whole file will hang or fail loudly.
const { looksVacuous } = await import(pathToFileURL(scannerPath).href);

test("NFIX-07 flags an auth-wall page as vacuous even when controls rendered", () => {
  // August 3: 102 page-views of an "Access not authorized" page reported a clean
  // all-clear. Body text markers must win regardless of how much chrome rendered.
  assert.equal(
    looksVacuous({
      bodyText:
        "Access not authorized. This account is not permitted to view FCI Operations. Contact your administrator to request access.",
      controlCount: 40,
      overlayCount: 0,
    }),
    true,
  );
  assert.equal(
    looksVacuous({
      bodyText:
        "You have been signed out. For your security this session ended after a period of inactivity on this device.",
      controlCount: 25,
      overlayCount: 0,
    }),
    true,
  );
});

test("NFIX-07 applies the minimum-control-count floor to otherwise healthy bodies", () => {
  // Every real page in this app renders many interactive controls; a page with almost
  // none is a broken state whose wording no text match anticipated.
  assert.equal(
    looksVacuous({
      bodyText:
        "Overview Leads Clients Projects Schedule Inbox Assistant Reports Settings — today's appointments, crew schedule, and outstanding estimates at a glance.",
      controlCount: 2,
      overlayCount: 0,
    }),
    true,
  );
});

test("NFIX-07 keeps a healthy, control-rich, overlay-free page non-vacuous", () => {
  assert.equal(
    looksVacuous({
      bodyText:
        "Overview Leads Clients Projects Schedule Inbox Assistant Reports Settings — today's appointments, crew schedule, and outstanding estimates at a glance.",
      controlCount: 25,
      overlayCount: 0,
    }),
    false,
  );
});

test("NFIX-07 keeps the same-scroll-context overlap gate in the probe", () => {
  // Phantom-overlap fix: elements scrolled out of an overflow ancestor must never be
  // compared against elements outside that scroller. Both the helper and its use in the
  // overlap loop must survive.
  assert.match(scannerSource, /const scrollRootOf = \(node\) =>/);
  assert.match(
    scannerSource,
    /if \(scrollRootOf\(targets\[i\]\.element\) !== scrollRootOf\(targets\[j\]\.element\)\) continue;/,
  );
  assert.match(scannerSource, /const reachableHorizontally = \(node\) =>/);
  assert.match(scannerSource, /&& !reachableHorizontally\(element\)/);
});

test("NFIX-07 keeps the closed-details ghost filter in the probe", () => {
  // Chromium gives descendants of a closed <details> full-size layout rects (its
  // ::details-content uses content-visibility, not display:none), so without this filter
  // every collapsed disclosure spawns phantom overlap and overflow findings — the August 3
  // Rename/Open false overlap class. Only the summary of a closed details is on screen.
  assert.match(scannerSource, /element\.closest\("details:not\(\[open\]\)"\)/);
  assert.match(scannerSource, /if \(!summary \|\| !summary\.contains\(element\)\) return false;/);
});

test("NFIX-07 keeps the chunked scan health check so a dying server truncates loudly", () => {
  assert.match(scannerSource, /async function serverStillAlive\(\)/);
  assert.match(scannerSource, /if \(start > 0 && !\(await serverStillAlive\(\)\)\)/);
  assert.match(scannerSource, /error: "server-died",/);
  assert.match(scannerSource, /scanAborted,/);
  assert.match(scannerSource, /SCAN ABORTED/);
  assert.match(scannerSource, /process\.exitCode = 1;/);
});
