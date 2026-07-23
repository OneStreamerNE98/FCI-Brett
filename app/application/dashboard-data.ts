import type { D1Database } from "../adapters/d1/d1-database";

type CountRow = { total: number | string | null };
type PipelineRow = {
  active_leads: number | string | null;
  estimated_pipeline_value: number | string | null;
};
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

export async function dashboardData(database: D1Database, connectionKey: string) {
  const [
    pipeline,
    activeProjects,
    projectStatuses,
    clients,
    activities,
    meetings,
    filedEmails,
  ] = await Promise.all([
    database.prepare("SELECT COUNT(*) AS active_leads, COALESCE(SUM(estimated_value), 0) AS estimated_pipeline_value FROM leads WHERE LOWER(status) = 'active'").first<PipelineRow>(),
    database.prepare("SELECT COUNT(*) AS total FROM projects WHERE LOWER(status) NOT IN ('archived', 'completed', 'cancelled')").first<CountRow>(),
    database.prepare("SELECT LOWER(status) AS status, COUNT(*) AS total FROM projects GROUP BY LOWER(status) ORDER BY total DESC, status ASC").all<ProjectStatusRow>(),
    database.prepare("SELECT COUNT(*) AS total FROM clients").first<CountRow>(),
    database.prepare("SELECT e.id, e.record_id, e.action, e.actor, e.detail, e.created_at, p.project_number, p.name AS project_name, c.name AS client_name FROM activity_events e LEFT JOIN projects p ON p.id = e.record_id LEFT JOIN clients c ON c.id = p.client_id ORDER BY e.created_at DESC LIMIT 12").all<ActivityRow>(),
    database.prepare("SELECT COUNT(*) AS total FROM project_meetings").first<CountRow>(),
    database.prepare("SELECT COUNT(*) AS total FROM gmail_file_archives WHERE connection_key = ? AND status = 'filed'").bind(connectionKey).first<CountRow>(),
  ]);

  return {
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
  };
}
