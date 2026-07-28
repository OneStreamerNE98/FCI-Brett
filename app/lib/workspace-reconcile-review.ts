export type WorkspaceReconcileMissingReview = Readonly<{
  mode: "reconcile-missing";
  resourceKey: string;
  expectedVersion: number;
}>;

type WorkspaceReconcileReviewParseResult =
  | Readonly<{ ok: true; review: WorkspaceReconcileMissingReview | null }>
  | Readonly<{ ok: false }>;

const WORKSPACE_RESOURCE_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/**
 * Existing setup callers send an empty object. SET-18 may instead carry one
 * closed, review-first missing-resource instruction. No other body shape is
 * accepted, so a human review cannot silently widen into a bulk ensure.
 */
export function parseWorkspaceReconcileMissingReview(
  body: Readonly<Record<string, unknown>>,
): WorkspaceReconcileReviewParseResult {
  const keys = Object.keys(body);
  if (keys.length === 0) return Object.freeze({ ok: true, review: null });
  if (
    keys.length !== 3
    || !keys.includes("mode")
    || !keys.includes("resourceKey")
    || !keys.includes("expectedVersion")
    || body.mode !== "reconcile-missing"
    || typeof body.resourceKey !== "string"
    || body.resourceKey !== body.resourceKey.trim()
    || body.resourceKey.length === 0
    || body.resourceKey.length > 64
    || !WORKSPACE_RESOURCE_KEY.test(body.resourceKey)
    || !Number.isSafeInteger(body.expectedVersion)
    || Number(body.expectedVersion) < 0
  ) {
    return Object.freeze({ ok: false });
  }
  return Object.freeze({
    ok: true,
    review: Object.freeze({
      mode: "reconcile-missing",
      resourceKey: body.resourceKey,
      expectedVersion: Number(body.expectedVersion),
    }),
  });
}
