export type Evidence = {
  id: string;
  label: string;
  detail: string;
};

export type AssistantResponse = {
  mode: "ai-grounded" | "records-only";
  answer: string;
  citations: Evidence[];
  missingEvidence: string;
};

export type ProjectRecord = {
  id: string;
  project_number: string;
  name: string;
  status: string;
  site: string | null;
  project_manager: string | null;
  estimated_value: number | null;
  client_id: string;
  client_name: string;
  client_code: string;
};

export type ContactRecord = {
  id: string;
  name: string;
  email: string | null;
  role: string | null;
  is_primary: number;
};

export type MeetingRecord = {
  id: string;
  title: string;
  meeting_at: number;
  source_provider: string;
  source_url: string | null;
  summary: string | null;
  decisions: string | null;
  notes: string | null;
  transcript: string | null;
  action_items_json: string;
};

export type EvidenceTotals = {
  contacts: number;
  archives: number;
  meetings: number;
};

export const GROUNDED_PROJECT_ANSWER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    answer: { type: "string" },
    citationIds: { type: "array", items: { type: "string" }, maxItems: 8 },
    missingEvidence: { type: "string" },
  },
  required: ["answer", "citationIds", "missingEvidence"],
} as const;

export function compact(value: unknown, maximum: number) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maximum)
    : "";
}

export function parseStringArray(value: string, maximum: number) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string").slice(0, maximum)
      : [];
  } catch {
    return [];
  }
}

export function matchingEvidence(evidence: Evidence[], preferredIds: string[]) {
  const allowed = new Map(evidence.map((item) => [item.id, item]));
  const selected = [...new Set(preferredIds)]
    .map((id) => allowed.get(id))
    .filter((item): item is Evidence => Boolean(item));
  return selected.length > 0 ? selected.slice(0, 8) : evidence.slice(0, 2);
}

export function parseGroundedOutput(
  value: unknown,
  allowed: ReadonlyMap<string, Evidence>,
) {
  if (typeof value !== "object" || !value || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const answer = compact(input.answer, 4_000);
  const missingEvidence = compact(input.missingEvidence, 800);
  const requested = Array.isArray(input.citationIds)
    ? input.citationIds
        .filter((id): id is string => typeof id === "string")
        .slice(0, 8)
    : [];
  const unique = [...new Set(requested)].filter((id) => allowed.has(id));
  if (!answer || unique.length === 0) return null;
  return {
    answer,
    citations: unique.map((id) => allowed.get(id)!),
    missingEvidence: missingEvidence || "The available records may be incomplete.",
  };
}
