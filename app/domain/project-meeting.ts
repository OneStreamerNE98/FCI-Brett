export const PROJECT_MEETING_TYPES = [
  "client",
  "site-walk",
  "internal",
  "pre-install",
  "closeout",
  "phone-call",
  "other",
] as const;

export const PROJECT_MEETING_SOURCE_PROVIDERS = ["manual", "otter", "link"] as const;

export type ProjectMeetingType = typeof PROJECT_MEETING_TYPES[number];
export type ProjectMeetingSourceProvider = typeof PROJECT_MEETING_SOURCE_PROVIDERS[number];

export type ProjectMeetingRow = {
  id: string;
  project_id: string;
  title: string;
  meeting_at: number;
  meeting_type: string;
  source_provider: string;
  source_url: string | null;
  attendees_json: string;
  notes: string | null;
  transcript: string | null;
  summary: string | null;
  decisions: string | null;
  action_items_json: string;
  created_by: string;
  created_at: number;
  updated_at: number;
};

export type NormalizedProjectMeeting = {
  title: string;
  meetingAt: number;
  meetingType: ProjectMeetingType;
  sourceProvider: ProjectMeetingSourceProvider;
  sourceUrl: string | null;
  attendees: string[];
  notes: string | null;
  transcript: string | null;
  summary: string | null;
  decisions: string | null;
  actionItems: string[];
};

export type ProjectMeetingValidation =
  | { ok: true; value: NormalizedProjectMeeting }
  | { ok: false; message: string };

const MEETING_TYPE_SET = new Set<string>(PROJECT_MEETING_TYPES);

export function parseProjectMeetingStringList(value: unknown, maximumItems: number) {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\n,]/)
      : [];
  return [...new Set(source
    .map((item) => typeof item === "string"
      ? item.replace(/\s+/g, " ").trim().slice(0, 160)
      : "")
    .filter(Boolean))]
    .slice(0, maximumItems);
}

export function optionalProjectMeetingText(value: unknown, maximum: number) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\r\n/g, "\n").trim();
  if (!cleaned) return null;
  if (
    cleaned.length > maximum
    || /[\u0000\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(cleaned)
  ) {
    return undefined;
  }
  return cleaned;
}

export function parseProjectMeetingSourceUrl(value: unknown): {
  value: string | null;
  provider: ProjectMeetingSourceProvider;
} | null {
  if (value === undefined || value === null || value === "") {
    return { value: null, provider: "manual" };
  }
  if (typeof value !== "string" || value.length > 900) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    const hostname = parsed.hostname.toLowerCase();
    const provider = hostname === "otter.ai" || hostname.endsWith(".otter.ai")
      ? "otter"
      : "link";
    return { value: parsed.toString(), provider };
  } catch {
    return null;
  }
}

function parseJsonList(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function normalizeProjectMeeting(body: Record<string, unknown>): ProjectMeetingValidation {
  const title = optionalProjectMeetingText(body.title, 160);
  const notes = optionalProjectMeetingText(body.notes, 25_000);
  const transcript = optionalProjectMeetingText(body.transcript, 100_000);
  const summary = optionalProjectMeetingText(body.summary, 12_000);
  const decisions = optionalProjectMeetingText(body.decisions, 12_000);
  if (!title) {
    return {
      ok: false,
      message: "Meeting title is required and must be 160 characters or fewer.",
    };
  }
  if ([notes, transcript, summary, decisions].includes(undefined)) {
    return {
      ok: false,
      message: "One or more meeting fields are too long or contain invalid characters.",
    };
  }

  const meetingAt = typeof body.meetingAt === "string"
    ? Date.parse(body.meetingAt)
    : Number.NaN;
  if (!Number.isFinite(meetingAt)) {
    return { ok: false, message: "Meeting date and time are required." };
  }
  const meetingType = typeof body.meetingType === "string"
    && MEETING_TYPE_SET.has(body.meetingType)
    ? body.meetingType as ProjectMeetingType
    : "other";
  const source = parseProjectMeetingSourceUrl(body.sourceUrl);
  if (!source) {
    return {
      ok: false,
      message: "Meeting source must be a valid HTTPS Otter or reference link.",
    };
  }
  const attendees = parseProjectMeetingStringList(body.attendees, 40);
  const actionItems = parseProjectMeetingStringList(body.actionItems, 50);
  if (
    !source.value
    && !notes
    && !transcript
    && !summary
    && !decisions
    && actionItems.length === 0
  ) {
    return {
      ok: false,
      message: "Add an Otter link, notes, summary, transcript, decision, or action item.",
    };
  }

  return {
    ok: true,
    value: {
      title,
      meetingAt,
      meetingType,
      sourceProvider: source.provider,
      sourceUrl: source.value,
      attendees,
      notes: notes ?? null,
      transcript: transcript ?? null,
      summary: summary ?? null,
      decisions: decisions ?? null,
      actionItems,
    },
  };
}

export function projectMeetingResponse(row: ProjectMeetingRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    meetingAt: new Date(row.meeting_at).toISOString(),
    meetingType: row.meeting_type,
    sourceProvider: row.source_provider,
    sourceUrl: row.source_url,
    attendees: parseJsonList(row.attendees_json),
    notes: row.notes,
    transcript: row.transcript,
    summary: row.summary,
    decisions: row.decisions,
    actionItems: parseJsonList(row.action_items_json),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
