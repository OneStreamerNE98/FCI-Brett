"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Building2,
  CalendarClock,
  FolderOpen,
  Inbox,
  ListFilter,
  Mail,
  RefreshCw,
  Reply,
  ShieldCheck,
  Sparkles,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { AccessibleOverlay } from "../../components/AccessibleOverlay";
import { ClientDataNotice } from "../../components/ClientDataNotice";
import { OperationsEmptyState, PageTitle } from "../../components/operations/OperationsPrimitives";
import {
  DEFAULT_ASSISTANT_LABEL_DEFINITIONS,
  MAX_ASSISTANT_LABEL_ROWS,
  MAX_ASSISTANT_LABELS,
  normalizeAssistantLabelDescription,
  normalizeAssistantLabelSlug,
} from "../../domain/assistant-label-definition";
import {
  cachedGetJson,
  invalidateCachedGet,
  invalidateGmailFilingReadCaches,
  invalidateTaskReadCaches,
  invalidateWorkspaceOperationsReadCache,
  isTerminalCachedGetError,
} from "../../lib/client-get-cache";
import { notifyError } from "../../lib/notification-policy";
import { useCachedGetSubscription } from "../../lib/client-get-hooks";
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
export type InboxLeadProposal = Readonly<{
  company: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  projectName: string | null;
  site: string | null;
  estimatedValue: number | null;
}>;
type InboxReviewIntent = string;
type InboxReviewLabel = Readonly<{
  slug: string;
  description: string;
  retired: boolean;
}>;
type InboxReviewAnalysis = Readonly<{
  gmailMessageId: string;
  intents: readonly InboxReviewIntent[];
  projectId: string | null;
  confidence: "high" | "medium" | "low";
  rationale: string;
}>;
type InboxReviewQueueRow = Readonly<{
  id: string;
  subject: string | null;
  sender: string | null;
  receivedAt: number | null;
  analysis: InboxReviewAnalysis | null;
  leadProposal: InboxLeadProposal | null;
}>;
type InboxReviewQueue = Readonly<{
  labels: ReadonlyMap<string, InboxReviewLabel>;
  rows: readonly InboxReviewQueueRow[];
  totalCount: number;
  failedCount?: number;
  failedReason?: string;
}>;
type InboxReviewQueueState = "idle" | "loading" | "ready" | "unavailable";
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

type InboxViewProps = Readonly<{
  notify: Notify;
  bucket: InboxBucket;
  onBucket: (bucket: InboxBucket) => void;
  onRules: () => void;
  projects: InboxProject[];
  clients: InboxRuleClient[];
  rules: FilingRuleDraft[];
  onGoogleSetup: () => void;
  onCreateLead: (
    proposal: InboxLeadProposal,
    afterCreate: () => Promise<void>,
  ) => void;
}>;

type InboxTaskKind = "schedule" | "warranty";
type ReviewRetirementReason = "manual" | "lead-created";
type InboxTaskProposal = Readonly<{
  row: InboxReviewQueueRow;
  kind: InboxTaskKind;
  title: string;
  details: string;
  dueDate: string;
  projectId: string;
}>;

const inboxBucketLabels: Record<InboxBucket, string> = {
  inbox: "Inbox",
  intake: "FCI/Intake",
  "needs-review": "FCI/Needs Review",
  filed: "FCI/Filed",
};

const DEFAULT_INBOX_REVIEW_LABELS: ReadonlyMap<string, InboxReviewLabel> = new Map(
  DEFAULT_ASSISTANT_LABEL_DEFINITIONS.map(({ slug, description }) => [
    slug,
    Object.freeze({ slug, description, retired: false }),
  ]),
);

function inboxDate(value: string | number | null) {
  if (!value) return "Date unavailable";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function inboxReviewLabels(value: unknown): ReadonlyMap<string, InboxReviewLabel> | null {
  // Older test/dev responders predate the additive catalog field. Their four
  // built-in labels remain readable, while any custom intent still fails
  // closed unless its server-validated display metadata accompanies the row.
  if (value === undefined) return DEFAULT_INBOX_REVIEW_LABELS;
  // The catalog ships retired tombstones so historical rows stay readable, and
  // those are exempt from the active cap. Bounding the whole array by
  // MAX_ASSISTANT_LABELS therefore fails the queue closed the moment a catalog
  // carries tombstones: total rows are bounded by MAX_ASSISTANT_LABEL_ROWS and
  // the active subset by MAX_ASSISTANT_LABELS, checked once the rows parse.
  if (!Array.isArray(value) || value.length > MAX_ASSISTANT_LABEL_ROWS) {
    return null;
  }
  const labels = new Map<string, InboxReviewLabel>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return null;
    }
    const label = candidate as Record<string, unknown>;
    if (
      Object.keys(label).length !== 3
      || typeof label.slug !== "string"
      || typeof label.description !== "string"
      || typeof label.retired !== "boolean"
    ) {
      return null;
    }
    try {
      if (
        normalizeAssistantLabelSlug(label.slug) !== label.slug
        || normalizeAssistantLabelDescription(label.description) !== label.description
      ) {
        return null;
      }
    } catch {
      return null;
    }
    if (labels.has(label.slug)) return null;
    labels.set(label.slug, Object.freeze({
      slug: label.slug,
      description: label.description,
      retired: label.retired,
    }));
  }
  let active = 0;
  for (const label of labels.values()) if (!label.retired) active += 1;
  if (active > MAX_ASSISTANT_LABELS) return null;
  return labels;
}

function inboxReviewQueue(value: unknown): InboxReviewQueue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    !Array.isArray(record.rows)
    || !Number.isSafeInteger(record.totalCount)
    || Number(record.totalCount) < 0
  ) {
    return null;
  }
  const labels = inboxReviewLabels(record.labels);
  if (!labels) return null;
  const hasFailedCount = Object.hasOwn(record, "failedCount");
  const hasFailedReason = Object.hasOwn(record, "failedReason");
  if (
    hasFailedCount !== hasFailedReason
    || (hasFailedCount && (
      !Number.isSafeInteger(record.failedCount)
      || Number(record.failedCount) < 1
      || typeof record.failedReason !== "string"
      || !record.failedReason.trim()
      || record.failedReason.length > 120
      || /[\u0000-\u001f\u007f]/.test(record.failedReason)
    ))
  ) {
    return null;
  }
  const rows: InboxReviewQueueRow[] = [];
  for (const candidate of record.rows) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return null;
    }
    const row = candidate as Record<string, unknown>;
    if (
      typeof row.id !== "string"
      || !row.id
      || (row.subject !== null && typeof row.subject !== "string")
      || (row.sender !== null && typeof row.sender !== "string")
      || (
        row.receivedAt !== null
        && (!Number.isSafeInteger(row.receivedAt) || Number(row.receivedAt) < 0)
      )
    ) {
      return null;
    }
    let analysis: InboxReviewAnalysis | null = null;
    if (row.analysis !== null && row.analysis !== undefined) {
      if (
        !row.analysis
        || typeof row.analysis !== "object"
        || Array.isArray(row.analysis)
      ) {
        return null;
      }
      const candidate = row.analysis as Record<string, unknown>;
      if (
        Object.keys(candidate).length !== 5
        || typeof candidate.gmailMessageId !== "string"
        || !/^[A-Za-z0-9_-]{1,256}$/.test(candidate.gmailMessageId)
        || !Array.isArray(candidate.intents)
        || candidate.intents.length === 0
        || candidate.intents.length > MAX_ASSISTANT_LABELS
        || candidate.intents.some((intent) =>
          typeof intent !== "string" || !labels.has(intent)
        )
        || new Set(candidate.intents).size !== candidate.intents.length
        || (
          candidate.projectId !== null
          && (
            typeof candidate.projectId !== "string"
            || !/^[A-Za-z0-9_-]{1,128}$/.test(candidate.projectId)
          )
        )
        || !["high", "medium", "low"].includes(String(candidate.confidence))
        || typeof candidate.rationale !== "string"
        || !candidate.rationale.trim()
        || candidate.rationale.length > 200
        || /[\u0000-\u001f\u007f]/.test(candidate.rationale)
      ) {
        return null;
      }
      analysis = Object.freeze({
        gmailMessageId: candidate.gmailMessageId,
        intents: Object.freeze([...candidate.intents]) as readonly InboxReviewIntent[],
        projectId: candidate.projectId as string | null,
        confidence: candidate.confidence as InboxReviewAnalysis["confidence"],
        rationale: candidate.rationale,
      });
    }
    let leadProposal: InboxLeadProposal | null = null;
    if (row.leadProposal !== null && row.leadProposal !== undefined) {
      if (
        !row.leadProposal
        || typeof row.leadProposal !== "object"
        || Array.isArray(row.leadProposal)
      ) {
        return null;
      }
      const proposal = row.leadProposal as Record<string, unknown>;
      const proposalTextLimits = {
        company: 180,
        contactName: 160,
        contactEmail: 254,
        contactPhone: 40,
        projectName: 180,
        site: 300,
      } as const;
      const proposalTextKeys = Object.keys(proposalTextLimits) as
        (keyof typeof proposalTextLimits)[];
      if (
        Object.keys(proposal).length !== proposalTextKeys.length + 1
        || !proposalTextKeys.every((key) => Object.hasOwn(proposal, key))
        || !Object.hasOwn(proposal, "estimatedValue")
        || proposalTextKeys.some((key) => {
          const value = proposal[key];
          return value !== null && (
            typeof value !== "string"
            || !value.trim()
            || value.length > proposalTextLimits[key]
            || /[\u0000-\u001f\u007f]/.test(value)
            || (
              key === "contactEmail"
              && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
            )
          );
        })
        || (
          proposal.estimatedValue !== null
          && (
            !Number.isSafeInteger(proposal.estimatedValue)
            || Number(proposal.estimatedValue) < 0
            || Number(proposal.estimatedValue) > 2_147_483_647
          )
        )
      ) {
        return null;
      }
      leadProposal = Object.freeze({
        company: proposal.company as string | null,
        contactName: proposal.contactName as string | null,
        contactEmail: proposal.contactEmail as string | null,
        contactPhone: proposal.contactPhone as string | null,
        projectName: proposal.projectName as string | null,
        site: proposal.site as string | null,
        estimatedValue: proposal.estimatedValue as number | null,
      });
    }
    rows.push(Object.freeze({
      id: row.id,
      subject: row.subject as string | null,
      sender: row.sender as string | null,
      receivedAt: row.receivedAt as number | null,
      analysis,
      leadProposal,
    }));
  }
  return Object.freeze({
    labels,
    rows: Object.freeze(rows),
    totalCount: Number(record.totalCount),
    ...(hasFailedCount
      ? {
          failedCount: Number(record.failedCount),
          failedReason: record.failedReason as string,
        }
      : {}),
  });
}

function taskProposalText(
  row: InboxReviewQueueRow,
  kind: InboxTaskKind,
) {
  const subject = row.subject?.replace(/\s+/g, " ").trim() || "email request";
  const prefix = kind === "warranty"
    ? "Warranty callback"
    : "Schedule follow-up";
  const title = `${prefix}: ${subject}`.slice(0, 200);
  const sender = row.sender?.replace(/\s+/g, " ").trim() || "the email sender";
  const rationale = row.analysis?.rationale ?? "Review the stored email analysis.";
  const details = (
    kind === "warranty"
      ? `Call back ${sender} about this warranty or service request. ${rationale}`
      : `Follow up with ${sender} about this schedule request. ${rationale}`
  ).slice(0, 4_000);
  return { title, details };
}

function reviewIntentLabel(
  intent: InboxReviewIntent,
  labels: ReadonlyMap<string, InboxReviewLabel>,
) {
  const definition = labels.get(intent);
  if (!definition) return "Saved label";
  if (definition.retired) return `${definition.description} (retired)`;
  if (intent === "project-update") return "Project update";
  if (intent === "schedule") return "Schedule";
  if (intent === "warranty") return "Warranty callback";
  if (intent === "lead") return "Lead";
  return definition.description;
}

function InboxTaskProposalModal({
  proposal,
  projects,
  saving,
  error,
  onChange,
  onSubmit,
  onClose,
}: {
  proposal: InboxTaskProposal;
  projects: readonly InboxProject[];
  saving: boolean;
  error: string;
  onChange: (next: InboxTaskProposal) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const label = proposal.kind === "warranty"
    ? "Create warranty callback task"
    : "Create schedule task";
  return <AccessibleOverlay
    ariaLabel={label}
    busy={saving}
    contentClassName="modal gmail-reply-modal"
    onClose={onClose}
  >
    <header>
      <div>
        <p className="eyebrow">Email task proposal</p>
        <h2>{proposal.kind === "warranty"
          ? "Review warranty callback"
          : "Review schedule follow-up"}</h2>
      </div>
      <button type="button" aria-label="Close" onClick={onClose} disabled={saving}>
        <X size={20} aria-hidden="true" />
      </button>
    </header>
    <form onSubmit={(event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      onSubmit();
    }}>
      <div className="modal-detail">
        {error && <p className="workspace-missing" role="alert">{error}</p>}
        <label>
          Task title
          <input
            data-overlay-initial-focus
            required
            maxLength={200}
            value={proposal.title}
            onChange={(event) => onChange({
              ...proposal,
              title: event.target.value,
            })}
            disabled={saving}
          />
        </label>
        <label>
          Task details
          <textarea
            rows={4}
            maxLength={4_000}
            value={proposal.details}
            onChange={(event) => onChange({
              ...proposal,
              details: event.target.value,
            })}
            disabled={saving}
          />
        </label>
        <label>
          Due date
          <input
            type="date"
            value={proposal.dueDate}
            onChange={(event) => onChange({
              ...proposal,
              dueDate: event.target.value,
            })}
            disabled={saving}
          />
        </label>
        <label>
          Project
          <select
            value={proposal.projectId}
            onChange={(event) => onChange({
              ...proposal,
              projectId: event.target.value,
            })}
            disabled={saving}
          >
            <option value="">No linked project</option>
            {projects.map((project) => <option key={project.id} value={project.id}>
              {project.number} — {project.name}
            </option>)}
          </select>
        </label>
        <p className="form-help">
          <ShieldCheck size={14} aria-hidden="true" /> This is a proposal from stored
          analysis. Nothing is created until you submit this form.
        </p>
      </div>
      <footer className="modal-footer">
        <button type="button" className="soft-button" onClick={onClose} disabled={saving}>
          Cancel
        </button>
        <button
          type="submit"
          className="primary-button"
          disabled={saving || !proposal.title.trim()}
        >
          {saving ? "Creating…" : label}
        </button>
      </footer>
    </form>
  </AccessibleOverlay>;
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

export function InboxView({
  notify,
  bucket,
  onBucket,
  onRules,
  projects,
  clients,
  rules,
  onGoogleSetup,
  onCreateLead,
}: InboxViewProps) {
  const [workspace, setWorkspace] = useState<GmailWorkspaceStatus | null>(null);
  const [messages, setMessages] = useState<WorkspaceMessage[]>([]);
  const [loadedBucket, setLoadedBucket] = useState<InboxBucket | null>(null);
  const [search, setSearch] = useState("");
  const [checking, setChecking] = useState(false);
  const [workspaceSettled, setWorkspaceSettled] = useState(false);
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
  const [reviewRows, setReviewRows] = useState<readonly InboxReviewQueueRow[]>([]);
  const [reviewLabels, setReviewLabels] = useState<ReadonlyMap<string, InboxReviewLabel>>(
    DEFAULT_INBOX_REVIEW_LABELS,
  );
  const [reviewTotalCount, setReviewTotalCount] = useState(0);
  const [failedAnalysisSummary, setFailedAnalysisSummary] = useState<Readonly<{
    count: number;
    reason: string;
  }> | null>(null);
  const [retryingFailedAnalyses, setRetryingFailedAnalyses] = useState(false);
  const [reviewQueueState, setReviewQueueState] =
    useState<InboxReviewQueueState>("idle");
  const [markingReviewId, setMarkingReviewId] = useState<string | null>(null);
  // Append-only for the life of the component, and deliberately separate from
  // leadRetirementErrorIds. That set is a BANNER flag and is cleared on every
  // retry; gating the Create lead button on it meant a retry that also failed
  // erased the guard and re-offered the button for a row whose lead already
  // exists — a duplicate lead plus a duplicate lead.created Chat card. A row
  // that has produced a lead can never offer to produce another.
  const [leadCreatedRowIds, setLeadCreatedRowIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [leadRetirementErrorIds, setLeadRetirementErrorIds] =
    useState<ReadonlySet<string>>(() => new Set());
  const [taskProposal, setTaskProposal] = useState<InboxTaskProposal | null>(null);
  const [taskSaving, setTaskSaving] = useState(false);
  const [taskError, setTaskError] = useState("");
  const [accountSettled, setAccountSettled] = useState(false);
  const analysisAutoStartedRef = useRef(false);
  const analysisInFlightRef = useRef<Promise<InboxAnalysisCoverage | null> | null>(null);
  const analysisMountedRef = useRef(true);
  const reviewQueueRequestIdRef = useRef(0);
  const reviewQueueAutoLoadedRef = useRef(false);
  const reviewQueueRefreshInFlightRef =
    useRef<Promise<InboxReviewQueue | null> | null>(null);
  const markReviewedInFlightRef = useRef(false);
  const [analysisFailed, setAnalysisFailed] = useState(false);
  const [focusReviewRowId, setFocusReviewRowId] = useState<string | null>(null);
  const emptyReviewQueueRef = useRef<HTMLHeadingElement | null>(null);
  const restoreEmptyQueueFocusRef = useRef(false);

  function clearTriageSuggestions() {
    triageRequestIdRef.current += 1;
    setTriageSuggestions({});
    setTriageLoading(false);
  }

  const checkGmailConnection = useCallback((force = false, silent = false) => {
    const request = cachedGetJson<{ workspace?: GmailWorkspaceStatus }>("/api/v1/google-workspace", { force });
    if (!silent) void Promise.resolve().then(() => setChecking(true));
    return request.then((data) => {
      setWorkspace(data.workspace ?? null);
      setError(null);
    }).catch((connectionError) => {
      if (!silent || isTerminalCachedGetError(connectionError)) {
        setWorkspace(null);
        if (isTerminalCachedGetError(connectionError)) {
          setMessages([]);
          setLoadedBucket(null);
          setFilingMessage(null);
          setFilingProjectId("");
          setFilingPreview(null);
          setReplyMessage(null);
          setReplyBody("");
          triageRequestIdRef.current += 1;
          setTriageSuggestions({});
          setTriageLoading(false);
          setTaskProposal(null);
          setTaskError("");
        }
        setError(connectionError instanceof Error ? connectionError.message : "Google Workspace status could not be checked.");
      }
    }).finally(() => {
      if (!silent) setChecking(false);
      setWorkspaceSettled(true);
    });
  }, []);

  useEffect(() => {
    void checkGmailConnection();
  }, [checkGmailConnection]);

  useCachedGetSubscription(
    ["/api/v1/google-workspace"],
    () => void checkGmailConnection(false, true),
  );

  const loadAccountConfiguration = useCallback(() => {
    return Promise.allSettled([
      cachedGetJson<{ preferences?: { replySignature?: unknown }; isAdmin?: unknown }>("/api/v1/settings/me"),
      cachedGetJson<AssistantTriageConfiguration>("/api/v1/assistant/config"),
    ]).then(([accountResult, configurationResult]) => {
      if (accountResult.status === "fulfilled") {
        const data = accountResult.value;
        setReplySignature(typeof data?.preferences?.replySignature === "string" ? data.preferences.replySignature.slice(0, 2_000) : "");
        setIsAdmin(data.isAdmin === true);
      } else if (isTerminalCachedGetError(accountResult.reason)) {
        setReplySignature("");
        setIsAdmin(false);
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
      } else if (
        configurationResult.status === "rejected"
        && isTerminalCachedGetError(configurationResult.reason)
      ) {
        clearTriageSuggestions();
        setTriageConfiguration(null);
      }
      setAccountSettled(true);
    });
  }, []);

  useEffect(() => {
    void loadAccountConfiguration();
    return () => {
      triageRequestIdRef.current += 1;
    };
  }, [loadAccountConfiguration]);

  useCachedGetSubscription(
    ["/api/v1/settings/me", "/api/v1/assistant/config"],
    () => void loadAccountConfiguration(),
  );

  useEffect(() => {
    analysisMountedRef.current = true;
    return () => {
      analysisMountedRef.current = false;
    };
  }, []);

  const gmailReady = workspace?.connectionStatus === "connected" && workspace.gmailEnabled === true && workspace.gmailConnected === true;
  const visibleMessages = loadedBucket === bucket && bucket !== "needs-review" ? messages : [];
  const visibleReviewRows = loadedBucket === bucket && bucket === "needs-review"
    ? reviewRows
    : [];
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
    if (!inboxAnalysisReady) return Promise.resolve(null);
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
        if (analysisMountedRef.current) {
          setAnalysisCoverage(coverage);
          setAnalysisFailed(false);
        }
        invalidateCachedGet("/api/v1/inbox-analysis", { notify: false });
        return coverage;
      } catch {
        if (analysisMountedRef.current) {
          setAnalysisCoverage(null);
          // The queue read that follows can still succeed, so without a durable
          // flag an empty stored queue would render "No messages need review" —
          // a coverage conclusion this sweep never earned.
          setAnalysisFailed(true);
          notify("Inbox analysis could not finish. Use Load messages to try again.", "warning");
        }
        return null;
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

  const loadReviewQueue = useCallback(async (force = false, silent = false) => {
    const requestId = ++reviewQueueRequestIdRef.current;
    if (!silent) {
      setReviewQueueState("loading");
      setError(null);
    }
    try {
      const body = await cachedGetJson<unknown>("/api/v1/inbox-analysis", { force });
      const queue = inboxReviewQueue(body);
      if (!queue) {
        throw new Error("The inbox review queue returned an invalid result.");
      }
      if (requestId !== reviewQueueRequestIdRef.current) return null;
      setReviewLabels(queue.labels);
      setReviewRows(queue.rows);
      setReviewTotalCount(queue.totalCount);
      setFailedAnalysisSummary(
        queue.failedCount === undefined || queue.failedReason === undefined
          ? null
          : Object.freeze({
              count: queue.failedCount,
              reason: queue.failedReason,
            }),
      );
      setLoadedBucket("needs-review");
      setReviewQueueState("ready");
      setError(null);
      return queue;
    } catch (queueError) {
      if (requestId !== reviewQueueRequestIdRef.current) return null;
      if (silent && !isTerminalCachedGetError(queueError)) return null;
      if (isTerminalCachedGetError(queueError)) {
        setReviewLabels([]);
        setReviewRows([]);
        setReviewTotalCount(0);
        setFailedAnalysisSummary(null);
      }
      setLoadedBucket("needs-review");
      setReviewQueueState("unavailable");
      setError(
        queueError instanceof Error
          ? queueError.message
          : "The inbox review queue could not be loaded.",
      );
      return null;
    }
  }, []);

  useCachedGetSubscription(
    ["/api/v1/inbox-analysis"],
    () => void loadReviewQueue(false, true),
    bucket === "needs-review",
  );

  const refreshReviewQueue = useCallback((pageToken?: string) => {
    if (reviewQueueRefreshInFlightRef.current) {
      return reviewQueueRefreshInFlightRef.current;
    }
    const refreshId = ++reviewQueueRequestIdRef.current;
    setReviewQueueState("loading");
    setError(null);
    const request = (async () => {
      if (gmailReady && inboxAnalysisReady) {
        await runInboxAnalysis(pageToken);
      }
      if (refreshId !== reviewQueueRequestIdRef.current) return null;
      return loadReviewQueue();
    })();
    reviewQueueRefreshInFlightRef.current = request;
    void request.finally(() => {
      if (reviewQueueRefreshInFlightRef.current === request) {
        reviewQueueRefreshInFlightRef.current = null;
      }
    });
    return request;
  }, [gmailReady, inboxAnalysisReady, loadReviewQueue, runInboxAnalysis]);

  useEffect(() => {
    if (bucket !== "needs-review") {
      reviewQueueAutoLoadedRef.current = false;
      reviewQueueRequestIdRef.current += 1;
      reviewQueueRefreshInFlightRef.current = null;
    }
    if (bucket === "needs-review") {
      if (!accountSettled || !workspaceSettled || !isAdmin) return;
      if (!reviewQueueAutoLoadedRef.current) {
        reviewQueueAutoLoadedRef.current = true;
        if (gmailReady && inboxAnalysisReady) {
          analysisAutoStartedRef.current = true;
          void Promise.resolve().then(() => refreshReviewQueue());
        } else {
          void Promise.resolve().then(() => loadReviewQueue());
        }
        return;
      }
      if (
        gmailReady
        && inboxAnalysisReady
        && !analysisAutoStartedRef.current
      ) {
        analysisAutoStartedRef.current = true;
        void Promise.resolve().then(() => refreshReviewQueue());
      }
      return;
    }
    if (!gmailReady || !inboxAnalysisReady || analysisAutoStartedRef.current) return;
    analysisAutoStartedRef.current = true;
    void runInboxAnalysis();
  }, [
    accountSettled,
    bucket,
    gmailReady,
    inboxAnalysisReady,
    isAdmin,
    loadReviewQueue,
    refreshReviewQueue,
    runInboxAnalysis,
    workspaceSettled,
  ]);

  async function loadMessages() {
    clearTriageSuggestions();
    setLoading(true);
    setError(null);
    try {
      if (bucket === "needs-review") {
        const queue = await refreshReviewQueue();
        if (queue) {
          notify(
            `Loaded ${queue.totalCount} message${queue.totalCount === 1 ? "" : "s"} from the app review queue.`,
            "info",
          );
        }
        return;
      }
      const parameters = new URLSearchParams({ label: bucket });
      if (search.trim()) parameters.set("q", search.trim());
      // SET42_ACTION_GATED_GMAIL_GET: mailbox contents load only after the user
      // presses Load messages. Focus, visibility, and navigation never subscribe.
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

  async function retryFailedAnalyses() {
    if (
      retryingFailedAnalyses
      || reviewQueueState === "loading"
      || analysisLoading
      || !isAdmin
      || !gmailReady
      || !inboxAnalysisReady
    ) {
      return;
    }
    setRetryingFailedAnalyses(true);
    try {
      const response = await fetch("/api/v1/inbox-analysis", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry-failed-analyses" }),
      });
      const body = await response.json().catch(() => null) as {
        retriedCount?: unknown;
        error?: unknown;
      } | null;
      if (
        !response.ok
        || !body
        || !Number.isSafeInteger(body.retriedCount)
        || Number(body.retriedCount) < 0
      ) {
        throw new Error(
          typeof body?.error === "string"
            ? body.error
            : "Failed inbox analyses could not be retried.",
        );
      }
      const retriedCount = Number(body.retriedCount);
      invalidateCachedGet("/api/v1/inbox-analysis", { notify: false });
      if (retriedCount === 0) {
        await loadReviewQueue();
        notify(
          "No provider-analysis failures were eligible for retry. Gmail read failures remain unchanged.",
          "warning",
        );
        return;
      }
      // A refresh clicked while the PATCH was in flight swept the queue before the
      // reset committed, and refreshReviewQueue would dedupe onto that stale run.
      // Await it out, then start a refresh guaranteed to observe the reset rows —
      // the success toast must describe a sweep that could actually recover them.
      const staleRefresh = reviewQueueRefreshInFlightRef.current;
      if (staleRefresh) await staleRefresh.catch(() => null);
      const queue = await refreshReviewQueue();
      notify(
        queue
          ? `Retried ${retriedCount} failed inbox ${retriedCount === 1 ? "analysis" : "analyses"}. Review any recovered messages before acting.`
          : `Reset ${retriedCount} failed inbox ${retriedCount === 1 ? "analysis" : "analyses"} for retry. The queue will update automatically as recovery finishes.`,
        queue ? "success" : "warning",
      );
    } catch (retryError) {
      notifyError(notify, {
        message: "Failed inbox analyses could not be retried.",
        cause: retryError,
        action: { label: "Try again", run: () => void retryFailedAnalyses() },
      });
    } finally {
      setRetryingFailedAnalyses(false);
    }
  }

  function removeReviewRow(row: InboxReviewQueueRow) {
    // The accepted row unmounts its focused action, so name the next focus
    // target before it goes — the neighbour below, else above, else the
    // empty-state heading. TodayPanel's complete-in-place sets the precedent.
    setReviewRows((current) => {
      const index = current.findIndex((item) => item.id === row.id);
      const remaining = current.filter((item) => item.id !== row.id);
      const next = index >= 0
        ? remaining[index] ?? remaining[index - 1] ?? null
        : null;
      setFocusReviewRowId(next?.id ?? null);
      restoreEmptyQueueFocusRef.current = next === null;
      return remaining;
    });
    setReviewTotalCount((current) => Math.max(0, current - 1));
  }

  async function markReviewed(
    row: InboxReviewQueueRow,
    reason: ReviewRetirementReason = "manual",
  ) {
    if (markReviewedInFlightRef.current) return false;
    markReviewedInFlightRef.current = true;
    const requestId = ++reviewQueueRequestIdRef.current;
    setMarkingReviewId(row.id);
    setLeadRetirementErrorIds((current) => {
      if (!current.has(row.id)) return current;
      const next = new Set(current);
      next.delete(row.id);
      return next;
    });
    try {
      const response = await fetch("/api/v1/inbox-analysis", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // A lead accept retires the row as "accepted"; a hand dismissal as "dismissed".
        // The schedule and warranty accepts already record "accepted" through the task
        // route's atomic retirement, so without this the lead path would be the one
        // typed accept stored as a dismissal — worse than uniform, because the activity
        // view would then show leads as dismissals while showing tasks as accepts.
        body: JSON.stringify({
          id: row.id,
          outcome: reason === "lead-created" ? "accepted" : "dismissed",
        }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "The message could not be marked reviewed.");
      }
      invalidateCachedGet("/api/v1/inbox-analysis", { notify: false });
      if (requestId !== reviewQueueRequestIdRef.current) return false;
      removeReviewRow(row);
      setLeadRetirementErrorIds((current) => {
        if (!current.has(row.id)) return current;
        const next = new Set(current);
        next.delete(row.id);
        return next;
      });
      notify(
        reason === "lead-created"
          ? "Lead created and message removed from the review queue."
          : "Message marked reviewed and removed from the queue.",
        "success",
      );
      await loadReviewQueue();
      return true;
    } catch (reviewError) {
      if (requestId !== reviewQueueRequestIdRef.current) return false;
      if (reason === "lead-created") {
        setLeadRetirementErrorIds((current) => {
          if (current.has(row.id)) return current;
          return new Set(current).add(row.id);
        });
        notifyError(notify, {
          message: "The lead was created, but this message is still in review because it could not be marked reviewed.",
          cause: reviewError,
          action: { label: "Mark reviewed", run: () => void markReviewed(row, "lead-created") },
        });
        // The modal returned focus to the Create lead button, which this error
        // state removes; without naming a target focus lands on <body>. Send it
        // to the row's surviving Mark reviewed button — the action the banner
        // tells the user to take. The ref guard only claims focus if it was lost.
        setFocusReviewRowId(row.id);
      } else {
        notifyError(notify, {
          message: "The message could not be marked reviewed.",
          cause: reviewError,
          action: { label: "Try again", run: () => void markReviewed(row, reason) },
        });
      }
      // This click bumped the request id and so invalidated any refresh already
      // in flight, which returns without touching state. Without this re-sync a
      // failed dismissal can strand the queue in its loading state — both
      // refresh controls disabled, the row undismissable — until a full reload.
      await loadReviewQueue();
      return false;
    } finally {
      markReviewedInFlightRef.current = false;
      setMarkingReviewId(null);
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
      setError("FCI Gmail labels could not be prepared.");
      notifyError(notify, {
        message: "FCI Gmail labels could not be prepared.",
        cause: prepareError,
        action: { label: "Try again", run: () => void prepareLabels() },
      });
    } finally {
      setLoading(false);
    }
  }

  function openFilingReview(message: WorkspaceMessage) {
    setFilingMessage(message);
    setFilingProjectId("");
    setFilingPreview(null);
  }

  function reviewMessage(row: InboxReviewQueueRow): WorkspaceMessage | null {
    if (!row.analysis) return null;
    return {
      id: row.analysis.gmailMessageId,
      from: row.sender,
      subject: row.subject,
      date: row.receivedAt === null
        ? null
        : new Date(row.receivedAt).toISOString(),
      snippet: `Stored analysis: ${row.analysis.rationale}`,
    };
  }

  function acceptProjectUpdate(row: InboxReviewQueueRow) {
    const message = reviewMessage(row);
    if (!message || !row.analysis?.intents.includes("project-update")) return;
    const projectId = projects.some((project) =>
      project.id === row.analysis?.projectId
    )
      ? row.analysis.projectId
      : null;
    if (projectId) {
      acceptTriageSuggestion(message, {
        messageId: row.analysis.gmailMessageId,
        projectId,
        confidence: row.analysis.confidence,
        rationale: row.analysis.rationale,
      });
      return;
    }
    openFilingReview(message);
  }

  function openTaskProposal(row: InboxReviewQueueRow, kind: InboxTaskKind) {
    if (
      !row.analysis
      || !row.analysis.intents.includes(kind)
    ) {
      return;
    }
    const text = taskProposalText(row, kind);
    const projectId = row.analysis.projectId
      && projects.some((project) => project.id === row.analysis?.projectId)
      ? row.analysis.projectId
      : "";
    setTaskProposal({
      row,
      kind,
      title: text.title,
      details: text.details,
      dueDate: "",
      projectId,
    });
    setTaskError("");
  }

  function closeTaskProposal() {
    if (taskSaving) return;
    setTaskProposal(null);
    setTaskError("");
  }

  async function createTaskFromProposal() {
    if (!taskProposal || taskSaving || !taskProposal.row.analysis) return;
    const title = taskProposal.title.replace(/\s+/g, " ").trim();
    if (!title) {
      setTaskError("Enter a task title.");
      return;
    }
    const proposal = taskProposal;
    setTaskSaving(true);
    setTaskError("");
    try {
      const response = await fetch("/api/v1/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          details: proposal.details.trim() || null,
          status: "open",
          dueDate: proposal.dueDate || null,
          projectId: proposal.projectId || null,
          source: "email",
          sourceRef: proposal.row.analysis.gmailMessageId,
          inboxReviewId: proposal.row.id,
          inboxReviewIntent: proposal.kind,
        }),
      });
      const data = await response.json().catch(() => ({})) as {
        task?: { id?: unknown };
        inboxReview?: { id?: unknown; status?: unknown };
        error?: string;
      };
      if (
        !response.ok
        || !data.task
        || typeof data.task.id !== "string"
        || !data.task.id
        || data.inboxReview?.id !== proposal.row.id
        || data.inboxReview?.status !== "accepted"
      ) {
        throw new Error(data.error ?? "The task could not be created.");
      }
      invalidateCachedGet("/api/v1/inbox-analysis", { notify: false });
      invalidateTaskReadCaches();
      setTaskProposal(null);
      removeReviewRow(proposal.row);
      notify(
        proposal.kind === "warranty"
          ? "Warranty callback task created and message removed from the review queue."
          : "Schedule task created and message removed from the review queue.",
        "success",
      );
      await loadReviewQueue();
    } catch (taskCreationError) {
      setTaskError(
        taskCreationError instanceof Error
          ? taskCreationError.message
          : "The task could not be created.",
      );
    } finally {
      setTaskSaving(false);
    }
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
      notifyError(notify, {
        message: "AI filing suggestions could not be prepared.",
        cause: triageError,
        action: { label: "Try again", run: () => void suggestWithAi() },
      });
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
      // SET42_ACTION_GATED_GMAIL_GET: filing preview is a direct review action,
      // not a subscribed data read.
      const response = await fetch(`/api/v1/integrations/google/gmail/messages/${encodeURIComponent(filingMessage.id)}/file?projectId=${encodeURIComponent(filingProjectId)}`);
      const data = await response.json().catch(() => ({})) as GmailFilingPreview & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "The Gmail filing preview could not be loaded.");
      setFilingPreview(data);
      notify(`Review the Drive filing for ${data.project.number}. Nothing has been copied yet.`, "info");
    } catch (previewError) {
      setFilingPreview(null);
      notifyError(notify, { message: "The Gmail filing preview could not be loaded.", cause: previewError, action: { label: "Try preview again", run: () => void previewGmailFiling() } });
    } finally {
      setFilingLoading(false);
    }
  }

  async function confirmGmailFiling() {
    const reviewedMessage = filingMessage;
    const reviewedProjectId = filingProjectId;
    const reviewedPreview = filingPreview;
    if (!reviewedMessage || !reviewedProjectId || !reviewedPreview) return;
    setFilingSubmitting(true);
    try {
      const response = await fetch(`/api/v1/integrations/google/gmail/messages/${encodeURIComponent(reviewedMessage.id)}/file`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: reviewedProjectId }) });
      const data = await response.json().catch(() => ({})) as { filed?: boolean; alreadyFiled?: boolean; archive?: { attachmentCount?: number }; error?: string };
      if (!response.ok) throw new Error(data.error ?? "The Gmail filing could not be completed.");
      notify(data.alreadyFiled ? "This email was already filed to the selected project. Your inbox was left intact." : `Email and ${data.archive?.attachmentCount ?? reviewedPreview.message.attachmentCount} attachment(s) were copied to the selected project. FCI/Filed was added; Inbox remains intact.`, data.alreadyFiled ? "info" : "success");
      setFilingMessage(null);
      setFilingProjectId("");
      setFilingPreview(null);
      invalidateGmailFilingReadCaches({ includeOperations: false });
      await loadMessages();
    } catch (filingError) {
      notifyError(notify, {
        message: "The Gmail filing could not be completed. Review the message and project before trying again.",
        cause: filingError,
        action: {
          label: "Review filing",
          run: () => {
            setFilingMessage(reviewedMessage);
            setFilingProjectId(reviewedProjectId);
            setFilingPreview(null);
          },
        },
      });
    } finally {
      // The route can persist an operations failure even when filing returns non-2xx.
      invalidateWorkspaceOperationsReadCache();
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
      notifyError(notify, {
        message: "Gmail draft could not be saved. The composer remains open so you can review it before trying again.",
        cause: replyError,
        actionlessReason: "Replaying a draft save from a toast can create a duplicate Gmail draft.",
      });
    } finally {
      setReplySaving(false);
    }
  }

  const reviewQueueSelected = bucket === "needs-review";
  const connectionText = workspace?.simulation
    ? "Local Workspace simulation is ready"
    : gmailReady
      ? `Connected Workspace Gmail: ${workspace?.connectionAccount ?? "company mailbox"}`
      : workspace?.requiresReauthorization
        ? "Google Workspace needs to be reconnected to approve Gmail access."
        : "Connect the company Google Workspace account to load messages.";
  const canLoadMessages = gmailReady;
  const queueReadInFlight =
    reviewQueueSelected && reviewQueueState === "loading";

  return <>
    <PageTitle
      eyebrow="Gmail intake"
      title="Gmail project inbox"
      text={reviewQueueSelected
        ? "Rows render from saved snapshots while a bounded sweep checks for newly unanalyzed messages."
        : "Search the company Gmail mailbox—or safe simulated messages—then review and copy each message to one independent project."}
      state={reviewQueueSelected && isAdmin ? "Review queue" : gmailReady ? "In development" : "Setup required"}
      action={<>
        <button className="soft-button" onClick={onRules}>
          <ListFilter size={15} /> Inbox & file rules
        </button>
        {!reviewQueueSelected && !canLoadMessages && <button className="primary-button" onClick={onGoogleSetup}>
          <Building2 size={15} /> Google setup
        </button>}
      </>}
    />
    <section className={`inbox-connection inbox-state-strip ${gmailReady ? "ready" : ""}`}>
      <Mail size={18} />
      <div className="inbox-state-copy">
        <strong>{reviewQueueSelected
          ? "Stored inbox review queue"
          : gmailReady
            ? connectionText
            : "Workspace Gmail connection required"}</strong>
        <span>{reviewQueueSelected
          ? gmailReady
            ? "Stored rows remain available while the bounded sweep checks Gmail for newly unanalyzed messages."
            : "Stored rows remain available. Connect Workspace Gmail to sweep for newly unanalyzed messages."
          : workspace?.simulation
          ? "Sample messages only. No Google account is connected and nothing is sent to Google."
          : gmailReady
            ? "Messages load only after your direct action; filing remains review-first and keeps Inbox."
            : connectionText}</span>
        <span className="inbox-safety-copy">
          <ShieldCheck size={14} />
          Suggestions only: {rules.filter((rule) => rule.enabled).length} enabled rules can recommend a destination, but you must choose the exact project and approve every copy.
        </span>
      </div>
      <div className="inbox-state-actions">
        <button className="soft-button" onClick={onRules}>Manage rules</button>
      </div>
    </section>
    {error && <ClientDataNotice
      state={checking ? "loading" : "error"}
      error={error}
      errorTitle="Gmail connection is unavailable"
      retryLabel="Retry connection"
      loadingTitle="Checking Gmail connection…"
      loadingDetail="Reading the saved Workspace connection without loading Gmail messages."
      titleLevel={2}
      onRetry={() => void checkGmailConnection(true)}
    />}
    <div className="inbox-layout">
      <section className="panel message-list">
        <header className="live-inbox-toolbar">
          <div>
            <label>
              Mailbox
              <select
                value={bucket}
                onChange={(event) => {
                  clearTriageSuggestions();
                  onBucket(event.target.value as InboxBucket);
                }}
                disabled={loading}
              >
                <option value="inbox">Inbox</option>
                <option value="intake">FCI/Intake</option>
                <option value="needs-review">Needs review</option>
                <option value="filed">FCI/Filed</option>
              </select>
            </label>
            {reviewQueueSelected
              ? <small className="gmail-search-help">
                  App review queue · stored subject, sender, and received date
                </small>
              : <>
                  <label>
                    Search this Gmail mailbox
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="e.g. from:vendor@example.com"
                      disabled={loading}
                    />
                  </label>
                  <small className="gmail-search-help">
                    Use Gmail search terms such as <b>from:</b>, <b>subject:</b>, or a project number.
                  </small>
                </>}
          </div>
          <div className="workspace-actions">
            {reviewQueueSelected && accountSettled && isAdmin && reviewQueueState === "ready" && <span className="gmail-search-help">
              {reviewTotalCount} {reviewTotalCount === 1 ? "message needs" : "messages need"} review
            </span>}
            {(analysisLoading || analysisCoverage) && <span className="gmail-search-help" role="status" aria-live="polite">
              {analysisLoading ? "Checking inbox analysis…" : analysisCoverage?.message}
            </span>}
            {reviewQueueSelected && reviewQueueState === "ready" && failedAnalysisSummary && <>
              <span className="gmail-search-help" role="status" aria-live="polite">
                {failedAnalysisSummary.count} {failedAnalysisSummary.count === 1 ? "message" : "messages"} could not be analysed — {failedAnalysisSummary.reason}.
              </span>
              <button
                className="soft-button"
                type="button"
                onClick={() => void retryFailedAnalyses()}
                disabled={
                  retryingFailedAnalyses
                  || analysisLoading
                  || queueReadInFlight
                  || !gmailReady
                  || !inboxAnalysisReady
                }
              >
                <RefreshCw size={15} /> {retryingFailedAnalyses ? "Retrying…" : "Retry failed analyses"}
              </button>
            </>}
            {reviewQueueSelected && analysisFailed && !analysisLoading && <span className="gmail-search-help" role="status" aria-live="polite">
              Inbox analysis did not finish — this list may be incomplete.
            </span>}
            {analysisCoverage?.terminationReason === "older-pending" && <button
              className="soft-button"
              type="button"
              onClick={() => {
                if (analysisLoading || queueReadInFlight) return;
                void (
                  reviewQueueSelected
                    ? refreshReviewQueue(analysisCoverage.nextPageToken ?? undefined)
                    : runInboxAnalysis(analysisCoverage.nextPageToken ?? undefined)
                );
              }}
              aria-busy={analysisLoading || queueReadInFlight}
              aria-disabled={analysisLoading || queueReadInFlight}
            >
              {analysisLoading || queueReadInFlight ? "Checking older…" : "Check older"}
            </button>}
            {!reviewQueueSelected && labelReady === false && bucket !== "inbox" && <button
              className="soft-button"
              onClick={() => void prepareLabels()}
              disabled={loading}
            >
              Prepare FCI labels
            </button>}
            {!reviewQueueSelected && triageReady && <button
              className="soft-button"
              onClick={() => void suggestWithAi()}
              disabled={visibleMessages.length === 0 || loading || triageLoading}
            >
              <Sparkles size={15} /> {triageLoading ? "Suggesting…" : "Suggest with AI"}
            </button>}
            {!reviewQueueSelected && <button
              className="primary-button"
              onClick={() => void loadMessages()}
              disabled={!canLoadMessages || loading}
            >
              {loading ? "Loading…" : "Load messages"}
            </button>}
          </div>
        </header>
        {reviewQueueSelected
          ? !accountSettled
            ? <OperationsEmptyState variant="inbox">
                <Inbox size={25} />
                <h2>Checking review access…</h2>
                <p>The app is confirming whether this Administrator-only queue is available.</p>
              </OperationsEmptyState>
            : !isAdmin
              ? <OperationsEmptyState variant="inbox">
                  <ShieldCheck size={25} />
                  <h2>Administrator review queue</h2>
                  <p>Only an Administrator can review or dismiss stored inbox analyses.</p>
                </OperationsEmptyState>
              : (reviewQueueState === "idle" || reviewQueueState === "loading")
                && visibleReviewRows.length === 0
                ? <OperationsEmptyState variant="inbox">
                    <Inbox size={25} />
                    <h2>Checking the review queue…</h2>
                    <p>Loading stored review rows. A bounded sweep runs only when Gmail and AI analysis are available.</p>
                  </OperationsEmptyState>
                : reviewQueueState === "unavailable" && visibleReviewRows.length === 0
                  ? <OperationsEmptyState variant="inbox" action={<button className="soft-button" type="button" onClick={() => void loadReviewQueue(true)}>Try queue again</button>}>
                      <Inbox size={25} />
                      <h2>Review queue unavailable</h2>
                      <p>Stored review rows could not be read.</p>
                    </OperationsEmptyState>
                  : visibleReviewRows.length === 0
                ? <OperationsEmptyState variant="inbox" action={analysisFailed ? <button className="soft-button" type="button" onClick={() => onBucket("inbox")}>Open Inbox to load messages</button> : undefined}>
                    <Inbox size={25} />
                    <h2
                      tabIndex={-1}
                      ref={(node) => {
                        emptyReviewQueueRef.current = node;
                        if (node && restoreEmptyQueueFocusRef.current) {
                          const active = document.activeElement;
                          if (!active || active === document.body) node.focus();
                          restoreEmptyQueueFocusRef.current = false;
                        }
                      }}
                    >
                      {analysisFailed
                        ? "Review queue may be incomplete"
                        : "No messages need review"}
                    </h2>
                    <p>{analysisFailed
                      ? "Inbox analysis did not finish, so Gmail was not swept. Use Load messages to try again."
                      : analysisCoverage?.message ?? "The newest bounded inbox analysis status updates automatically."}</p>
                  </OperationsEmptyState>
                : visibleReviewRows.map((row, index) => <article className="message-row live-message-row" key={row.id}>
                    <div className={`sender-dot s${index % 4}`}>
                      {(row.sender ?? "?")
                        .split(/[\s@<]+/)
                        .filter(Boolean)
                        .map((part) => part[0])
                        .slice(0, 2)
                        .join("")
                        .toUpperCase()}
                    </div>
                    <div className="message-copy">
                      <strong>{row.sender ?? "Unknown sender"}</strong>
                      <h3>{row.subject ?? "(No subject)"}</h3>
                      <p>Stored analysis · review required</p>
                      {row.analysis && <p>
                        Suggested actions: {row.analysis.intents
                          .map((intent) => reviewIntentLabel(intent, reviewLabels))
                          .join(" · ")}
                      </p>}
                      {leadRetirementErrorIds.has(row.id) && <p role="status">
                        Lead created, but this message is still in review. Use Mark reviewed to retire it when the queue is available.
                      </p>}
                    </div>
                    <div className="message-actions">
                      <span>{inboxDate(row.receivedAt)}</span>
                      <small>App review queue</small>
                      {row.leadProposal && !leadCreatedRowIds.has(row.id) && <button
                        className="soft-button"
                        type="button"
                        onClick={() => {
                          if (markingReviewId !== null) return;
                          onCreateLead(
                            row.leadProposal as InboxLeadProposal,
                            async () => {
                              // Record the lead BEFORE attempting retirement. The
                              // lead exists from this moment on, so the button must
                              // never come back for this row — whether the retire
                              // succeeds, fails, or is retried and fails again.
                              setLeadCreatedRowIds((current) =>
                                current.has(row.id) ? current : new Set(current).add(row.id)
                              );
                              await markReviewed(row, "lead-created");
                            },
                          );
                        }}
                        aria-disabled={markingReviewId !== null}
                        aria-label={`Create lead: ${row.subject ?? row.sender ?? "message"}`}
                      >
                        <Users size={14} />
                        Create lead
                      </button>}
                      {row.analysis?.intents.includes("project-update") && <button
                        className="soft-button"
                        type="button"
                        onClick={() => {
                          if (markingReviewId !== null) return;
                          acceptProjectUpdate(row);
                        }}
                        aria-disabled={markingReviewId !== null}
                        aria-label={`Review project update: ${row.subject ?? row.sender ?? "message"}`}
                      >
                        <FolderOpen size={14} aria-hidden="true" />
                        Review project update
                      </button>}
                      {row.analysis?.intents.includes("schedule")
                        && <button
                          className="soft-button"
                          type="button"
                          onClick={() => {
                            if (markingReviewId !== null) return;
                            openTaskProposal(row, "schedule");
                          }}
                          aria-disabled={markingReviewId !== null}
                          aria-label={`Create schedule task: ${row.subject ?? row.sender ?? "message"}`}
                        >
                          <CalendarClock size={14} aria-hidden="true" />
                          Create schedule task
                        </button>}
                      {row.analysis?.intents.includes("warranty")
                        && <button
                          className="soft-button"
                          type="button"
                          onClick={() => {
                            if (markingReviewId !== null) return;
                            openTaskProposal(row, "warranty");
                          }}
                          aria-disabled={markingReviewId !== null}
                          aria-label={`Create warranty callback task: ${row.subject ?? row.sender ?? "message"}`}
                        >
                          <Wrench size={14} aria-hidden="true" />
                          Create warranty callback task
                        </button>}
                      <button
                        className="soft-button"
                        ref={(node) => {
                          if (node && focusReviewRowId === row.id) {
                            // Only restore focus the dismissal actually dropped.
                            // If the user moved on while the PATCH was in
                            // flight, activeElement is a real element and
                            // stealing it back would be worse than doing
                            // nothing.
                            const active = document.activeElement;
                            if (!active || active === document.body) node.focus();
                            setFocusReviewRowId(null);
                          }
                        }}
                        onClick={() => {
                          if (markingReviewId !== null) return;
                          // A row whose lead was already created retires as "lead-created"
                          // even when the user reaches this button, because the banner sends
                          // them here after a failed retirement and Create lead is gone by
                          // then. Sending the default "manual" would write "dismissed" for a
                          // row that HAS a lead — reintroducing exactly the misreporting the
                          // outcome fix exists to prevent, and irreversibly, since the
                          // adapters guard `status = 'needs-review'` and the row is terminal
                          // after one write.
                          void markReviewed(
                            row,
                            leadCreatedRowIds.has(row.id) ? "lead-created" : "manual",
                          );
                        }}
                        aria-disabled={markingReviewId !== null}
                        aria-label={`Mark reviewed: ${row.subject ?? row.sender ?? "message"}`}
                      >
                        <ShieldCheck size={14} />
                        {markingReviewId === row.id ? "Marking…" : "Mark reviewed"}
                      </button>
                    </div>
                  </article>)
          : !gmailReady
            ? <OperationsEmptyState variant="inbox" action={<button className="primary-button" onClick={onGoogleSetup}>Open Google Workspace setup</button>}>
                <Mail size={25} />
                <h2>Connect Workspace Gmail to see the company inbox</h2>
                <p>Until Workspace is available, switch the local app to Workspace simulation to test the full inbox workflow with sample data.</p>
              </OperationsEmptyState>
            : visibleMessages.length === 0
              ? <OperationsEmptyState variant="inbox">
                  <Inbox size={25} />
                  <h2>{loading ? "Loading your inbox…" : "No messages loaded yet"}</h2>
                  <p>Choose a mailbox, optionally enter a Gmail search, and use the Load messages button above. The view is limited to 20 message summaries.</p>
                </OperationsEmptyState>
              : visibleMessages.map((message, index) => {
                  const suggestion = inboxProjectSuggestion(message, projects, clients, rules);
                  const aiSuggestion = triageSuggestions[message.id];
                  const aiProject = aiSuggestion?.projectId
                    ? projects.find((project) => project.id === aiSuggestion.projectId)
                    : null;
                  return <article className="message-row live-message-row" key={message.id}>
                    <div className={`sender-dot s${index % 4}`}>
                      {(message.from ?? "?").split(/[\s@<]+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}
                    </div>
                    <div className="message-copy">
                      <strong>{message.from ?? "Unknown sender"}</strong>
                      <h3>{message.subject ?? "(No subject)"}</h3>
                      <p>{message.snippet || "No preview available."}</p>
                      <div className={`inbox-project-suggestion ${suggestion.kind}`} title={suggestion.reason} aria-label={`${suggestion.text}. ${suggestion.reason}`}>
                        <ShieldCheck size={13} /> {suggestion.text}
                      </div>
                      {aiSuggestion && <div
                        className={`inbox-project-suggestion ${aiProject ? "project" : "needs-review"}`}
                        title={aiSuggestion.rationale}
                        aria-label={`AI suggestion. ${aiProject ? `${aiProject.number} — ${aiProject.name}` : "No confident project match"}. ${aiSuggestion.confidence} confidence. ${aiSuggestion.rationale}`}
                      >
                        <Sparkles size={13} aria-hidden="true" /> AI suggestion · {aiSuggestion.confidence} · {aiProject ? `${aiProject.number} — ${aiProject.name}` : "No confident project match"}
                        {aiProject && <button
                          className="soft-button"
                          aria-label={`Accept AI suggestion for ${message.subject || "(No subject)"}: ${aiProject.number} — ${aiProject.name}; ${aiSuggestion.confidence} confidence; ${aiSuggestion.rationale}`}
                          onClick={() => acceptTriageSuggestion(message, aiSuggestion)}
                        >
                          Accept
                        </button>}
                      </div>}
                    </div>
                    <div className="message-actions">
                      <span>{inboxDate(message.date)}</span>
                      <small>{message.to ? `To: ${message.to}` : workspace?.simulation ? "Simulated Workspace mailbox" : "Company Workspace mailbox"}</small>
                      <button className="primary-button" onClick={() => openFilingReview(message)}>
                        <FolderOpen size={14} /> Review & copy
                      </button>
                      <button className="soft-button" onClick={() => openReplyComposer(message)}>
                        <Reply size={14} /> Draft reply
                      </button>
                    </div>
                  </article>;
                })}
      </section>
      <aside className="panel inbox-summary">
        <div className="summary-icon"><Mail size={20} /></div>
        <h2>Inbox status</h2>
        <p>{reviewQueueSelected
          ? reviewQueueState === "ready"
            ? `${reviewTotalCount} stored ${reviewTotalCount === 1 ? "message needs" : "messages need"} review.`
            : reviewQueueState === "unavailable"
              ? "The stored review queue is unavailable."
              : "Checking the stored review queue."
          : gmailReady
            ? `Showing ${visibleMessages.length} loaded message${visibleMessages.length === 1 ? "" : "s"} from ${inboxBucketLabels[bucket]}.`
            : "Workspace Gmail is not connected yet."}</p>
        <dl className="inbox-status-list">
          <div>
            <dt>Provider</dt>
            <dd>{reviewQueueSelected ? "App database" : workspace?.simulation ? "Local Workspace simulation" : workspace?.connectionAccount ?? "Not connected"}</dd>
          </div>
          <div>
            <dt>{reviewQueueSelected ? "Queue count" : "Message limit"}</dt>
            <dd>{reviewQueueSelected
              ? reviewQueueState === "ready"
                ? reviewTotalCount
                : "Unavailable"
              : "20 summaries"}</dd>
          </div>
          <div>
            <dt>Filing protection</dt>
            <dd>Exact project required</dd>
          </div>
        </dl>
        <hr />
        <h3>Keep it organized</h3>
        <ul className="inbox-organization">
          <li>FCI/Intake and FCI/Filed remain Gmail labels; Needs review is the app’s stored analysis queue.</li>
          <li>Use project numbers for the safest match.</li>
          <li>Store the permanent email and attachments in that project’s Shared Drive folder.</li>
        </ul>
        <small>{workspace?.simulation ? "Simulation mode · no Google access" : "Google Workspace mode"}</small>
        <small>Inbox is retained after filing</small>
      </aside>
    </div>
    {filingMessage && <GmailFilingModal
      message={filingMessage}
      projects={projects}
      projectId={filingProjectId}
      preview={filingPreview}
      loading={filingLoading}
      submitting={filingSubmitting}
      onProject={(projectId) => {
        setFilingProjectId(projectId);
        setFilingPreview(null);
      }}
      onPreview={previewGmailFiling}
      onConfirm={confirmGmailFiling}
      onClose={closeFilingReview}
    />}
    {taskProposal && <InboxTaskProposalModal
      proposal={taskProposal}
      projects={projects}
      saving={taskSaving}
      error={taskError}
      onChange={(next) => {
        setTaskProposal(next);
        setTaskError("");
      }}
      onSubmit={() => void createTaskFromProposal()}
      onClose={closeTaskProposal}
    />}
    {replyMessage && <GmailReplyModal
      message={replyMessage}
      body={replyBody}
      saving={replySaving}
      onBody={setReplyBody}
      onSave={saveReplyDraft}
      onClose={closeReplyComposer}
    />}
  </>;
}
