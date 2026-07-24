"use client";

import { useState } from "react";
import {
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  FileText,
  MessageSquareText,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { AccessibleOverlay } from "../../components/AccessibleOverlay";
import { OperationsEmptyState, PageTitle } from "../../components/operations/OperationsPrimitives";
import { AssistantHelpPanel } from "./AssistantHelpPanel";

type AssistantProject = {
  id: string;
  number: string;
  name: string;
};

type AssistantViewProps = {
  projects: readonly AssistantProject[];
};

export type AssistantCitation = { id: string; label: string; detail: string };

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
    <div className="assistant-layout"><section className="assistant-main panel"><div className="assistant-hero"><div className="ai-orb"><Bot size={29} /></div><h2>What would you like to know?</h2><p>Choose one project so every answer has a clear, reviewable evidence boundary.</p></div><label className="assistant-project-scope">Project context<select value={activeProjectId} onChange={(event) => { setProjectId(event.target.value); setAnswer(null); }} disabled={!projects.length || loading}><option value="">Choose a project…</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.number} — {project.name}</option>)}</select></label>{!projects.length && <div className="assistant-blocker"><CircleAlert size={18} /><div><strong>Create a project first</strong><span>The assistant answers project-specific questions and needs a project record before it can search evidence.</span></div></div>}{answer && <article className="ai-answer" aria-live="polite"><div><Sparkles size={18} /><strong>{answer.mode === "ai-grounded" ? "AI-grounded answer" : "Project-record summary"}</strong><span className="assistant-mode">{answer.mode === "ai-grounded" ? "OpenAI enabled" : "Records-only mode"}</span></div><p>{answer.answer}</p>{answer.missingEvidence && <p className="assistant-missing"><CircleAlert size={14} /> {answer.missingEvidence}</p>}<h4>Sources</h4>{answer.citations.length ? answer.citations.map((citation, index) => <button key={citation.id} onClick={() => setSourceDetail(citation)}><FileText size={14} /><span>[{index + 1}] {citation.label}</span><ChevronRight size={14} /></button>) : <OperationsEmptyState variant="source">No verified sources were returned for this answer.</OperationsEmptyState>}</article>}<form className="ask-box" onSubmit={(event) => { event.preventDefault(); void ask(); }}><div><textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about the selected project record…" aria-label="Ask FCI Assistant" maxLength={2000} disabled={!projects.length || loading} /><button disabled={loading || !question.trim() || !activeProjectId} aria-label="Send question">{loading ? <span className="spinner" /> : <Send size={18} />}</button></div><small><Sparkles size={12} /> Every answer is read-only and cites only server-selected project evidence.</small></form></section><aside className="panel recent-questions"><h3>Suggested questions</h3>{["What is the current project status?", "Who is the primary contact?", "How many email archives are linked?", "What evidence has not been captured yet?"].map((q) => <button key={q} onClick={() => void ask(q)} disabled={loading || !activeProjectId}><MessageSquareText size={15} /><span>{q}<small>Selected project only</small></span></button>)}<div className="privacy-note"><CheckCircle2 size={17} /><p><strong>Office-record scope</strong><br />This first version uses the operational records available to approved office users. Project-specific permissions are the next access-control layer.</p></div></aside></div>
    {sourceDetail && <SourceDetailModal citation={sourceDetail} onClose={() => setSourceDetail(null)} />}
  </>;
}

function SourceDetailModal({ citation, onClose }: { citation: AssistantCitation; onClose: () => void }) {
  return <AccessibleOverlay ariaLabel="Assistant evidence reference" contentClassName="modal" onClose={onClose}><header><div><p className="eyebrow">Assistant source</p><h2>Evidence reference</h2></div><button onClick={onClose} aria-label="Close"><X size={20} /></button></header><div className="modal-detail"><strong>{citation.label}</strong><p>{citation.detail}</p><p>This is a server-selected project record reference. Meeting notes use saved summaries, decisions, action items, notes, and bounded transcript excerpts. Raw Gmail bodies and Drive files are not returned yet.</p></div><footer className="modal-footer"><button className="primary-button" onClick={onClose} data-overlay-initial-focus>Done</button></footer></AccessibleOverlay>;
}
