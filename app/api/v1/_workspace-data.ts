/**
 * Compatibility boundary for routes that previously bootstrapped D1.
 *
 * Sites applies the checked-in `drizzle/*.sql` sequence before a deployed
 * worker starts serving traffic. Local environments use the same sequence via
 * the explicit migration command. Normal requests must never execute schema
 * DDL, so this helper intentionally performs no database work while callers
 * are migrated away from the legacy name.
 */
export async function ensureWorkspaceSchema() {
  // Schema readiness is a deployment/startup responsibility, not a request concern.
}

export function actorFrom(headers: Headers) {
  const actor = headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
  if (!actor) throw new Error("Authenticated office user is required");
  return actor;
}
