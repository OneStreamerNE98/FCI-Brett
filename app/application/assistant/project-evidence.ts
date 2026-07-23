import type { D1Database } from "../../adapters/d1/d1-database";
import {
  compact,
  parseStringArray,
  type ContactRecord,
  type Evidence,
  type MeetingRecord,
  type ProjectRecord,
} from "./evidence";

export async function projectEvidence(
  database: D1Database,
  connectionKey: string,
  projectId: string,
  options: { includeFinancials: boolean } = { includeFinancials: true },
) {
  const project = await database.prepare("SELECT p.id, p.project_number, p.name, p.status, p.site, p.project_manager, p.estimated_value, c.id AS client_id, c.name AS client_name, c.client_code FROM projects p JOIN clients c ON c.id = p.client_id WHERE p.id = ?").bind(projectId).first<ProjectRecord>();
  if (!project) return null;
  const [contacts, archives, events, meetings, contactCount, archiveCount, meetingCount] = await Promise.all([
    database.prepare("SELECT id, name, email, role, is_primary FROM contacts WHERE client_id = ? ORDER BY is_primary DESC, created_at ASC LIMIT 8").bind(project.client_id).all<ContactRecord>(),
    database.prepare("SELECT id, attachment_count, filed_at FROM gmail_file_archives WHERE connection_key = ? AND project_id = ? AND status = 'filed' ORDER BY filed_at DESC LIMIT 6").bind(connectionKey, projectId).all<{ id: string; attachment_count: number; filed_at: number | null }>(),
    database.prepare("SELECT id, action, detail, created_at FROM activity_events WHERE record_id = ? ORDER BY created_at DESC LIMIT 6").bind(projectId).all<{ id: string; action: string; detail: string | null; created_at: number }>(),
    database.prepare("SELECT id, title, meeting_at, source_provider, source_url, summary, decisions, notes, transcript, action_items_json FROM project_meetings WHERE project_id = ? ORDER BY meeting_at DESC LIMIT 6").bind(projectId).all<MeetingRecord>(),
    database.prepare("SELECT COUNT(*) AS total FROM contacts WHERE client_id = ?").bind(project.client_id).first<{ total: number }>(),
    database.prepare("SELECT COUNT(*) AS total FROM gmail_file_archives WHERE connection_key = ? AND project_id = ? AND status = 'filed'").bind(connectionKey, projectId).first<{ total: number }>(),
    database.prepare("SELECT COUNT(*) AS total FROM project_meetings WHERE project_id = ?").bind(projectId).first<{ total: number }>(),
  ]);
  const totals = {
    contacts: Number(contactCount?.total ?? 0),
    archives: Number(archiveCount?.total ?? 0),
    meetings: Number(meetingCount?.total ?? 0),
  };
  const financialDetail = options.includeFinancials && project.estimated_value !== null
    ? ` · Estimated value: $${Number(project.estimated_value).toLocaleString()}`
    : "";
  const projectItems: Evidence[] = [{
      id: `project:${project.id}`,
      label: `Project record · ${project.project_number}`,
      detail: `${project.name} · ${project.client_name} · ${project.status}${project.site ? ` · ${project.site}` : ""}${project.project_manager ? ` · Project manager: ${project.project_manager}` : ""}${financialDetail}`,
    }, {
      id: `summary:${project.id}`,
      label: `Available project evidence · ${project.project_number}`,
      detail: `${totals.contacts} client contact${totals.contacts === 1 ? "" : "s"} · ${totals.archives} filed email archive${totals.archives === 1 ? "" : "s"} in the active Google Workspace connection · ${totals.meetings} meeting record${totals.meetings === 1 ? "" : "s"}`,
    }];
  const contactItems: Evidence[] = contacts.results.slice(0, 4).map((contact) => ({
      id: `contact:${contact.id}`,
      label: `Client contact · ${contact.name}`,
      detail: `${contact.is_primary ? "Primary contact · " : ""}${contact.role ?? "Contact"}${contact.email ? ` · ${contact.email}` : ""}`,
    }));
  const meetingItems: Evidence[] = meetings.results.slice(0, 5).map((meeting) => {
      const actions = parseStringArray(meeting.action_items_json, 8);
      const facts = [
        new Date(meeting.meeting_at).toLocaleString(),
        `Source: ${meeting.source_provider}${meeting.source_url ? ` · ${meeting.source_url}` : ""}`,
        meeting.summary ? `Summary: ${compact(meeting.summary, 900)}` : "",
        meeting.decisions ? `Decisions: ${compact(meeting.decisions, 700)}` : "",
        actions.length ? `Action items: ${actions.map((item) => compact(item, 180)).join("; ")}` : "",
        meeting.notes ? `Notes: ${compact(meeting.notes, 700)}` : "",
        meeting.transcript ? `Transcript excerpt: ${compact(meeting.transcript, 900)}` : "",
      ].filter(Boolean);
      return {
        id: `meeting:${meeting.id}`,
        label: `Meeting · ${compact(meeting.title, 120)}`,
        detail: facts.join(" · "),
      };
    });
  const archiveItems: Evidence[] = archives.results.slice(0, 2).map((archive) => ({
      id: `email:${archive.id}`,
      label: "Filed email archive",
      detail: `${archive.attachment_count} attachment${archive.attachment_count === 1 ? "" : "s"}${archive.filed_at ? ` · filed ${new Date(archive.filed_at).toLocaleDateString()}` : ""}`,
    }));
  const eventItems: Evidence[] = events.results.slice(0, 3).map((event) => ({
      id: `activity:${event.id}`,
      label: `Activity · ${compact(event.action, 90) || "Project update"}`,
      detail: compact(event.detail, 280) || new Date(event.created_at).toLocaleString(),
    }));
  const evidence = [
    ...projectItems,
    ...contactItems,
    ...meetingItems,
    ...archiveItems,
    ...eventItems,
  ];
  const firstContact = contacts.results[0];
  const primaryContact = firstContact?.is_primary ? firstContact : null;
  return {
    project,
    evidence,
    totals,
    primaryContact,
    meetings: meetings.results,
  };
}
