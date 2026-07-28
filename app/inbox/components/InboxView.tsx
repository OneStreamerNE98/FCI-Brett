"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Building2, FolderOpen, Inbox, ListFilter, Mail, RefreshCw, Reply, ShieldCheck, Sparkles } from "lucide-react";
import { OperationsEmptyState, PageTitle } from "../../components/operations/OperationsPrimitives";
import { cachedGetJson } from "../../lib/client-get-cache";
import {
  evaluateInboxFilingRules,
  type FilingRuleDraft,
  type InboxRuleClient,
} from "../../lib/google-workspace";
import type { InboxBucket } from "../../lib/operations-routes";
import {
  GmailFilingModal,
  type GmailFilingPreview,
  type WorkspaceMessage,
} from "../../settings/components/GoogleWorkspacePanel";
import { GmailReplyModal } from "./GmailReplyModal";

type NotificationKind = "success" | "info" | "warning" | "error";
type NotificationAction = { label: string; run: () => void };
type Notify = (message: string, kind?: NotificationKind, action?: NotificationAction) => void;
type InboxProject = {
  id: string;
  clientId: string;
  number: string;
  client: string;
  name: string;
  status: string;
  progress: number;
  value: string;
  site: string;
  managerId: string | null;
  lead: string;
  date: string;
  accent: string;
  driveFolderId?: string;
  driveUrl?: string;
};
type GmailWorkspaceStatus = {
  connectionStatus?: string;
  connectionAccount?: string | null;
  gmailConnected?: boolean;
  gmailEnabled?: boolean;
  requiresReauthorization?: boolean;
  runtimeMode?: "simulation" | "workspace";
  simulation?: boolean;
};
type AssistantTriageConfiguration = {
  keyState: "Configured" | "Missing";
  features: { triage: boolean; inboxAnalysis: boolean };
};
type AssistantTriageSuggestion = {
  messageId: string;
  projectId: string | null;
  confidence: "high" | "medium" | "low";
  rationale: string;
};
type InboxAnalysisCoverage =
  | Readonly<{
      terminationReason: "caught-up";
      message: "You're caught up";
      nextPageToken: null;
    }>
  | Readonly<{
      terminationReason: "older-pending";
      message: "Older messages not yet analyzed";
      nextPageToken: string | null;
    }>;

const inboxBucketLabels: Record<InboxBucket, string> = {
  inbox: "Inbox",
  intake: "FCI/Intake",
  "needs-review": "FCI/Needs Review",
  filed: "FCI/Filed",
};

function inboxDate(value: string | null) {
  if (!value) return "Date unavailable";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function inboxAnalysisCoverage(value: unknown): InboxAnalysisCoverage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    record.terminationReason === "caught-up"
    && record.message === "You're caught up"
  ) {
    return Object.freeze({
      terminationReason: "caught-up",
      message: "You're caught up",
      nextPageToken: null,
    });
  }
  if (
    record.terminationReason === "older-pending"
    && record.message === "Older messages not yet analyzed"
  ) {
    if (record.nextPageToken === undefined || record.nextPageToken === null) {
      return Object.freeze({
        terminationReason: "older-pending",
        message: "Older messages not yet analyzed",
        nextPageToken: null,
      });
    }
    if (typeof record.nextPageToken === "string") {
      const nextPageToken = record.nextPageToken.trim();
      if (
        nextPageToken
        && nextPageToken.length <= 2_048
        && !/[\u0000-\u001f\u007f]/.test(nextPageToken)
      ) {
        return Object.freeze({
          terminationReason: "older-pending",
          message: "Older messages not yet analyzed",
          nextPageToken,
        });
      }
    }
  }
  return null;
}

type InboxProjectSuggestion = { kind: "project" | "needs-review" | "intake" | "ignored"; text: string; reason: string };

function inboxProjectSuggestion(message: WorkspaceMessage, projects: InboxProject[], clients: InboxRuleClient[], rules: FilingRuleDraft[]): InboxProjectSuggestion {
  const decision = evaluateInboxFilingRules({ message, projects, clients, rules });
  if (decision.kind === "project" && decision.project) return { kind: "project", text: `Suggested by ${decision.ruleName}: ${decision.project.number} — review before filing`, reason: decision.reason };
  if (decision.kind === "needs-review") return { kind: "needs-review", text: `Needs review${decision.ruleName ? ` by ${decision.ruleName}` : ""}: choose the exact independent project`, reason: decision.reason };
  if (decision.kind === "ignored") return { kind: "ignored", text: `No routing by ${decision.ruleName}: Gmail stays unchanged`, reason: decision.reason };
  return { kind: "intake", text: "FCI/Intake: no enabled built-in rule matched; choose a project before filing", reason: decision.reason };
}

export function InboxView({ notify, bucket, onBucket, onRules, projects, clients, rules, onGoogleSetup }: { notify: Notify; bucket: InboxBucket; onBucket: (bucket: InboxBucket) => void; onRules: () => void; projects: InboxProject[]; clients: InboxRuleClient[]; rules: FilingRuleDraft[]; onGoogleSetup: () => void }) {
  const [workspace, setWorkspace] = useState<GmailWorkspaceStatus | null>(null);
  const [messages, setMessages] = useState<WorkspaceMessage[]>([]);
  const [loadedBucket, setLoadedBucket] = useState<InboxBucket | null>(null);
  const [search, setSearch] = useState("");
  const [checking, setChecking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [labelReady, setLabelReady] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filingMessage, setFilingMessage] = useState<WorkspaceMessage | null>(null);
  const [filingProjectId, setFilingProjectId] = useState("");
  const [filingPreview, setFilingPreview] = useState<GmailFilingPreview | null>(null);
  const [filingLoading, setFilingLoading] = useState(false);
  const [filingSubmitting, setFilingSubmitting] = useState(false);
  const [replyMessage, setReplyMessage] = useState<WorkspaceMessage | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [replySaving, setReplySaving] = useState(false);
  const [replySignature, setReplySignature] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [triageConfiguration, setTriageConfiguration] = useState<AssistantTriageConfiguration | null>(null);
  const [triageSuggestions, setTriageSuggestions] = useState<Record<string, AssistantTriageSuggestion>>({});
  const [triageLoading, setTriageLoading] = useState(false);
  const triageRequestIdRef = useRef(0);
  const [analysisCoverage, setAnalysisCoverage] = useState<InboxAnalysisCoverage | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const analysisAutoStartedRef = useRef(false);
  const analysisInFlightRef = useRef<Promise<void> | null>(null);
  const analysisMountedRef = useRef(true);

  function clearTriageSuggestions() {
    triageRequestIdRef.current += 1;
    setTriageSuggestions({});
    setTriageLoading(false);
  }

  function checkGmailConnection(force = false) {
    const request = cachedGetJson<{ workspace?: GmailWorkspaceStatus }>("/api/v1/google-workspace", { force });
    void Promise.resolve().then(() => setChecking(true));
    return request.then((data) => {
      setWorkspace(data.workspace ?? null);
      setError(null);
    }).catch((connectionError) => {
      setWorkspace(null);
      setError(connectionError instanceof Error ? connectionError.message : "Google Workspace status could not be checked.");
    }).finally(() => {
      setChecking(false);
    });
  }

  useEffect(() => {
    void checkGmailConnection();
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      cachedGetJson<{ preferences?: { replySignature?: unknown }; isAdmin?: unknown }>("/api/v1/settings/me"),
      cachedGetJson<AssistantTriageConfiguration>("/api/v1/assistant/config"),
    ]).then(([accountResult, configurationResult]) => {
      if (!active) return;
      if (accountResult.status === "fulfilled") {
        const data = accountResult.value;
        setReplySignature(typeof data?.preferences?.replySignature === "string" ? data.preferences.replySignature.slice(0, 2_000) : "");
        setIsAdmin(data.isAdmin === true);
      }
      if (
        configurationResult.status === "fulfilled"
        && (configurationResult.value.keyState === "Configured" || configurationResult.value.keyState === "Missing")
        && typeof configurationResult.value.features?.triage === "boolean"
      ) {
        triageRequestIdRef.current += 1;
        setTriageSuggestions({});
        setTriageLoading(false);
        setTriageConfiguration({
          keyState: configurationResult.value.keyState,
          features: {
            triage: configurationResult.value.features.triage,
            // Missing or malformed newly widened settings fail closed.
            inboxAnalysis: configurationResult.value.features?.inboxAnalysis === true,
          },
        });
      }
    });
    return () => {
      active = false;
      triageRequestIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    analysisMountedRef.current = true;
    return () => {
      analysisMountedRef.current = false;
    };
  }, []);

  const gmailReady = workspace?.connectionStatus === "connected" && workspace.gmailEnabled === true && workspace.gmailConnected === true;
  const visibleMessages = loadedBucket === bucket ? messages : [];
  const triageReady = Boolean(
    isAdmin
    && triageConfiguration?.keyState === "Configured"
    && triageConfiguration.features.triage,
  );
  const inboxAnalysisReady = Boolean(
    isAdmin
    && triageConfiguration?.keyState === "Configured"
    && triageConfiguration.features.inboxAnalysis,
  );

  const runInboxAnalysis = useCallback((pageToken?: string) => {
    if (!inboxAnalysisReady) return Promise.resolve();
    if (analysisInFlightRef.current) return analysisInFlightRef.current;
    const request = (async () => {
      if (analysisMountedRef.current) setAnalysisLoading(true);
      try {
        const response = await fetch("/api/v1/inbox-analysis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(pageToken ? { pageToken } : {}),
        });
        const body = await response.json().catch(() => null) as unknown;
        if (!response.ok) {
          throw new Error("Inbox analysis could not finish.");
        }
        const coverage = inboxAnalysisCoverage(body);
        if (!coverage) {
          throw new Error("Inbox analysis returned an invalid coverage result.");
        }
        if (analysisMountedRef.current) setAnalysisCoverage(coverage);
      } catch {
        if (analysisMountedRef.current) {
          setAnalysisCoverage(null);
          notify("Inbox analysis could not finish. Refresh to retry.", "warning");
        }
      } finally {
        if (analysisMountedRef.current) setAnalysisLoading(false);
      }
    })();
    analysisInFlightRef.current = request;
    void request.finally(() => {
      if (analysisInFlightRef.current === request) {
        analysisInFlightRef.current = null;
      }
    });
    return request;
  }, [inboxAnalysisReady, notify]);

  useEffect(() => {
    if (
      !gmailReady
      || !inboxAnalysisReady
      || analysisAutoStartedRef.current
    ) {
      return;
    }
    analysisAutoStartedRef.current = true;
    void runInboxAnalysis();
  }, [gmailReady, inboxAnalysisReady, runInboxAnalysis]);

  async function loadMessages() {
    clearTriageSuggestions();
    setLoading(true);
    setError(null);
    try {
      const parameters = new URLSearchParams({ label: bucket });
      if (search.trim()) parameters.set("q", search.trim());
      const response = await fetch(`/api/v1/integrations/google/gmail/messages?${parameters.toString()}`);
      const data = await response.json().catch(() => ({})) as { messages?: WorkspaceMessage[]; labelReady?: boolean; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Your Gmail messages could not be loaded.");
      setMessages(data.messages ?? []);
      setLoadedBucket(bucket);
      setLabelReady(Boolean(data.labelReady));
      notify(`Loaded ${data.messages?.length ?? 0} message${(data.messages?.length ?? 0) === 1 ? "" : "s"} from ${inboxBucketLabels[bucket]}.`, "info");
      if (inboxAnalysisReady) void runInboxAnalysis();
    } catch (loadError) {
      setMessages([]);
      setLoadedBucket(bucket);
      setError(loadError instanceof Error ? loadError.message : "Your Gmail messages could not be loaded.");
      await checkGmailConnection(true);
    } finally {
      setLoading(false);
    }
  }

  async function prepareLabels() {
    setLoading(true);
    try {
      const response = await fetch("/api/v1/integrations/google/gmail/labels/prepare", { method: "POST" });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "FCI Gmail labels could not be prepared.");
      setLabelReady(true);
      notify("FCI Gmail labels are ready. No messages were moved or archived.", "success");
      await loadMessages();
    } catch (prepareError) {
      const message = prepareError instanceof Error ? prepareError.message : "FCI Gmail labels could not be prepared.";
      setError(message);
      notify(message, "error");
    } finally {
      setLoading(false);
    }
  }

  function openFilingReview(message: WorkspaceMessage) {
    setFilingMessage(message);
    setFilingProjectId("");
    setFilingPreview(null);
  }

  function acceptTriageSuggestion(
    message: WorkspaceMessage,
    suggestion: AssistantTriageSuggestion,
  ) {
    if (!suggestion.projectId) return;
    setFilingMessage(message);
    setFilingProjectId(suggestion.projectId);
    setFilingPreview(null);
  }

  async function suggestWithAi() {
    if (
      triageLoading
      || visibleMessages.length === 0
      || triageConfiguration?.keyState !== "Configured"
      || triageConfiguration.features.triage !== true
      || !isAdmin
    ) {
      return;
    }
    const requestId = ++triageRequestIdRef.current;
    setTriageLoading(true);
    setTriageSuggestions({});
    try {
      const response = await fetch("/api/v1/assistant/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageIds: visibleMessages.slice(0, 20).map((message) => message.id),
        }),
      });
      const data = await response.json().catch(() => ({})) as {
        suggestions?: AssistantTriageSuggestion[];
        error?: string;
      };
      if (requestId !== triageRequestIdRef.current) return;
      if (!response.ok) {
        throw new Error(data.error ?? "AI filing suggestions could not be prepared.");
      }
      const loadedMessageIds = new Set(visibleMessages.map((message) => message.id));
      const projectIds = new Set(projects.map((project) => project.id));
      const safeSuggestions = (data.suggestions ?? []).filter((suggestion) => (
        loadedMessageIds.has(suggestion.messageId)
        && (suggestion.projectId === null || projectIds.has(suggestion.projectId))
        && ["high", "medium", "low"].includes(suggestion.confidence)
        && typeof suggestion.rationale === "string"
        && suggestion.rationale.length > 0
        && suggestion.rationale.length <= 200
      ));
      setTriageSuggestions(Object.fromEntries(
        safeSuggestions.map((suggestion) => [suggestion.messageId, suggestion]),
      ));
      notify(
        `Prepared ${safeSuggestions.length} AI filing suggestion${safeSuggestions.length === 1 ? "" : "s"}. Review each before copying.`,
        "info",
      );
    } catch (triageError) {
      if (requestId !== triageRequestIdRef.current) return;
      notify(
        triageError instanceof Error
          ? triageError.message
          : "AI filing suggestions could not be prepared.",
        "error",
      );
    } finally {
      if (requestId === triageRequestIdRef.current) setTriageLoading(false);
    }
  }

  function closeFilingReview() {
    if (filingLoading || filingSubmitting) return;
    setFilingMessage(null);
    setFilingProjectId("");
    setFilingPreview(null);
  }

  async function previewGmailFiling() {
    if (!filingMessage || !filingProjectId) {
      notify("Choose the exact independent project before reviewing this email filing.", "warning");
      return;
    }
    setFilingLoading(true);
    try {
      const response = await fetch(`/api/v1/integrations/google/gmail/messages/${encodeURIComponent(filingMessage.id)}/file?projectId=${encodeURIComponent(filingProjectId)}`);
      const data = await response.json().catch(() => ({})) as GmailFilingPreview & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "The Gmail filing preview could not be loaded.");
      setFilingPreview(data);
      notify(`Review the Drive filing for ${data.project.number}. Nothing has been copied yet.`, "info");
    } catch (previewError) {
      setFilingPreview(null);
      notify(previewError instanceof Error ? previewError.message : "The Gmail filing preview could not be loaded.", "error");
    } finally {
      setFilingLoading(false);
    }
  }

  async function confirmGmailFiling() {
    if (!filingMessage || !filingProjectId || !filingPreview) return;
    setFilingSubmitting(true);
    try {
      const response = await fetch(`/api/v1/integrations/google/gmail/messages/${encodeURIComponent(filingMessage.id)}/file`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: filingProjectId }) });
      const data = await response.json().catch(() => ({})) as { filed?: boolean; alreadyFiled?: boolean; archive?: { attachmentCount?: number }; error?: string };
      if (!response.ok) throw new Error(data.error ?? "The Gmail filing could not be completed.");
      notify(data.alreadyFiled ? "This email was already filed to the selected project. Your inbox was left intact." : `Email and ${data.archive?.attachmentCount ?? filingPreview.message.attachmentCount} attachment(s) were copied to the selected project. FCI/Filed was added; Inbox remains intact.`, data.alreadyFiled ? "info" : "success");
      setFilingMessage(null);
      setFilingProjectId("");
      setFilingPreview(null);
      await loadMessages();
    } catch (filingError) {
      notify(filingError instanceof Error ? filingError.message : "The Gmail filing could not be completed.", "error");
    } finally {
      setFilingSubmitting(false);
    }
  }

  function openReplyComposer(message: WorkspaceMessage) {
    setReplyMessage(message);
    setReplyBody(replySignature ? `\n\n${replySignature}` : "");
  }

  function closeReplyComposer() {
    if (replySaving) return;
    setReplyMessage(null);
    setReplyBody("");
  }

  async function saveReplyDraft() {
    if (!replyMessage || !replyBody.trim()) {
      notify("Write a reply before saving a Gmail draft.", "warning");
      return;
    }
    setReplySaving(true);
    try {
      const response = await fetch(`/api/v1/integrations/google/gmail/messages/${encodeURIComponent(replyMessage.id)}/reply-draft`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: replyBody }) });
      const data = await response.json().catch(() => ({})) as { draftSaved?: boolean; recipient?: string; error?: string };
      if (!response.ok || !data.draftSaved) throw new Error(data.error ?? "Gmail draft could not be saved.");
      notify(`Reply draft saved in Gmail for ${data.recipient ?? "the original sender"}. It was not sent.`, "success");
      setReplyMessage(null);
      setReplyBody("");
    } catch (replyError) {
      notify(replyError instanceof Error ? replyError.message : "Gmail draft could not be saved.", "error");
    } finally {
      setReplySaving(false);
    }
  }

  const connectionText = workspace?.simulation ? "Local Workspace simulation is ready" : gmailReady ? `Connected Workspace Gmail: ${workspace?.connectionAccount ?? "company mailbox"}` : workspace?.requiresReauthorization ? "Google Workspace needs to be reconnected to approve Gmail access." : "Connect the company Google Workspace account to load messages.";
  return <>
    <PageTitle eyebrow="Gmail intake" title="Gmail project inbox" text="Search the company Gmail mailbox—or safe simulated messages—then review and copy each message to one independent project." state={gmailReady ? "In development" : "Setup required"} action={<><button className="soft-button" onClick={onRules}><ListFilter size={15} /> Inbox & file rules</button>{gmailReady ? <button className="soft-button" onClick={() => void loadMessages()} disabled={loading}>{loading ? "Loading…" : <><RefreshCw size={15} /> Refresh</>}</button> : <button className="primary-button" onClick={onGoogleSetup}><Building2 size={15} /> Google setup</button>}</>} />
    <section className={`inbox-connection inbox-state-strip ${gmailReady ? "ready" : ""}`}><Mail size={18} /><div className="inbox-state-copy"><strong>{gmailReady ? connectionText : "Workspace Gmail connection required"}</strong><span>{workspace?.simulation ? "Sample messages only. No Google account is connected and nothing is sent to Google." : gmailReady ? "Messages load only after your direct action; filing remains review-first and keeps Inbox." : connectionText}</span><span className="inbox-safety-copy"><ShieldCheck size={14} />Suggestions only: {rules.filter((rule) => rule.enabled).length} enabled rules can recommend a destination, but you must choose the exact project and approve every copy.</span></div><div className="inbox-state-actions"><button className="soft-button" onClick={() => void checkGmailConnection(true)} disabled={checking}>{checking ? "Checking…" : "Check connection"}</button><button className="soft-button" onClick={onRules}>Manage rules</button></div></section>
    {error && <p className="workspace-missing">{error}</p>}
    <div className="inbox-layout">
      <section className="panel message-list">
        <header className="live-inbox-toolbar"><div><label>Mailbox<select value={bucket} onChange={(event) => { clearTriageSuggestions(); onBucket(event.target.value as InboxBucket); }} disabled={loading}><option value="inbox">Inbox</option><option value="intake">FCI/Intake</option><option value="needs-review">FCI/Needs Review</option><option value="filed">FCI/Filed</option></select></label><label>Search this Gmail mailbox<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="e.g. from:vendor@example.com" disabled={loading} /></label><small className="gmail-search-help">Use Gmail search terms such as <b>from:</b>, <b>subject:</b>, or a project number.</small></div><div className="workspace-actions">{(analysisLoading || analysisCoverage) && <span className="gmail-search-help" role="status" aria-live="polite">{analysisLoading ? "Checking inbox analysis…" : analysisCoverage?.message}</span>}{analysisCoverage?.terminationReason === "older-pending" && <button className="soft-button" type="button" onClick={() => void runInboxAnalysis(analysisCoverage.nextPageToken ?? undefined)} aria-busy={analysisLoading} aria-disabled={analysisLoading}>{analysisLoading ? "Checking older…" : "Check older"}</button>}{labelReady === false && bucket !== "inbox" && <button className="soft-button" onClick={() => void prepareLabels()} disabled={loading}>Prepare FCI labels</button>}{triageReady && <button className="soft-button" onClick={() => void suggestWithAi()} disabled={visibleMessages.length === 0 || loading || triageLoading}><Sparkles size={15} /> {triageLoading ? "Suggesting…" : "Suggest with AI"}</button>}<button className="primary-button" onClick={() => void loadMessages()} disabled={!gmailReady || loading}>{loading ? "Loading…" : "Load messages"}</button></div></header>
        {!gmailReady ? <OperationsEmptyState variant="inbox"><Mail size={25} /><h2>Connect Workspace Gmail to see the company inbox</h2><p>Until Workspace is available, switch the local app to Workspace simulation to test the full inbox workflow with sample data.</p><button className="primary-button" onClick={onGoogleSetup}>Open Google Workspace setup</button></OperationsEmptyState> : visibleMessages.length === 0 ? <OperationsEmptyState variant="inbox"><Inbox size={25} /><h2>{loading ? "Loading your inbox…" : "No messages loaded yet"}</h2><p>Choose a mailbox, optionally enter a Gmail search, and use the Load messages button above. The view is limited to 20 message summaries.</p></OperationsEmptyState> : visibleMessages.map((message, index) => {
          const suggestion = inboxProjectSuggestion(message, projects, clients, rules);
          const aiSuggestion = triageSuggestions[message.id];
          const aiProject = aiSuggestion?.projectId
            ? projects.find((project) => project.id === aiSuggestion.projectId)
            : null;
          return <article className="message-row live-message-row" key={message.id}><div className={`sender-dot s${index % 4}`}>{(message.from ?? "?").split(/[\s@<]+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</div><div className="message-copy"><strong>{message.from ?? "Unknown sender"}</strong><h3>{message.subject ?? "(No subject)"}</h3><p>{message.snippet || "No preview available."}</p><div className={`inbox-project-suggestion ${suggestion.kind}`} title={suggestion.reason} aria-label={`${suggestion.text}. ${suggestion.reason}`}><ShieldCheck size={13} /> {suggestion.text}</div>{aiSuggestion && <div className={`inbox-project-suggestion ${aiProject ? "project" : "needs-review"}`} title={aiSuggestion.rationale} aria-label={`AI suggestion. ${aiProject ? `${aiProject.number} — ${aiProject.name}` : "No confident project match"}. ${aiSuggestion.confidence} confidence. ${aiSuggestion.rationale}`}><Sparkles size={13} aria-hidden="true" /> AI suggestion · {aiSuggestion.confidence} · {aiProject ? `${aiProject.number} — ${aiProject.name}` : "No confident project match"}{aiProject && <button className="soft-button" aria-label={`Accept AI suggestion for ${message.subject || "(No subject)"}: ${aiProject.number} — ${aiProject.name}; ${aiSuggestion.confidence} confidence; ${aiSuggestion.rationale}`} onClick={() => acceptTriageSuggestion(message, aiSuggestion)}>Accept</button>}</div>}</div><div className="message-actions"><span>{inboxDate(message.date)}</span><small>{message.to ? `To: ${message.to}` : workspace?.simulation ? "Simulated Workspace mailbox" : "Company Workspace mailbox"}</small><button className="primary-button" onClick={() => openFilingReview(message)}><FolderOpen size={14} /> Review & copy</button><button className="soft-button" onClick={() => openReplyComposer(message)}><Reply size={14} /> Draft reply</button></div></article>;
        })}
      </section>
      <aside className="panel inbox-summary"><div className="summary-icon"><Mail size={20} /></div><h2>Inbox status</h2><p>{gmailReady ? `Showing ${visibleMessages.length} loaded message${visibleMessages.length === 1 ? "" : "s"} from ${inboxBucketLabels[bucket]}.` : "Workspace Gmail is not connected yet."}</p><dl className="inbox-status-list"><div><dt>Provider</dt><dd>{workspace?.simulation ? "Local Workspace simulation" : workspace?.connectionAccount ?? "Not connected"}</dd></div><div><dt>Message limit</dt><dd>20 summaries</dd></div><div><dt>Filing protection</dt><dd>Exact project required</dd></div></dl><hr /><h3>Keep it organized</h3><ul className="inbox-organization"><li>Use only FCI/Intake, FCI/Needs Review, and FCI/Filed labels.</li><li>Use project numbers for the safest match.</li><li>Store the permanent email and attachments in that project’s Shared Drive folder.</li></ul><small>{workspace?.simulation ? "Simulation mode · no Google access" : "Google Workspace mode"}</small><small>Inbox is retained after filing</small></aside>
    </div>
    {filingMessage && <GmailFilingModal message={filingMessage} projects={projects} projectId={filingProjectId} preview={filingPreview} loading={filingLoading} submitting={filingSubmitting} onProject={(projectId) => { setFilingProjectId(projectId); setFilingPreview(null); }} onPreview={previewGmailFiling} onConfirm={confirmGmailFiling} onClose={closeFilingReview} />}
    {replyMessage && <GmailReplyModal message={replyMessage} body={replyBody} saving={replySaving} onBody={setReplyBody} onSave={saveReplyDraft} onClose={closeReplyComposer} />}
  </>;
}
