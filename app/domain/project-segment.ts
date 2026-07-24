export const PROJECT_SEGMENTS = ["commercial", "residential"] as const;

export type ProjectSegment = typeof PROJECT_SEGMENTS[number];

export function normalizeProjectSegment(value: unknown): ProjectSegment | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return (PROJECT_SEGMENTS as readonly string[]).includes(normalized)
    ? normalized as ProjectSegment
    : null;
}

export function projectSegmentFromClientIndustry(industry: unknown): ProjectSegment {
  return typeof industry === "string" && industry.trim().toLowerCase() === "residential"
    ? "residential"
    : "commercial";
}

/**
 * Older D1 rows have no stored segment. A valid stored choice wins; otherwise
 * the client's industry supplies the two-value default without inventing a
 * third or nullable reporting bucket.
 */
export function resolveProjectSegment(storedSegment: unknown, clientIndustry?: unknown): ProjectSegment {
  return normalizeProjectSegment(storedSegment) ?? projectSegmentFromClientIndustry(clientIndustry);
}
