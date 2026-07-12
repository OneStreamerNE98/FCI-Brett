import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { ensureWorkspaceSchema } from "../../../_workspace-data";
import { requireOfficeUser, requireSameOrigin } from "../../../../../lib/workspace-auth";

type RouteContext = { params: Promise<{ projectId: string }> };
type MeetingRow = {
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

const MEETING_TYPES = new Set(["client", "site-walk", "internal", "pre-install", "closeout", "other"]);

function parseStringList(value: unknown, maximumItems: number) {
  const source = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\n,]/) : [];
  return [...new Set(source.map((item) => typeof item === "string" ? item.replace(/\s+/g, " ").trim().slice(0, 160) : "").filter(Boolean))].slice(0, maximumItems);
}

function optionalText(value: unknown, maximum: number) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\r\n/g, "\n").trim();
  if (!cleaned) return null;
  if (cleaned.length > maximum || /[\u0000\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(cleaned)) return undefined;
  return cleaned;
}

function parseSourceUrl(value: unknown) {
  if (value === undefined || value === null || value === "") return { value: null, provider: "manual" };
  if (typeof value !== "string" || value.length > 900) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    const hostname = parsed.hostname.toLowerCase();
    const provider = hostname === "otter.ai" || hostname.endsWith(".otter.ai") ? "otter" : "link";
    return { value: parsed.toString(), provider };
  } catch {
    return null;
  }
}

function parseJsonList(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function responseMeeting(row: MeetingRow) {
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

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  const { projectId } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(projectId)) return NextResponse.json({ error: "Invalid project." }, { status: 400 });
  await ensureWorkspaceSchema();
  const project = await env.DB.prepare("SELECT id FROM projects WHERE id = ?").bind(projectId).first();
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  const meetings = await env.DB.prepare("SELECT * FROM project_meetings WHERE project_id = ? ORDER BY meeting_at DESC, created_at DESC LIMIT 100").bind(projectId).all<MeetingRow>();
  return NextResponse.json({ meetings: meetings.results.map(responseMeeting) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  const { projectId } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(projectId)) return NextResponse.json({ error: "Invalid project." }, { status: 400 });

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > 180_000) return NextResponse.json({ error: "Meeting notes are too large." }, { status: 413 });
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > 180_000) return NextResponse.json({ error: "Meeting notes are too large." }, { status: 413 });
  const body = (() => { try { return JSON.parse(rawBody) as Record<string, unknown>; } catch { return null; } })();
  if (!body) return NextResponse.json({ error: "Meeting details must be valid JSON." }, { status: 400 });

  const title = optionalText(body.title, 160);
  const notes = optionalText(body.notes, 25_000);
  const transcript = optionalText(body.transcript, 100_000);
  const summary = optionalText(body.summary, 12_000);
  const decisions = optionalText(body.decisions, 12_000);
  if (!title) return NextResponse.json({ error: "Meeting title is required and must be 160 characters or fewer." }, { status: 400 });
  if ([notes, transcript, summary, decisions].includes(undefined)) return NextResponse.json({ error: "One or more meeting fields are too long or contain invalid characters." }, { status: 400 });

  const meetingAt = typeof body.meetingAt === "string" ? Date.parse(body.meetingAt) : Number.NaN;
  if (!Number.isFinite(meetingAt)) return NextResponse.json({ error: "Meeting date and time are required." }, { status: 400 });
  const meetingType = typeof body.meetingType === "string" && MEETING_TYPES.has(body.meetingType) ? body.meetingType : "other";
  const source = parseSourceUrl(body.sourceUrl);
  if (!source) return NextResponse.json({ error: "Meeting source must be a valid HTTPS Otter or reference link." }, { status: 400 });
  const attendees = parseStringList(body.attendees, 40);
  const actionItems = parseStringList(body.actionItems, 50);
  if (!source.value && !notes && !transcript && !summary && !decisions && actionItems.length === 0) {
    return NextResponse.json({ error: "Add an Otter link, notes, summary, transcript, decision, or action item." }, { status: 400 });
  }

  await ensureWorkspaceSchema();
  const project = await env.DB.prepare("SELECT id, project_number FROM projects WHERE id = ?").bind(projectId).first<{ id: string; project_number: string }>();
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO project_meetings (id, project_id, title, meeting_at, meeting_type, source_provider, source_url, attendees_json, notes, transcript, summary, decisions, action_items_json, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, projectId, title, meetingAt, meetingType, source.provider, source.value, JSON.stringify(attendees), notes, transcript, summary, decisions, JSON.stringify(actionItems), auth.user.email, now, now),
    env.DB.prepare("INSERT INTO activity_events (id, record_id, action, actor, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), projectId, "Meeting notes captured", auth.user.email, `${title} · ${source.provider === "otter" ? "Otter" : source.provider === "link" ? "Linked source" : "Manual notes"}`, now),
  ]);
  const created = await env.DB.prepare("SELECT * FROM project_meetings WHERE id = ?").bind(id).first<MeetingRow>();
  return NextResponse.json({ meeting: responseMeeting(created!) }, { status: 201 });
}
