import { createD1TaskRepository } from "../../adapters/d1/task-repository";
import { archiveScope } from "../archive-scope";
import type { D1Database } from "../../adapters/d1/d1-database";
import { defaultUserSettingsPreferences } from "../../lib/user-settings";
import type { AssistantProviderToolDefinition } from "../../ports/assistant-provider";
import { dashboardData } from "../dashboard-data";
import { normalizeSearchQuery, searchRecords } from "../search-records";
import { compact, type Evidence } from "./evidence";
import { projectEvidence } from "./project-evidence";
import { assembleToday, todayEvidence } from "./today";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type ToolResult = {
  evidence: Evidence[];
};

export type AssistantTool = {
  definition: AssistantProviderToolDefinition;
  execute(argumentsValue: unknown): Promise<ToolResult>;
};

type DriveSearchService = {
  search(input: { query: string; projectId: string }): Promise<Evidence[]>;
};

type AssistantToolRegistryOptions = {
  database: D1Database;
  isAdmin: boolean;
  // Environment scope for filed-email reads: simulation archives share the table
  // with live ones, so live answers must not adopt them (WS-18 review).
  simulation?: boolean;
  // The requesting office user's email. Evidence strings carrying EMPLOYEE emails
  // (lead owner, project manager, task assignee) apply the same office-identity
  // disclosure rule as the record routes: the actor's own email or a current office
  // identity renders; an offboarded identity renders as unavailable. Client contact
  // emails are office-visible client data and are not filtered (the conscious
  // distinction pinned by the EDIT-04 suite).
  actorEmail?: string;
  // Injected by the route (officeIdentityForEmail) so this platform-free application
  // module never imports cloudflare-coupled code. When actorEmail is provided the
  // filter is ACTIVE: a non-actor employee email renders only if the lookup confirms
  // a current office identity — absent lookup fails CLOSED to "unavailable".
  officeIdentityLookup?: (email: string) => { email: string } | null;
  timeZone?: string;
  now?: () => number;
  driveSearch?: DriveSearchService;
};

function objectValue(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function identifier(value: unknown) {
  return typeof value === "string" && IDENTIFIER_PATTERN.test(value)
    ? value
    : null;
}

function optionalIdentifier(value: unknown) {
  if (value === null) return null;
  return identifier(value) ?? undefined;
}

function optionalText(value: unknown, maximum: number) {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  if (/[\u0000-\u001f\u007f]/.test(value)) return undefined;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > maximum) {
    return undefined;
  }
  return normalized;
}

function optionalEmail(value: unknown) {
  const text = optionalText(value, 254);
  if (text === null || text === undefined) return text;
  const normalized = text.toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
    ? normalized
    : undefined;
}

function optionalDate(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : undefined;
}

function searchText(value: unknown) {
  if (typeof value !== "string") return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    return normalizeSearchQuery(value);
  } catch {
    return null;
  }
}

function escapedLike(value: string) {
  return `%${value.replace(/[\\%_]/g, "\\$&")}%`;
}

function nullableStringSchema(maxLength: number, pattern?: string) {
  return {
    anyOf: [
      {
        type: "string",
        maxLength,
        ...(pattern ? { pattern } : {}),
      },
      { type: "null" },
    ],
  };
}

function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  execute: (argumentsValue: unknown) => Promise<ToolResult>,
): AssistantTool {
  return {
    definition: {
      name,
      description,
      parameters: {
        type: "object",
        additionalProperties: false,
        properties,
        required,
      },
    },
    execute,
  };
}

function matchingExcerpt(value: string | null, query: string) {
  if (!value) return "";
  const index = value.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (index < 0) return "";
  const start = Math.max(0, index - 400);
  const end = Math.min(value.length, index + query.length + 400);
  return `${start > 0 ? "…" : ""}${compact(value.slice(start, end), 820)}${end < value.length ? "…" : ""}`;
}

export function createAssistantToolRegistry(
  options: AssistantToolRegistryOptions,
): AssistantTool[] {
  const { database, isAdmin, actorEmail, officeIdentityLookup } = options;
  const officeVisibleEmail = (candidate: string | null | undefined) => {
    const email = typeof candidate === "string" ? candidate.trim() : "";
    if (!email) return null;
    if (!actorEmail) return email;
    if (email.toLowerCase() === actorEmail.toLowerCase()) return email;
    return officeIdentityLookup?.(email)?.email ?? "unavailable (not a current office identity)";
  };
  const simulation = options.simulation === true;
  const now = options.now ?? Date.now;

  const searchRecordsTool = tool(
    "search_records",
    "Search saved projects, clients, and contacts by name, number, code, or email.",
    {
      query: { type: "string", minLength: 2, maxLength: 100 },
    },
    ["query"],
    async (argumentsValue) => {
      const input = objectValue(argumentsValue);
      const query = input && hasOnlyKeys(input, ["query"]) ? searchText(input.query) : null;
      if (!query) return { evidence: [] };
      const results = await searchRecords(database, query);
      return {
        evidence: results.slice(0, 20).map((item) => ({
          id: `${item.kind}:${item.id}`,
          label: `${item.kind === "project" ? "Project" : item.kind === "client" ? "Client" : "Contact"} · ${item.title}`,
          detail: item.subtitle,
        })),
      };
    },
  );

  const projectEvidenceTool = tool(
    "get_project_evidence",
    "Load the bounded saved evidence for one exact project id.",
    {
      projectId: { type: "string", maxLength: 128, pattern: "^[A-Za-z0-9_-]{1,128}$" },
    },
    ["projectId"],
    async (argumentsValue) => {
      const input = objectValue(argumentsValue);
      const projectId = input && hasOnlyKeys(input, ["projectId"])
        ? identifier(input.projectId)
        : null;
      if (!projectId) return { evidence: [] };
      const context = await projectEvidence(database, projectId, {
        includeFinancials: isAdmin,
        simulation,
      });
      return { evidence: context?.evidence ?? [] };
    },
  );

  const clientEvidenceTool = tool(
    "get_client_evidence",
    "Load one client, its contacts, and its bounded project list.",
    {
      clientId: { type: "string", maxLength: 128, pattern: "^[A-Za-z0-9_-]{1,128}$" },
    },
    ["clientId"],
    async (argumentsValue) => {
      const input = objectValue(argumentsValue);
      const clientId = input && hasOnlyKeys(input, ["clientId"])
        ? identifier(input.clientId)
        : null;
      if (!clientId) return { evidence: [] };
      const client = await database
        .prepare("SELECT id, client_code, name, status, industry FROM clients WHERE id = ?")
        .bind(clientId)
        .first<{ id: string; client_code: string; name: string; status: string; industry: string | null }>();
      if (!client) return { evidence: [] };
      const [contacts, projects] = await Promise.all([
        database
          .prepare("SELECT id, name, email, phone, role, is_primary FROM contacts WHERE client_id = ? ORDER BY is_primary DESC, created_at ASC LIMIT 8")
          .bind(clientId)
          .all<{ id: string; name: string; email: string | null; phone: string | null; role: string | null; is_primary: number }>(),
        database
          .prepare("SELECT id, project_number, name, status, site, project_manager, estimated_value FROM projects WHERE client_id = ? ORDER BY updated_at DESC LIMIT 10")
          .bind(clientId)
          .all<{ id: string; project_number: string; name: string; status: string; site: string | null; project_manager: string | null; estimated_value: number | null }>(),
      ]);
      const evidence: Evidence[] = [{
        id: `client:${client.id}`,
        label: `Client · ${client.name}`,
        detail: `${client.client_code} · ${client.status}${client.industry ? ` · ${client.industry}` : ""}`,
      }];
      evidence.push(...contacts.results.map((contact) => ({
        id: `contact:${contact.id}`,
        label: `Client contact · ${contact.name}`,
        detail: `${contact.is_primary ? "Primary contact · " : ""}${contact.role ?? "Contact"}${contact.email ? ` · ${contact.email}` : ""}${contact.phone ? ` · ${contact.phone}` : ""}`,
      })));
      evidence.push(...projects.results.map((project) => ({
        id: `project:${project.id}`,
        label: `Project · ${project.project_number} — ${project.name}`,
        detail: `${project.status}${project.site ? ` · ${project.site}` : ""}${project.project_manager ? ` · Project manager: ${officeVisibleEmail(project.project_manager)}` : ""}${isAdmin && project.estimated_value !== null ? ` · Estimated value: $${Number(project.estimated_value).toLocaleString()}` : ""}`,
      })));
      return { evidence: evidence.slice(0, 20) };
    },
  );

  const meetingSearchTool = tool(
    "search_meetings",
    "Search saved meeting titles, summaries, decisions, notes, and transcripts.",
    {
      query: { type: "string", minLength: 2, maxLength: 100 },
      projectId: nullableStringSchema(128, "^[A-Za-z0-9_-]{1,128}$"),
    },
    ["query", "projectId"],
    async (argumentsValue) => {
      const input = objectValue(argumentsValue);
      if (!input || !hasOnlyKeys(input, ["query", "projectId"])) return { evidence: [] };
      const query = searchText(input.query);
      const projectId = optionalIdentifier(input.projectId);
      if (!query || projectId === undefined) return { evidence: [] };
      const match = escapedLike(query);
      const projectClause = projectId ? " AND m.project_id = ?" : "";
      const rows = await database
        .prepare(`SELECT m.id, m.project_id, m.title, m.meeting_at, m.summary, m.decisions, m.notes, m.transcript, p.project_number FROM project_meetings m JOIN projects p ON p.id = m.project_id WHERE (m.title LIKE ? ESCAPE '\\' OR m.summary LIKE ? ESCAPE '\\' OR m.decisions LIKE ? ESCAPE '\\' OR m.notes LIKE ? ESCAPE '\\' OR m.transcript LIKE ? ESCAPE '\\')${projectClause} ORDER BY m.meeting_at DESC LIMIT 6`)
        .bind(match, match, match, match, match, ...(projectId ? [projectId] : []))
        .all<{ id: string; project_id: string; title: string; meeting_at: number; summary: string | null; decisions: string | null; notes: string | null; transcript: string | null; project_number: string }>();
      return {
        evidence: rows.results.slice(0, 6).map((row) => {
          const excerpts = [
            matchingExcerpt(row.title, query),
            matchingExcerpt(row.summary, query),
            matchingExcerpt(row.decisions, query),
            matchingExcerpt(row.notes, query),
            matchingExcerpt(row.transcript, query),
          ].filter(Boolean);
          return {
            id: `meeting:${row.id}`,
            label: `Meeting · ${compact(row.title, 120)}`,
            detail: `${row.project_number} · ${new Date(row.meeting_at).toLocaleString()} · ${excerpts.join(" · ")}`,
          };
        }),
      };
    },
  );

  const tasksTool = tool(
    "list_tasks",
    "List bounded saved tasks by optional status, assignee, due date, or project.",
    {
      status: {
        anyOf: [
          { type: "string", enum: ["open", "done"] },
          { type: "null" },
        ],
      },
      assigneeEmail: nullableStringSchema(254),
      dueBefore: nullableStringSchema(10, "^\\d{4}-\\d{2}-\\d{2}$"),
      projectId: nullableStringSchema(128, "^[A-Za-z0-9_-]{1,128}$"),
    },
    ["status", "assigneeEmail", "dueBefore", "projectId"],
    async (argumentsValue) => {
      const input = objectValue(argumentsValue);
      if (!input || !hasOnlyKeys(input, ["status", "assigneeEmail", "dueBefore", "projectId"])) {
        return { evidence: [] };
      }
      const status = input.status === null || input.status === "open" || input.status === "done"
        ? input.status
        : undefined;
      const assigneeEmail = optionalEmail(input.assigneeEmail);
      const dueBefore = optionalDate(input.dueBefore);
      const projectId = optionalIdentifier(input.projectId);
      if (
        status === undefined
        || assigneeEmail === undefined
        || dueBefore === undefined
        || projectId === undefined
      ) {
        return { evidence: [] };
      }
      const tasks = await createD1TaskRepository(database).list({
        ...(status ? { status } : {}),
        ...(assigneeEmail ? { assigneeEmail: assigneeEmail.toLowerCase() } : {}),
        ...(dueBefore ? { dueBefore } : {}),
        ...(projectId ? { projectId } : {}),
        limit: 20,
      });
      return {
        evidence: tasks.slice(0, 20).map((task) => ({
          id: `task:${task.id}`,
          label: `Task · ${compact(task.title, 160)}`,
          detail: `${task.status}${task.due_date ? ` · Due ${task.due_date}` : " · No due date"}${task.assignee_email ? ` · ${officeVisibleEmail(task.assignee_email)}` : " · Unassigned"}${task.project_id ? ` · Project ${task.project_id}` : ""}${task.lead_id ? ` · Lead ${task.lead_id}` : ""}${task.details ? ` · ${compact(task.details, 500)}` : ""}`,
        })),
      };
    },
  );

  const leadsTool = tool(
    "list_leads",
    "List active leads by optional stage or only those with stale next actions.",
    {
      stage: nullableStringSchema(80),
      staleOnly: {
        anyOf: [
          { type: "boolean" },
          { type: "null" },
        ],
      },
    },
    ["stage", "staleOnly"],
    async (argumentsValue) => {
      const input = objectValue(argumentsValue);
      if (!input || !hasOnlyKeys(input, ["stage", "staleOnly"])) return { evidence: [] };
      const stage = optionalText(input.stage, 80);
      const staleOnly = input.staleOnly === null ? false : input.staleOnly;
      if (stage === undefined || typeof staleOnly !== "boolean") return { evidence: [] };
      const conditions = ["LOWER(status) = 'active'"];
      const bindings: unknown[] = [];
      if (stage) {
        conditions.push("LOWER(stage) = LOWER(?)");
        bindings.push(stage);
      }
      if (staleOnly) {
        conditions.push("next_action_at IS NOT NULL AND next_action_at < ?");
        bindings.push(now());
      }
      const rows = await database
        .prepare(`SELECT id, lead_number, company, project_name, stage, site, estimated_value, next_action, next_action_at, owner_email, updated_at FROM leads WHERE ${conditions.join(" AND ")} ORDER BY COALESCE(next_action_at, 9223372036854775807), updated_at DESC LIMIT 20`)
        .bind(...bindings)
        .all<{ id: string; lead_number: string; company: string; project_name: string; stage: string; site: string; estimated_value: number; next_action: string; next_action_at: number | null; owner_email: string; updated_at: number }>();
      return {
        evidence: rows.results.slice(0, 20).map((lead) => ({
          id: `lead:${lead.id}`,
          label: `Lead · ${lead.lead_number} — ${lead.company}`,
          detail: `${lead.project_name} · ${lead.stage} · ${lead.site} · Next: ${lead.next_action}${lead.next_action_at ? ` (${new Date(lead.next_action_at).toLocaleString()})` : ""} · Owner: ${officeVisibleEmail(lead.owner_email)}${isAdmin ? ` · Estimated value: $${Number(lead.estimated_value).toLocaleString()}` : ""}`,
        })),
      };
    },
  );

  const filedEmailTool = tool(
    "filed_email_records",
    "List review-approved filed email metadata and artifact filenames; email bodies are not included.",
    {
      projectId: nullableStringSchema(128, "^[A-Za-z0-9_-]{1,128}$"),
      query: nullableStringSchema(100),
    },
    ["projectId", "query"],
    async (argumentsValue) => {
      const input = objectValue(argumentsValue);
      if (!input || !hasOnlyKeys(input, ["projectId", "query"])) return { evidence: [] };
      const projectId = optionalIdentifier(input.projectId);
      const query = optionalText(input.query, 100);
      if (
        projectId === undefined
        || query === undefined
        || (query !== null && query.length < 2)
      ) {
        return { evidence: [] };
      }
      // Project-keyed, not connection-keyed (WS-18) — but simulation archives
      // share this table, so the environment scope keeps pretend filings out of
      // live answers without narrowing reads to a single connection.
      const archives = archiveScope(simulation, "a.connection_key");
      const conditions = [
        "a.status = 'filed'",
        archives.clause,
      ];
      const bindings: unknown[] = [...archives.bindings];
      if (projectId) {
        conditions.push("a.project_id = ?");
        bindings.push(projectId);
      }
      if (query) {
        conditions.push("EXISTS (SELECT 1 FROM gmail_file_archive_artifacts searched WHERE searched.archive_id = a.id AND searched.original_filename LIKE ? ESCAPE '\\')");
        bindings.push(escapedLike(query));
      }
      const rows = await database
        .prepare(`SELECT a.id, a.project_id, a.attachment_count, a.filed_at, a.email_drive_url, GROUP_CONCAT(f.original_filename, ' | ') AS filenames FROM gmail_file_archives a LEFT JOIN gmail_file_archive_artifacts f ON f.archive_id = a.id WHERE ${conditions.join(" AND ")} GROUP BY a.id, a.project_id, a.attachment_count, a.filed_at, a.email_drive_url ORDER BY a.filed_at DESC LIMIT 10`)
        .bind(...bindings)
        .all<{ id: string; project_id: string; attachment_count: number; filed_at: number | null; email_drive_url: string | null; filenames: string | null }>();
      return {
        evidence: rows.results.slice(0, 10).map((archive) => ({
          id: `email:${archive.id}`,
          label: "Filed email archive",
          detail: `Project ${archive.project_id} · ${archive.attachment_count} attachment${archive.attachment_count === 1 ? "" : "s"}${archive.filed_at ? ` · Filed ${new Date(archive.filed_at).toLocaleString()}` : ""}${archive.filenames ? ` · Files: ${compact(archive.filenames, 700)}` : ""}${archive.email_drive_url ? ` · ${archive.email_drive_url}` : ""}`,
        })),
      };
    },
  );

  const dashboardMetricsTool = tool(
    "dashboard_metrics",
    "Load current saved dashboard counts; financial pipeline value is admin-only.",
    {},
    [],
    async (argumentsValue) => {
      const input = objectValue(argumentsValue);
      if (!input || !hasOnlyKeys(input, [])) return { evidence: [] };
      // Same environment scope as every other filed-email read here: without it
      // a simulated session reports the LIVE filed-email count, which is the
      // isolation failure inverted rather than fixed.
      const dashboard = await dashboardData(database, { simulation });
      const evidence: Evidence[] = [
        { id: "metric:active-leads", label: "Dashboard metric · Active leads", detail: String(dashboard.metrics.activeLeads) },
        { id: "metric:active-projects", label: "Dashboard metric · Active projects", detail: String(dashboard.metrics.activeProjects) },
        { id: "metric:clients", label: "Dashboard metric · Clients", detail: String(dashboard.metrics.clientCount) },
        { id: "metric:meetings", label: "Dashboard metric · Meetings", detail: String(dashboard.metrics.meetingCount) },
        { id: "metric:filed-emails", label: "Dashboard metric · Filed emails", detail: String(dashboard.metrics.filedEmailCount) },
      ];
      if (isAdmin) {
        evidence.push({
          id: "metric:estimated-pipeline-value",
          label: "Dashboard metric · Estimated pipeline value",
          detail: `$${Number(dashboard.metrics.estimatedPipelineValue).toLocaleString()}`,
        });
      }
      return { evidence: evidence.slice(0, 8) };
    },
  );

  const todayTool = tool(
    "today",
    "Load the bounded deterministic Today assembly in the signed-in user's display timezone.",
    {},
    [],
    async (argumentsValue) => {
      const input = objectValue(argumentsValue);
      if (!input || !hasOnlyKeys(input, [])) return { evidence: [] };
      return {
        evidence: todayEvidence(await assembleToday(database, {
          now: now(),
          timeZone: options.timeZone ?? defaultUserSettingsPreferences().displayTimezone,
        })),
      };
    },
  );

  const tools = [
    searchRecordsTool,
    projectEvidenceTool,
    clientEvidenceTool,
    meetingSearchTool,
    tasksTool,
    leadsTool,
    filedEmailTool,
    dashboardMetricsTool,
    todayTool,
  ];

  if (options.driveSearch) {
    tools.push(tool(
      "drive_search",
      "Search Drive full text inside one provisioned project folder.",
      {
        query: { type: "string", minLength: 2, maxLength: 100 },
        projectId: { type: "string", maxLength: 128, pattern: "^[A-Za-z0-9_-]{1,128}$" },
      },
      ["query", "projectId"],
      async (argumentsValue) => {
        const input = objectValue(argumentsValue);
        const query = input && hasOnlyKeys(input, ["query", "projectId"])
          ? searchText(input.query)
          : null;
        const projectId = input ? identifier(input.projectId) : null;
        if (!query || !projectId) return { evidence: [] };
        return {
          evidence: (await options.driveSearch!.search({ query, projectId })).slice(0, 10),
        };
      },
    ));
  }

  return tools;
}
