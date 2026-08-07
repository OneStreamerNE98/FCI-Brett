"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Check, ExternalLink, MessageSquareText, Plus, RefreshCw, ShieldCheck, Users, X } from "lucide-react";
import { AccessibleOverlay } from "../../components/AccessibleOverlay";
import { ClientDataNotice } from "../../components/ClientDataNotice";
import { OperationsEmptyState } from "../../components/operations/OperationsPrimitives";
import {
  cachedGetJson,
  invalidateCachedGet,
  isTerminalCachedGetError,
} from "../../lib/client-get-cache";
import { useCachedGetSubscription } from "../../lib/client-get-hooks";
import type { Notify, Project, ProjectMeeting } from "../../lib/record-types";

function meetingDateInputValue() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function formatMeetingDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function compareProjectMeetingsDescending(left: ProjectMeeting, right: ProjectMeeting) {
  const leftMeetingAt = Date.parse(left.meetingAt);
  const rightMeetingAt = Date.parse(right.meetingAt);
  const leftSortValue = Number.isNaN(leftMeetingAt) ? Number.NEGATIVE_INFINITY : leftMeetingAt;
  const rightSortValue = Number.isNaN(rightMeetingAt) ? Number.NEGATIVE_INFINITY : rightMeetingAt;
  if (leftSortValue !== rightSortValue) return rightSortValue - leftSortValue;
  return right.createdAt - left.createdAt;
}

async function fetchProjectMeetings(projectId: string, force = false) {
  const data = await cachedGetJson<{ meetings?: ProjectMeeting[] }>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/meetings`,
    { force },
  );
  return data.meetings ?? [];
}

export function ProjectMeetings({ project, notify, onMeetingRecorded }: { project: Project; notify: Notify; onMeetingRecorded: () => void }) {
  const [meetings, setMeetings] = useState<ProjectMeeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);

  const meetingsUrl = `/api/v1/projects/${encodeURIComponent(project.id)}/meetings`;
  const loadMeetings = useCallback(async (silent = false, force = false) => {
    if (!silent) setLoading(true);
    if (!silent) setError("");
    try {
      setMeetings(await fetchProjectMeetings(project.id, force));
    } catch (loadError) {
      if (isTerminalCachedGetError(loadError)) setMeetings([]);
      if (!silent || isTerminalCachedGetError(loadError)) {
        setError(loadError instanceof Error ? loadError.message : "Meeting notes could not be loaded.");
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [project.id]);

  useCachedGetSubscription([meetingsUrl], () => loadMeetings(true));

  useEffect(() => {
    let active = true;
    fetchProjectMeetings(project.id).then((items) => {
      if (!active) return;
      setMeetings(items);
      setLoading(false);
    }).catch((loadError) => {
      if (!active) return;
      setError(loadError instanceof Error ? loadError.message : "Meeting notes could not be loaded.");
      setLoading(false);
    });
    return () => { active = false; };
  }, [project.id]);

  function savedMeeting(meeting: ProjectMeeting) {
    setMeetings((current) => [
      meeting,
      ...current.filter((currentMeeting) => currentMeeting.id !== meeting.id),
    ].sort(compareProjectMeetingsDescending));
    setAdding(false);
    onMeetingRecorded();
    notify(`${meeting.title} saved to ${project.number}`, "success");
  }

  return <section className="project-meetings">
    <header className="meeting-section-header"><div><p className="eyebrow">Project knowledge</p><h3>Meeting notes</h3><span>Link Otter, paste its summary or transcript, and keep decisions with this independent project.</span></div><button className="primary-button" onClick={() => setAdding(true)}><Plus size={15} /> Add meeting</button></header>
    <div className="meeting-capture-guide"><MessageSquareText size={18} /><div><strong>Recommended Otter workflow</strong><span>Copy the private Otter conversation link, paste the Summary and Action Items, then add the exported transcript when the record needs full searchable detail.</span></div></div>
    {loading ? <OperationsEmptyState variant="meeting"><RefreshCw size={21} /><strong>Loading project meetings…</strong></OperationsEmptyState> : error ? <ClientDataNotice state="error" error={error} errorTitle="Project meetings are unavailable" retryLabel="Try again" titleLevel={4} onRetry={() => void loadMeetings(false, true)} /> : meetings.length === 0 ? <OperationsEmptyState variant="meeting" action={<button className="soft-button" onClick={() => setAdding(true)}><Plus size={14} /> Capture the first meeting</button>}><MessageSquareText size={24} /><strong>No meeting notes yet</strong><span>Add a client meeting, site walk, internal huddle, pre-install meeting, or closeout review.</span></OperationsEmptyState> : <div className="meeting-list">{meetings.map((meeting) => <article className="meeting-card" key={meeting.id}>
      <header><div className="meeting-icon"><MessageSquareText size={17} /></div><div><div className="meeting-badges"><span>{meeting.meetingType.replaceAll("-", " ")}</span><b className={meeting.sourceProvider}>{meeting.sourceProvider === "otter" ? "Otter" : meeting.sourceProvider === "link" ? "Linked" : "Manual"}</b></div><h4>{meeting.title}</h4><small>{formatMeetingDate(meeting.meetingAt)} · Saved by {meeting.createdBy}</small></div>{meeting.sourceUrl && <a className="meeting-source-link" href={meeting.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open source</a>}</header>
      {meeting.attendees.length > 0 && <p className="meeting-attendees"><Users size={14} /><span>{meeting.attendees.join(" · ")}</span></p>}
      {meeting.summary && <div className="meeting-summary"><strong>Summary</strong><p>{meeting.summary}</p></div>}
      {meeting.decisions && <div className="meeting-decisions"><strong>Decisions</strong><p>{meeting.decisions}</p></div>}
      {meeting.actionItems.length > 0 && <div className="meeting-actions"><strong>Action items</strong><ul>{meeting.actionItems.map((item, index) => <li key={`${meeting.id}-${index}`}><Check size={13} />{item}</li>)}</ul></div>}
      {(meeting.notes || meeting.transcript) && <details><summary>View {meeting.transcript ? "notes and transcript" : "full notes"}</summary>{meeting.notes && <div><strong>Notes</strong><p>{meeting.notes}</p></div>}{meeting.transcript && <div><strong>Transcript</strong><pre>{meeting.transcript}</pre></div>}</details>}
    </article>)}</div>}
    {adding && <MeetingModal project={project} onClose={() => setAdding(false)} onSaved={savedMeeting} />}
  </section>;
}

export function MeetingModal({ project, onClose, onSaved }: { project: Project; onClose: () => void; onSaved: (meeting: ProjectMeeting) => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const meetingAtInput = String(form.get("meetingAt") ?? "");
    const meetingAtDate = new Date(meetingAtInput);
    if (Number.isNaN(meetingAtDate.getTime())) {
      setError("Choose a valid meeting date and time.");
      setSaving(false);
      return;
    }
    const payload = {
      title: String(form.get("title") ?? ""),
      meetingAt: meetingAtDate.toISOString(),
      meetingType: String(form.get("meetingType") ?? "other"),
      sourceUrl: String(form.get("sourceUrl") ?? ""),
      attendees: String(form.get("attendees") ?? ""),
      summary: String(form.get("summary") ?? ""),
      decisions: String(form.get("decisions") ?? ""),
      actionItems: String(form.get("actionItems") ?? ""),
      notes: String(form.get("notes") ?? ""),
      transcript: String(form.get("transcript") ?? ""),
    };
    try {
      const response = await fetch(`/api/v1/projects/${encodeURIComponent(project.id)}/meetings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json().catch(() => ({})) as { meeting?: ProjectMeeting; error?: string };
      if (!response.ok || !data.meeting) throw new Error(data.error ?? "Meeting notes could not be saved.");
      invalidateCachedGet(`/api/v1/projects/${encodeURIComponent(project.id)}/meetings`, { notify: false });
      invalidateCachedGet("/api/v1/assistant/today");
      onSaved(data.meeting);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Meeting notes could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return <AccessibleOverlay ariaLabel={`Capture meeting notes for ${project.number}`} contentClassName="modal meeting-modal" backdropClassName="meeting-modal-backdrop" onClose={onClose} busy={saving}><header><div><p className="eyebrow">{project.number} · Project meeting</p><h2>Capture meeting notes</h2></div><button onClick={onClose} aria-label="Close meeting form" disabled={saving}><X size={20} /></button></header><form onSubmit={submit}>
    <label>Meeting title<input data-overlay-initial-focus name="title" required maxLength={160} placeholder="e.g. Client scope review" /></label>
    <div className="form-row"><label>Date and time<input name="meetingAt" type="datetime-local" required defaultValue={meetingDateInputValue()} /></label><label>Meeting type<select name="meetingType" defaultValue="client"><option value="client">Client meeting</option><option value="site-walk">Site walk</option><option value="internal">Internal huddle</option><option value="pre-install">Pre-install meeting</option><option value="closeout">Closeout review</option><option value="phone-call">Phone call</option><option value="other">Other</option></select></label></div>
    <label>Otter conversation link or other source<input name="sourceUrl" type="url" inputMode="url" placeholder="https://otter.ai/u/..." /></label>
    <p className="form-help"><ShieldCheck size={14} /> Keep the Otter link restricted to approved people. The app stores the reference; it does not change Otter sharing permissions.</p>
    <label>Attendees<textarea name="attendees" className="meeting-short-textarea" placeholder="One name or email per line" /></label>
    <label>Summary<textarea name="summary" className="meeting-medium-textarea" placeholder="Paste Otter’s Overview or write a concise summary" /></label>
    <div className="form-row"><label>Decisions<textarea name="decisions" className="meeting-medium-textarea" placeholder="What was approved or decided?" /></label><label>Action items<textarea name="actionItems" className="meeting-medium-textarea" placeholder="One follow-up per line" /></label></div>
    <label>Meeting notes<textarea name="notes" className="meeting-medium-textarea" placeholder="Observations, measurements, client preferences, risks, and context" /></label>
    <label>Transcript or exported Otter text<textarea name="transcript" className="meeting-transcript-textarea" placeholder="Optional: paste the full transcript for later project search and AI questions" /></label>
    {error && <p className="workspace-missing" role="alert">{error}</p>}
    <footer><button type="button" className="soft-button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving meeting…" : "Save meeting"}</button></footer>
  </form></AccessibleOverlay>;
}
