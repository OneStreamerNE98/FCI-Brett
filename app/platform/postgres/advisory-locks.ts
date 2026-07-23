/**
 * Transaction-scoped advisory locks are database-wide rather than schema-scoped.
 * Core rehearsals and administration mutations protect unrelated invariants, so
 * their stable identities must remain distinct to avoid cross-subsystem blocking.
 */
export const CORE_REHEARSAL_ADVISORY_LOCK_ID = "7314269172071302";
export const ADMIN_ACCESS_MUTATION_LOCK_ID = "7314269172071303";
