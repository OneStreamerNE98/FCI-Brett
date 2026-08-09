import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(
  new URL("../app/components/ClientDataNotice.tsx", import.meta.url),
  "utf8",
);

test("DES-26 Retry button fires on pointer-down, not click", () => {
  // The retry button must use onPointerDown so the action is captured
  // before a background revalidation can unmount the notice mid-click.
  assert.match(
    source,
    /onPointerDown=\{handlePointerDown\}/u,
    "Retry button must have onPointerDown handler",
  );
  // onClick on the primary action is the old contract; it must not be the
  // sole trigger for the retry button.
  assert.ok(
    !source.includes("onClick={onRetry}"),
    "Retry button must not rely on onClick alone",
  );
});

test("DES-26 Retry button handles keyboard activation", () => {
  // Keyboard users need the same immediate trigger as pointer users.
  assert.match(
    source,
    /onKeyDown=\{handleKeyDown\}/u,
    "Retry button must have onKeyDown handler for keyboard users",
  );
  assert.match(
    source,
    /e\.key === "Enter" \|\| e\.key === " "/u,
    "handleKeyDown must respond to Enter and Space",
  );
});

test("DES-26 Internal retry guard prevents double-fire", () => {
  // A one-shot guard (retryFiredRef) prevents the retry callback from being
  // called twice within a single mount lifetime.
  assert.match(
    source,
    /retryFiredRef\.current/u,
    "retryFiredRef must guard against double-fire",
  );
  assert.match(
    source,
    /retryFiredRef\.current = true/u,
    "retryFiredRef must be set before calling onRetry",
  );
});

test("DES-26 Internal retrying state shows feedback", () => {
  // After the retry fires, the button shows "Retrying…" and is disabled
  // so the user sees their action was received.
  assert.match(
    source,
    /setRetrying\(true\)/u,
    "setRetrying(true) must be called when retry fires",
  );
  assert.match(
    source,
    /disabled=\{retrying\}/u,
    "Retry button must be disabled while retrying",
  );
  assert.match(
    source,
    /"Retrying…"/u,
    "Retrying… feedback text must be present",
  );
});

test("DES-26 Stable DOM attribute for test targeting", () => {
  // A data-retry-stable attribute marks the button so e2e tests can target
  // it without relying on fragile text or class selectors.
  assert.match(
    source,
    /data-retry-stable="true"/u,
    "Retry button must carry data-retry-stable attribute",
  );
});

test("DES-26 Primary-button-only guard on pointer-down", () => {
  // Only the primary (left) button should trigger retry to avoid
  // firing on right-click/context menu.
  assert.match(
    source,
    /e\.button !== 0/u,
    "handlePointerDown must guard against non-primary buttons",
  );
});

test("DES-26 Guard resets on re-entry to error so a second retry is never blocked", () => {
  // The one-shot guard (retryFiredRef) must reset when state transitions
  // back to "error" from a different state.  Without this, the first failed
  // retry permanently disables the button — the 27 call sites do NOT remount
  // the component between retries, so "per mount" is "forever."
  //
  // The mechanism: prevStateRef tracks the previous state; a useEffect
  // detects the transition into "error" and resets the guard + retrying
  // status.
  assert.match(
    source,
    /prevStateRef\.current !== "error"/u,
    "reset guard must check prevStateRef to detect re-entry into error",
  );
  assert.match(
    source,
    /retryFiredRef\.current = false/u,
    "reset guard must clear retryFiredRef so a second retry is possible",
  );
  assert.match(
    source,
    /setRetrying\(false\)/u,
    "reset guard must clear the retrying status so the button is re-enabled",
  );
});

test("DES-26 State-transition effect tracks previous state across renders", () => {
  // prevStateRef must be updated after every render so the next render
  // can compare against the true previous state.
  assert.match(
    source,
    /prevStateRef\.current = state/u,
    "prevStateRef must be written after the guard-reset check",
  );
  assert.match(
    source,
    /prevStateRef = useRef/u,
    "prevStateRef must be a useRef to persist across renders",
  );
  // The useEffect must close with }, [state]) — meaning it re-runs
  // only when state changes.
  assert.match(
    source,
    /\},?\s*\[state\]\)/u,
    "guard-reset useEffect must depend on [state]",
  );
});
