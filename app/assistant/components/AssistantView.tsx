"use client";

import { useEffect, useRef, useState } from "react";
import {
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  FileText,
  ListChecks,
  MessageSquareText,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { AccessibleOverlay } from "../../components/AccessibleOverlay";
import { OperationsEmptyState, PageTitle } from "../../components/operations/OperationsPrimitives";
import { AssistantHelpPanel } from "./AssistantHelpPanel";
import styles from "./AssistantTaskReview.module.css";

type AssistantProject = {
  id: string;
  number: string;
  name: string;
};

type AssistantViewProps = {
  projects: readonly AssistantProject[];
};

export type AssistantCitation = { id: string; label: string; detail: string };

type AssistantMeeting = {
  id: string;
  title: string;
  meetingAt: string;
};

type AssistantTaskProposal = {
  title: string;
  details: string | null;
  suggestedDueDate: string | null;
  suggestedAssigneeEmail: string | null;
};

type ReviewTaskProposal = AssistantTaskProposal & {
  reviewId: string;
  accepted: boolean;
  error: string;
};

type TaskExtractionAvailability =
  | "checking"
  | "ai-enabled"
  | "records-only"
  | "disabled"
  | "unavailable";

function meetingLabel(meeting: AssistantMeeting) {
  const meetingAt = new Date(meeting.meetingAt);
  const date = Number.isNaN(meetingAt.valueOf())
    ? "Date unavailable"
    : meetingAt.toLocaleDateString([], {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
  return `${meeting.title} — ${date}`;
}

type ReviewFocusTarget = { reviewId: string } | { heading: true };

// After a proposal resolves (accepted in place or dismissed), pick the next
// still-actionable proposal from startIndex, then the previous one, and fall back
// to the stable heading when none remain focusable.
function nextReviewFocus(
  list: readonly ReviewTaskProposal[],
  startIndex: number,
): ReviewFocusTarget {
  for (let index = startIndex; index < list.length; index += 1) {
    if (!list[index].accepted) return { reviewId: list[index].reviewId };
  }
  for (let index = Math.min(startIndex, list.length) - 1; index >= 0; index -= 1) {
    if (!list[index].accepted) return { reviewId: list[index].reviewId };
  }
  return { heading: true };
}

function AssistantTaskReview({ projectId }: { projectId: string }) {
  const [meetings, setMeetings] = useState<AssistantMeeting[]>([]);
  const [meetingId, setMeetingId] = useState("");
  const [meetingState, setMeetingState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [meetingError, setMeetingError] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [proposals, setProposals] = useState<ReviewTaskProposal[]>([]);
  const [reviewStarted, setReviewStarted] = useState(false);
  const [reviewFailed, setReviewFailed] = useState(false);
  const [reviewMessage, setReviewMessage] = useState("");
  const [acceptingId, setAcceptingId] = useState("");
  const [acceptAnnouncement, setAcceptAnnouncement] = useState("");
  const [availability, setAvailability] = useState<TaskExtractionAvailability>("checking");
  const [availabilityMessage, setAvailabilityMessage] = useState("Checking task extraction availability…");
  const extractionRequestRef = useRef<AbortController | null>(null);
  const currentProjectIdRef = useRef(projectId);
  currentProjectIdRef.current = projectId;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const primaryActionRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocusRef = useRef<ReviewFocusTarget | null>(null);

  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    pendingFocusRef.current = null;
    const target = "reviewId" in pending
      ? primaryActionRefs.current.get(pending.reviewId)
      : headingRef.current;
    target?.focus();
  });

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/assistant/config", { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => ({})) as {
          keyState?: "Configured" | "Missing";
          features?: { taskExtraction?: boolean };
          error?: string;
        };
        if (
          !response.ok
          || (data.keyState !== "Configured" && data.keyState !== "Missing")
          || typeof data.features?.taskExtraction !== "boolean"
        ) {
          throw new Error(data.error ?? "Task extraction settings could not be loaded.");
        }
        if (data.keyState === "Missing") {
          // Keep the packet's deterministic non-AI fallback distinct from the
          // feature-gated provider action.
          setAvailability("records-only");
          setAvailabilityMessage(
            "OpenAI is not configured. Saved meeting action items remain available for review.",
          );
        } else if (data.features.taskExtraction) {
          setAvailability("ai-enabled");
          setAvailabilityMessage("");
        } else {
          setAvailability("disabled");
          setAvailabilityMessage("Task extraction is turned off in AI settings.");
        }
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setAvailability("unavailable");
        setAvailabilityMessage(
          error instanceof Error
            ? error.message
            : "Task extraction settings could not be loaded.",
        );
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    extractionRequestRef.current?.abort();
    extractionRequestRef.current = null;
    setExtracting(false);
    setMeetings([]);
    setMeetingId("");
    setProposals([]);
    setReviewStarted(false);
    setReviewFailed(false);
    setReviewMessage("");
    setAcceptAnnouncement("");
    setMeetingError("");
    if (!projectId) {
      setMeetingState("idle");
      return;
    }
    const controller = new AbortController();
    setMeetingState("loading");
    fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/meetings`, {
      signal: controller.signal,
    }).then(async (response) => {
      const data = await response.json().catch(() => ({})) as {
        meetings?: AssistantMeeting[];
        error?: string;
      };
      if (!response.ok || !Array.isArray(data.meetings)) {
        throw new Error(data.error ?? "Meeting notes could not be loaded.");
      }
      setMeetings(data.meetings);
      setMeetingId(data.meetings[0]?.id ?? "");
      setMeetingState("ready");
    }).catch((error) => {
      if (controller.signal.aborted) return;
      setMeetingError(
        error instanceof Error ? error.message : "Meeting notes could not be loaded.",
      );
      setMeetingState("error");
    });
    return () => {
      controller.abort();
      extractionRequestRef.current?.abort();
      extractionRequestRef.current = null;
    };
  }, [projectId]);

  async function reviewTasks() {
    if (!projectId || !meetingId) return;
    extractionRequestRef.current?.abort();
    const extractionController = new AbortController();
    extractionRequestRef.current = extractionController;
    const requestedMeetingId = meetingId;
    setExtracting(true);
    setReviewStarted(false);
    setReviewFailed(false);
    setReviewMessage("");
    setAcceptAnnouncement("");
    setProposals([]);
    try {
      const response = await fetch("/api/v1/assistant/extract-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, meetingId: requestedMeetingId }),
        signal: extractionController.signal,
      });
      const data = await response.json().catch(() => ({})) as {
        mode?: "ai-assisted" | "records-only";
        proposals?: AssistantTaskProposal[];
        cause?: string | null;
        error?: string;
      };
      if (
        extractionController.signal.aborted
        || extractionRequestRef.current !== extractionController
        || currentProjectIdRef.current !== projectId
      ) {
        return;
      }
      if (!response.ok || !data.mode || !Array.isArray(data.proposals)) {
        throw new Error(data.error ?? "Task proposals could not be prepared.");
      }
      setProposals(data.proposals.map((proposal, index) => ({
        ...proposal,
        reviewId: `${requestedMeetingId}-${index}`,
        accepted: false,
        error: "",
      })));
      setReviewMessage(
        data.cause
          ?? (data.mode === "ai-assisted"
            ? "AI suggestions are ready for your review. Nothing has been created."
            : "Saved action items are ready for your review. Nothing has been created."),
      );
      setReviewFailed(false);
      setReviewStarted(true);
    } catch (error) {
      if (extractionController.signal.aborted) return;
      setReviewMessage(
        error instanceof Error ? error.message : "Task proposals could not be prepared.",
      );
      setReviewFailed(true);
      setReviewStarted(true);
    } finally {
      if (extractionRequestRef.current === extractionController) {
        extractionRequestRef.current = null;
        setExtracting(false);
      }
    }
  }

  async function acceptTask(proposal: ReviewTaskProposal) {
    if (!projectId || !meetingId || proposal.accepted) return;
    setAcceptingId(proposal.reviewId);
    setProposals((current) => current.map((item) => (
      item.reviewId === proposal.reviewId ? { ...item, error: "" } : item
    )));
    try {
      const response = await fetch("/api/v1/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: proposal.title,
          details: proposal.details,
          dueDate: proposal.suggestedDueDate,
          projectId,
          assigneeEmail: proposal.suggestedAssigneeEmail,
          source: "meeting",
          sourceRef: meetingId,
        }),
      });
      const data = await response.json().catch(() => ({})) as {
        task?: { id: string };
        error?: string;
      };
      if (!response.ok || !data.task) {
        throw new Error(data.error ?? "The task could not be created.");
      }
      setAcceptAnnouncement(`Task created: ${proposal.title}`);
      setProposals((current) => {
        const acceptedIndex = current.findIndex((item) => item.reviewId === proposal.reviewId);
        const next = current.map((item) => (
          item.reviewId === proposal.reviewId
            ? { ...item, accepted: true, error: "" }
            : item
        ));
        if (acceptedIndex >= 0) {
          pendingFocusRef.current = nextReviewFocus(next, acceptedIndex + 1);
        }
        return next;
      });
    } catch (error) {
      setProposals((current) => current.map((item) => (
        item.reviewId === proposal.reviewId
          ? {
              ...item,
              error: error instanceof Error ? error.message : "The task could not be created.",
            }
          : item
      )));
    } finally {
      setAcceptingId("");
    }
  }

  function dismissTask(proposal: ReviewTaskProposal) {
    if (acceptingId) return;
    setProposals((current) => {
      const dismissedIndex = current.findIndex((item) => item.reviewId === proposal.reviewId);
      if (dismissedIndex < 0) return current;
      const remaining = current.filter((item) => item.reviewId !== proposal.reviewId);
      pendingFocusRef.current = nextReviewFocus(remaining, dismissedIndex);
      return remaining;
    });
  }

  return <section className={`panel ${styles.panel}`} aria-labelledby="assistant-task-review-title">
    <header className={styles.header}>
      <div>
        <p className="eyebrow">Meeting follow-through</p>
        <h2 id="assistant-task-review-title" ref={headingRef} tabIndex={-1}>Review proposed tasks</h2>
        <p>Choose a saved meeting, review each candidate, and accept tasks one at a time.</p>
      </div>
      <ListChecks size={22} aria-hidden="true" />
    </header>
    <p className={styles.visuallyHidden} role="status" aria-live="polite">{acceptAnnouncement}</p>
    {availability !== "ai-enabled" && <p
      className={styles.message}
      role={availability === "unavailable" ? "alert" : "status"}
    >{availabilityMessage}</p>}
    {!projectId ? <OperationsEmptyState variant="source">Choose a project to review its saved meeting action items.</OperationsEmptyState> : meetingState === "loading" ? <OperationsEmptyState variant="source"><RefreshCw className={styles.spinner} size={18} aria-hidden="true" /> Loading saved meetings…</OperationsEmptyState> : meetingState === "error" ? <OperationsEmptyState variant="source" tone="error">{meetingError}</OperationsEmptyState> : meetings.length === 0 ? <OperationsEmptyState variant="source">No saved meetings are available for this project.</OperationsEmptyState> : <>
      <div className={styles.controls}>
        <label>Saved meeting<select value={meetingId} onChange={(event) => { setMeetingId(event.target.value); setProposals([]); setReviewStarted(false); setReviewFailed(false); setReviewMessage(""); setAcceptAnnouncement(""); }} disabled={extracting || Boolean(acceptingId)}>{meetings.map((meeting) => <option value={meeting.id} key={meeting.id}>{meetingLabel(meeting)}</option>)}</select></label>
        <button className="primary-button" type="button" onClick={() => void reviewTasks()} disabled={!["ai-enabled", "records-only"].includes(availability) || !meetingId || extracting || Boolean(acceptingId)}>{extracting ? <><span className="spinner" /> Preparing…</> : availability === "records-only" ? "Review saved action items" : "Review proposed tasks"}</button>
      </div>
      {reviewMessage && <p className={styles.message} role={reviewFailed ? "alert" : "status"}>{reviewMessage}</p>}
      {reviewStarted && !reviewFailed && proposals.length === 0 ? <OperationsEmptyState variant="source">No task candidates were returned for this meeting.</OperationsEmptyState> : proposals.length > 0 && <ul className={styles.list} aria-label="Proposed meeting tasks">{proposals.map((proposal) => <li key={proposal.reviewId} className={proposal.accepted ? styles.accepted : undefined}>
        <div className={styles.proposal}>
          <strong>{proposal.title}</strong>
          {proposal.details && <p>{proposal.details}</p>}
          <small>{proposal.suggestedDueDate ? `Suggested due ${proposal.suggestedDueDate}` : "No due date suggested"} · {proposal.suggestedAssigneeEmail ? `Suggested for ${proposal.suggestedAssigneeEmail}` : "No assignee suggested"}</small>
          {proposal.error && <span className={styles.error} role="alert">{proposal.error}</span>}
        </div>
        <div className={styles.actions}>
          {proposal.accepted ? <span className={styles.acceptedLabel}><CheckCircle2 size={15} aria-hidden="true" /> Task created</span> : <>
            <button className="soft-button" type="button" onClick={() => dismissTask(proposal)} disabled={Boolean(acceptingId)} aria-label={`Dismiss proposed task ${proposal.title}`}><Trash2 size={14} aria-hidden="true" /> Dismiss</button>
            <button className="primary-button" type="button" ref={(node) => { if (node) primaryActionRefs.current.set(proposal.reviewId, node); else primaryActionRefs.current.delete(proposal.reviewId); }} onClick={() => void acceptTask(proposal)} disabled={Boolean(acceptingId)} aria-label={`Accept proposed task ${proposal.title}`}>{acceptingId === proposal.reviewId ? <><span className="spinner" /> Creating…</> : "Accept"}</button>
          </>}
        </div>
      </li>)}</ul>}
    </>}
  </section>;
}

export function AssistantView({ projects }: AssistantViewProps) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<{ mode: "ai-grounded" | "records-only"; answer: string; citations: AssistantCitation[]; missingEvidence: string } | null>(null);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [sourceDetail, setSourceDetail] = useState<AssistantCitation | null>(null);
  const activeProjectId = projects.some((project) => project.id === projectId) ? projectId : projects[0]?.id ?? "";
  async function ask(q?: string) {
    const prompt = q ?? question;
    if (!prompt.trim() || !activeProjectId) return;
    setQuestion(prompt);
    setLoading(true);
    try {
      const response = await fetch("/api/v1/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: prompt, projectId: activeProjectId }) });
      const data = await response.json().catch(() => ({})) as { mode?: "ai-grounded" | "records-only"; answer?: string; citations?: AssistantCitation[]; missingEvidence?: string; error?: string };
      if (!response.ok || !data.answer || !data.citations || !data.mode) throw new Error(data.error ?? "Assistant request failed");
      setAnswer({ mode: data.mode, answer: data.answer, citations: data.citations, missingEvidence: data.missingEvidence ?? "" });
    } catch (error) {
      setAnswer({ mode: "records-only", answer: error instanceof Error ? error.message : "The assistant could not reach its project-record service.", citations: [], missingEvidence: "No answer was generated. Check the selected project and the assistant configuration." });
    } finally {
      setLoading(false);
    }
  }
  return <><PageTitle eyebrow="Project-record assistant" title="Ask FCI Assistant" text="Ask about saved projects, clients, contacts, activity, approved email archives, and meeting notes. Every answer stays within the selected project." state="In development" />
    <AssistantHelpPanel />
    <AssistantTaskReview projectId={activeProjectId} />
    <div className="assistant-layout"><section className="assistant-main panel"><div className="assistant-hero"><div className="ai-orb"><Bot size={29} /></div><h2>What would you like to know?</h2><p>Choose one project so every answer has a clear, reviewable evidence boundary.</p></div><label className="assistant-project-scope">Project context<select value={activeProjectId} onChange={(event) => { setProjectId(event.target.value); setAnswer(null); }} disabled={!projects.length || loading}><option value="">Choose a project…</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.number} — {project.name}</option>)}</select></label>{!projects.length && <div className="assistant-blocker"><CircleAlert size={18} /><div><strong>Create a project first</strong><span>The assistant answers project-specific questions and needs a project record before it can search evidence.</span></div></div>}{answer && <article className="ai-answer" aria-live="polite"><div><Sparkles size={18} /><strong>{answer.mode === "ai-grounded" ? "AI-grounded answer" : "Project-record summary"}</strong><span className="assistant-mode">{answer.mode === "ai-grounded" ? "OpenAI enabled" : "Records-only mode"}</span></div><p>{answer.answer}</p>{answer.missingEvidence && <p className="assistant-missing"><CircleAlert size={14} /> {answer.missingEvidence}</p>}<h4>Sources</h4>{answer.citations.length ? answer.citations.map((citation, index) => <button key={citation.id} onClick={() => setSourceDetail(citation)}><FileText size={14} /><span>[{index + 1}] {citation.label}</span><ChevronRight size={14} /></button>) : <OperationsEmptyState variant="source">No verified sources were returned for this answer.</OperationsEmptyState>}</article>}<form className="ask-box" onSubmit={(event) => { event.preventDefault(); void ask(); }}><div><textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about the selected project record…" aria-label="Ask FCI Assistant" maxLength={2000} disabled={!projects.length || loading} /><button disabled={loading || !question.trim() || !activeProjectId} aria-label="Send question">{loading ? <span className="spinner" /> : <Send size={18} />}</button></div><small><Sparkles size={12} /> Every answer is read-only and cites only server-selected project evidence.</small></form></section><aside className="panel recent-questions"><h3>Suggested questions</h3>{["What is the current project status?", "Who is the primary contact?", "How many email archives are linked?", "What evidence has not been captured yet?"].map((q) => <button key={q} onClick={() => void ask(q)} disabled={loading || !activeProjectId}><MessageSquareText size={15} /><span>{q}<small>Selected project only</small></span></button>)}<div className="privacy-note"><CheckCircle2 size={17} /><p><strong>Office-record scope</strong><br />This first version uses the operational records available to approved office users. Project-specific permissions are the next access-control layer.</p></div></aside></div>
    {sourceDetail && <SourceDetailModal citation={sourceDetail} onClose={() => setSourceDetail(null)} />}
  </>;
}

function SourceDetailModal({ citation, onClose }: { citation: AssistantCitation; onClose: () => void }) {
  return <AccessibleOverlay ariaLabel="Assistant evidence reference" contentClassName="modal" onClose={onClose}><header><div><p className="eyebrow">Assistant source</p><h2>Evidence reference</h2></div><button onClick={onClose} aria-label="Close"><X size={20} /></button></header><div className="modal-detail"><strong>{citation.label}</strong><p>{citation.detail}</p><p>This is a server-selected project record reference. Meeting notes use saved summaries, decisions, action items, notes, and bounded transcript excerpts. Raw Gmail bodies and Drive files are not returned yet.</p></div><footer className="modal-footer"><button className="primary-button" onClick={onClose} data-overlay-initial-focus>Done</button></footer></AccessibleOverlay>;
}
