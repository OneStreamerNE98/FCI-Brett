/**
 * Opaque cursor encoding for list pagination.
 *
 * Follows the SET-09 keyset pattern: each cursor carries the sort-column
 * value(s) and the id tie-breaker needed to resume from the next row.
 *
 * Cursors are base64url-encoded JSON (no padding).  The client MUST treat
 * them as opaque — decoding is only for the server.
 */

const MAX_PAGE_SIZE = 500;
const DEFAULT_PAGE_SIZE = 100;

/** Keyset for a list sorted by (name ASC, id ASC) — used by clients. */
export interface NameKeyset {
  name: string;
  id: string;
}

/** Keyset for a list sorted by (updatedAt DESC, id DESC) — used by projects. */
export interface TimestampKeyset {
  updatedAt: number;
  id: string;
}

export type ListKeyset = NameKeyset | TimestampKeyset;

function encodeBase64url(raw: string): string {
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64url(encoded: string): string {
  // Restore standard base64 padding.
  let base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) base64 += "=";
  return atob(base64);
}

export function encodeCursor(keyset: ListKeyset): string {
  return encodeBase64url(JSON.stringify(keyset));
}

export function decodeCursor(cursor: string | null): {
  ok: true;
  keyset: ListKeyset;
} | {
  ok: false;
} {
  if (!cursor) return { ok: false };
  try {
    const raw = decodeBase64url(cursor);
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ok: false };
    }
    // Detect cursor shape.
    if (typeof parsed.name === "string" && typeof parsed.id === "string") {
      return { ok: true, keyset: { name: parsed.name, id: parsed.id } };
    }
    if (typeof parsed.updatedAt === "number" && typeof parsed.id === "string") {
      return { ok: true, keyset: { updatedAt: parsed.updatedAt, id: parsed.id } };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

export function parsePaginationParams(
  searchParams: URLSearchParams,
): { ok: true; cursor: string | null; limit: number } | { ok: false; error: string } {
  const cursor = searchParams.get("cursor");
  const rawLimit = searchParams.get("limit");

  let limit = DEFAULT_PAGE_SIZE;
  if (rawLimit !== null) {
    const parsed = Number(rawLimit);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_PAGE_SIZE) {
      return { ok: false, error: `Limit must be an integer between 1 and ${MAX_PAGE_SIZE}.` };
    }
    limit = parsed;
  }

  return { ok: true, cursor, limit };
}

export { MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE };
