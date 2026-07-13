import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { requireOfficeUser } from "../../../lib/workspace-auth";
import { getGoogleRuntimeConfig } from "../../../lib/google-oauth";
import { ensureWorkspaceSchema } from "../_workspace-data";

type CountRow = { total: number | string | null };
type PipelineRow = { active_leads: number | string | null; estimated_pipeline_value: number | string | null };
type ProjectStatusRow = { status: string; total: number | string };
type ActivityRow = {
  id: string;
  record_id: string;
  action: string;
  actor: string;
  detail: string | null;
  created_at: number;
  project_number: string | null;
  project_name: string | null;
  client_name: string | null;
};

function numeric(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Live, persisted dashboard totals. This endpoint never substitutes demo values. */
export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;

  await ensureWorkspaceSchema();
  const google = getGoogleRuntimeConfig();

  const [pipeline, activeProjects, projectStatuses, clients, activities, meetings, filedEmails] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS active_leads, COALESCE(SUM(estimated_value), 0) AS estimated_pipeline_value FROM leads WHERE LOWER(status) = 'active'").first<PipelineRow>(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM projects WHERE LOWER(status) NOT IN ('archived', 'completed', 'cancelled')").first<CountRow>(),
    env.DB.prepare("SELECT LOWER(status) AS status, COUNT(*) AS total FROM projects GROUP BY LOWER(status) ORDER BY total DESC, status ASC").all<ProjectStatusRow>(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM clients").first<CountRow>(),
    env.DB.prepare("SELECT e.id, e.record_id, e.action, e.actor, e.detail, e.created_at, p.project_number, p.name AS project_name, c.name AS client_name FROM activity_events e LEFT JOIN projects p ON p.id = e.record_id LEFT JOIN clients c ON c.id = p.client_id ORDER BY e.created_at DESC LIMIT 12").all<ActivityRow>(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM project_meetings").first<CountRow>(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM gmail_file_archives WHERE connection_key = ? AND status = 'filed'").bind(google.connectionKey).first<CountRow>(),
  ]);

  return NextResponse.json({
    generatedAt: Date.now(),
    metrics: {
      activeLeads: numeric(pipeline?.active_leads),
      estimatedPipelineValue: numeric(pipeline?.estimated_pipeline_value),
      activeProjects: numeric(activeProjects?.total),
      clientCount: numeric(clients?.total),
      meetingCount: numeric(meetings?.total),
      filedEmailCount: numeric(filedEmails?.total),
    },
    projectsByStatus: projectStatuses.results.map((row) => ({
      status: row.status,
      count: numeric(row.total),
    })),
    recentActivity: activities.results,
    readiness: {
      scheduleDataAvailable: false,
      scheduleReason: "Worker, crew, shift, and assignment source records have not been implemented yet.",
      reportsUseLiveProjectLeadTotals: true,
    },
  });
}
