import { env } from "cloudflare:workers";
import { NextRequest } from "next/server";
import type { D1Database } from "../../../adapters/d1/d1-database";
import { createD1MailItemRepository } from "../../../adapters/d1/mail-item-repository";
import {
  acquireWorkspaceSetupLease,
  completeWorkspaceSetupLease,
  failWorkspaceSetupLease,
  type WorkspaceSetupLease,
} from "../../../adapters/d1/workspace-setup-leases";
import { OpenAIResponsesProvider } from "../../../adapters/openai/responses-provider";
import {
  analyzeInboxMessage,
  eligibleInboxAnalysisProjects,
  INBOX_ANALYSIS_LABEL_DEFINITION_VERSION,
  parseAssistantInboxAnalysis,
  type InboxAnalysis,
  type InboxAnalysisMessage,
  type InboxAnalysisProjectCandidate,
} from "../../../application/assistant/inbox-analysis";
import {
  isMailItemRelationshipId,
  MAX_MAIL_ITEM_FAILURE_ATTEMPTS,
  normalizeStoredMailItem,
  type MailItem,
} from "../../../domain/mail-item";
import {
  assistantRuntimeConfiguration,
  readSitesAssistantConfiguration,
} from "../../../lib/assistant-config-sites";
import { parseBoundedJsonObject } from "../../../lib/api-json-body";
import { enforceDevelopmentRequestRateLimit } from "../../../lib/development-request-rate-limit";
import {
  normalizeGmailPageToken,
  type GmailMessageAnalysisInput,
  type GmailMessageListPage,
  type GmailMessageSummary,
} from "../../../lib/google-gmail";
import { queueGoogleChatNotification } from "../../../lib/google-chat-notifier-sites";
import { getGoogleRuntimeConfig } from "../../../lib/google-oauth-sites";
import { noStoreJson, noStoreResponse } from "../../../lib/no-store-json";
import {
  simulationInboxAnalysisFixture,
} from "../../../lib/workspace-simulation";
import type { AssistantProvider } from "../../../ports/assistant-provider";
import { requireOfficeUser, requireSameOrigin } from "../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../_workspace-data";
import {
  getWorkspaceGmailClient,
  gmailErrorResponse,
} from "../integrations/google/gmail/_route-helpers";

export const MAX_INBOX_ANALYSIS_BODY_BYTES = 8_000;
export const MAX_INBOX_ANALYSIS_PAGES = 5;
export const MAX_INBOX_ANALYSIS_MESSAGES = 100;
export const MAX_INBOX_ANALYSIS_PROVIDER_CALLS_PER_DAY = 200;
export const INBOX_ANALYSIS_PROVIDER_CONCURRENCY = 4;
export const INBOX_ANALYSIS_SWEEP_DEADLINE_MS = 55_000;

const CAUGHT_UP_MESSAGE = "You're caught up";
const OLDER_PENDING_MESSAGE = "Older messages not yet analyzed";

type ProjectCandidateRow = {
  id: string;
  client_id: string | null;
  project_number: string;
  name: string;
  client_name: string;
  status: string | null;
};

type AnalysisWork = Readonly<{
  messageId: string;
  summary: GmailMessageSummary | null;
  existing: MailItem | null;
  discoveryError?: "analysis_state_read_failed";
}>;

type SweepResult = Readonly<{
  terminationReason: "caught-up" | "older-pending";
  message: typeof CAUGHT_UP_MESSAGE | typeof OLDER_PENDING_MESSAGE;
  nextPageToken?: string;
}>;

type InboxAnalysisGmailClient = Readonly<{
  listMessages(input: {
    labelId: string;
    pageToken?: string;
    mode: "sweep";
  }): Promise<GmailMessageListPage>;
  getMessageAnalysisInput(
    messageId: string,
  ): Promise<GmailMessageAnalysisInput>;
}>;

type InboxAnalysisWorkspace = Readonly<{
  config: Readonly<{
    simulation: boolean;
    connectionKey: string;
  }>;
  client: InboxAnalysisGmailClient;
}>;

type NeedsReviewArrival = Readonly<{
  gmailMessageId: string;
  subject: string;
  receivedAt: number | null;
}>;

type NeedsReviewNotification = Readonly<{
  gmailMessageId: string;
  subject: string;
  count: number;
}>;

/** Newest subject first, then the remainder as a count, inside the notifier's
 * 180-character summary budget. One card per sweep, never one per message. */
export function coalescedReviewSubject(subject: string, count: number) {
  const newest = subject.length > 120 ? `${subject.slice(0, 119)}…` : subject;
  return count > 1 ? `${newest} · plus ${count - 1} more need review` : newest;
}

function runtimeValue(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
) {
  return environment[name] ?? process.env[name];
}

function parseSweepRequest(body: Record<string, unknown>) {
  const keys = Object.keys(body);
  if (
    keys.length > 1
    || keys.some((key) => key !== "pageToken")
    || (Object.hasOwn(body, "pageToken") && typeof body.pageToken !== "string")
  ) {
    return null;
  }
  try {
    return Object.freeze({
      pageToken: normalizeGmailPageToken(
        typeof body.pageToken === "string" ? body.pageToken : undefined,
      ),
    });
  } catch {
    return null;
  }
}

function parseMarkReviewedRequest(body: Record<string, unknown>) {
  if (
    Object.keys(body).length !== 1
    || typeof body.id !== "string"
    || !body.id.trim()
    || body.id.length > 512
    || /[\u0000-\u001f\u007f]/.test(body.id)
  ) {
    return null;
  }
  return Object.freeze({ id: body.id });
}

function singleLineSnapshot(value: string | null, maximum: number) {
  if (!value) return null;
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
  return normalized || null;
}

function receivedAt(value: string | null) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export async function reserveInboxAnalysisProviderCall(
  database: D1Database,
  input: {
    connectionKey: string;
    messageId: string;
    actor: string;
    now: number;
  },
) {
  const dayStart = Math.floor(input.now / 86_400_000) * 86_400_000;
  const dayEnd = dayStart + 86_400_000;
  const action = "assistant.inbox_analysis_provider_call";
  const detail = JSON.stringify({
    connectionKey: singleLineSnapshot(input.connectionKey, 512),
    gmailMessageId: singleLineSnapshot(input.messageId, 512),
  });
  const result = await database
    .prepare(
      `INSERT INTO activity_events (
         id, record_id, action, actor, detail, created_at
       )
       SELECT ?, ?, ?, ?, ?, ?
       WHERE (
         SELECT COUNT(*)
         FROM activity_events
         WHERE action = ?
           AND created_at >= ?
           AND created_at < ?
       ) < ?`,
    )
    .bind(
      crypto.randomUUID(),
      `inbox-analysis:${input.messageId}`,
      action,
      input.actor,
      detail,
      input.now,
      action,
      dayStart,
      dayEnd,
      MAX_INBOX_ANALYSIS_PROVIDER_CALLS_PER_DAY,
    )
    .run();
  return result.meta.changes === 1;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function analysisContent(
  input: GmailMessageAnalysisInput,
) {
  return JSON.stringify({
    messageId: input.summary.id,
    from: input.summary.from,
    subject: input.summary.subject,
    date: input.summary.date,
    snippet: input.summary.snippet,
    body: input.bodyText,
  });
}

async function readProjectCandidates(
  database: D1Database,
): Promise<InboxAnalysisProjectCandidate[]> {
  const result = await database
    .prepare(
      `SELECT p.id, p.client_id, p.project_number, p.name, p.status,
              c.name AS client_name
       FROM projects p
       JOIN clients c ON c.id = p.client_id
       WHERE LOWER(TRIM(COALESCE(p.status, ''))) NOT IN (
         'closeout', 'completed', 'cancelled', 'archived'
       )
       ORDER BY p.updated_at DESC
       LIMIT 100`,
    )
    .all<ProjectCandidateRow>();
  return eligibleInboxAnalysisProjects(
    result.results.map((row) => ({
      id: row.id,
      clientId: row.client_id,
      number: row.project_number,
      name: row.name,
      client: row.client_name,
      status: row.status,
    })),
  );
}

async function isAlreadyFiled(
  database: D1Database,
  connectionKey: string,
  messageId: string,
) {
  const row = await database
    .prepare(
      `SELECT id
       FROM gmail_file_archives
       WHERE connection_key = ?
         AND gmail_message_id = ?
         AND status = 'filed'
       LIMIT 1`,
    )
    .bind(connectionKey, messageId)
    .first<{ id: string }>();
  return Boolean(row?.id);
}

function rowBase(input: {
  connectionKey: string;
  messageId: string;
  summary: GmailMessageSummary | null;
  existing: MailItem | null;
  now: number;
}) {
  const { existing, summary } = input;
  return {
    id: existing?.id ?? crypto.randomUUID(),
    connectionKey: input.connectionKey,
    gmailMessageId: input.messageId,
    gmailThreadId: singleLineSnapshot(
      summary?.threadId ?? existing?.gmailThreadId ?? null,
      512,
    ),
    approvedProjectId: existing?.approvedProjectId ?? null,
    emailDriveFileId: existing?.emailDriveFileId ?? null,
    subject: singleLineSnapshot(
      summary?.subject ?? existing?.subject ?? null,
      500,
    ),
    sender: singleLineSnapshot(
      summary?.from ?? existing?.sender ?? null,
      500,
    ),
    receivedAt: summary
      ? receivedAt(summary.date)
      : existing?.receivedAt ?? null,
    coverageComplete: existing?.coverageComplete ?? false,
    attemptedLabelDefinitionVersion:
      existing?.attemptedLabelDefinitionVersion ?? null,
    createdAt: existing?.createdAt ?? input.now,
    updatedAt: input.now,
  } as const;
}

async function saveMailItem(
  repository: ReturnType<typeof createD1MailItemRepository>,
  item: MailItem,
  mode: "upsert" | "insert-if-absent" = "upsert",
) {
  const result = mode === "insert-if-absent"
    ? await repository.insertIfAbsent(item)
    : await repository.upsert(item);
  if (result.outcome === "saved") return true;
  if (
    result.outcome === "existing-preserved"
    || result.outcome === "terminal-preserved"
  ) return false;
  // A project/client can be removed between the candidate SELECT and the
  // guarded repository write. Preserve the analysis row and its watermark,
  // but never retain a relationship the database could not verify.
  const withoutStaleReferences = normalizeStoredMailItem({
    ...item,
    clientId: null,
    suggestedProjectId: null,
    approvedProjectId: result.outcome === "approved-project-not-found"
      ? null
      : item.approvedProjectId,
  });
  const fallback = mode === "insert-if-absent"
    ? await repository.insertIfAbsent(withoutStaleReferences)
    : await repository.upsert(withoutStaleReferences);
  if (fallback.outcome === "saved") return true;
  if (
    fallback.outcome !== "existing-preserved"
    && fallback.outcome !== "terminal-preserved"
  ) {
    throw new Error("Inbox analysis could not persist a relationship-safe row.");
  }
  return false;
}

async function saveSkipped(input: {
  repository: ReturnType<typeof createD1MailItemRepository>;
  connectionKey: string;
  messageId: string;
  summary: GmailMessageSummary | null;
  existing: MailItem | null;
  reason: "already-filed" | "list-unsubscribe";
  contentHash: string | null;
  now: number;
}) {
  await saveMailItem(input.repository, normalizeStoredMailItem({
    ...rowBase(input),
    clientId: null,
    suggestedProjectId: null,
    status: "skipped-noise",
    matchReason: input.reason === "already-filed"
      ? "Already filed to a project."
      : "List-Unsubscribe marks this message as deterministic mailing-list noise.",
    analysisPayload: { skippedReason: input.reason },
    party: null,
    confidence: null,
    contentHash: input.contentHash,
    labelDefinitionVersion: INBOX_ANALYSIS_LABEL_DEFINITION_VERSION,
    attemptedLabelDefinitionVersion: null,
    failureAttempts: 0,
    errorCode: null,
  }));
}

async function saveFailure(input: {
  repository: ReturnType<typeof createD1MailItemRepository>;
  connectionKey: string;
  messageId: string;
  summary: GmailMessageSummary | null;
  existing: MailItem | null;
  errorCode: string;
  now: number;
  countsAgainstAttemptBudget?: boolean;
}) {
  const existingAttempts =
    input.existing?.attemptedLabelDefinitionVersion
        === INBOX_ANALYSIS_LABEL_DEFINITION_VERSION
      ? input.existing.failureAttempts
      : 0;
  const attempts = input.countsAgainstAttemptBudget === false
    ? Math.max(1, existingAttempts)
    : Math.min(
        MAX_MAIL_ITEM_FAILURE_ATTEMPTS,
        existingAttempts + 1,
      );
  const preservesReview = input.existing?.status === "needs-review";
  await saveMailItem(input.repository, normalizeStoredMailItem({
    ...rowBase(input),
    clientId: preservesReview ? input.existing?.clientId ?? null : null,
    suggestedProjectId: preservesReview
      ? input.existing?.suggestedProjectId ?? null
      : null,
    status: preservesReview ? "needs-review" : "failed",
    matchReason: preservesReview
      ? input.existing?.matchReason ?? null
      : "Inbox analysis did not complete.",
    analysisPayload: preservesReview
      ? input.existing?.analysisPayload ?? null
      : null,
    party: preservesReview ? input.existing?.party ?? null : null,
    confidence: preservesReview
      ? input.existing?.confidence ?? null
      : null,
    contentHash: input.existing?.contentHash ?? null,
    labelDefinitionVersion: preservesReview
      ? input.existing?.labelDefinitionVersion ?? null
      : INBOX_ANALYSIS_LABEL_DEFINITION_VERSION,
    attemptedLabelDefinitionVersion:
      INBOX_ANALYSIS_LABEL_DEFINITION_VERSION,
    failureAttempts: attempts,
    errorCode: input.errorCode,
  }));
  return attempts;
}

async function saveDiscoveryFailure(input: {
  repository: ReturnType<typeof createD1MailItemRepository>;
  connectionKey: string;
  messageId: string;
  summary: GmailMessageSummary | null;
  now: number;
}) {
  const item = normalizeStoredMailItem({
    ...rowBase({
      ...input,
      existing: null,
    }),
    clientId: null,
    suggestedProjectId: null,
    status: "failed",
    matchReason: "Inbox analysis state could not be read.",
    analysisPayload: null,
    party: null,
    confidence: null,
    contentHash: null,
    labelDefinitionVersion: INBOX_ANALYSIS_LABEL_DEFINITION_VERSION,
    attemptedLabelDefinitionVersion:
      INBOX_ANALYSIS_LABEL_DEFINITION_VERSION,
    failureAttempts: 1,
    errorCode: "analysis_state_read_failed",
  });
  const result = await input.repository.insertIfAbsent(item);
  if (
    result.outcome !== "saved"
    && result.outcome !== "existing-preserved"
  ) {
    throw new Error(
      "Inbox analysis could not preserve an unread watermark row.",
    );
  }
}

async function saveAnalysis(input: {
  repository: ReturnType<typeof createD1MailItemRepository>;
  connectionKey: string;
  analysisInput: GmailMessageAnalysisInput;
  analysis: InboxAnalysis;
  existing: MailItem | null;
  contentHash: string;
  now: number;
}) {
  const relationshipProjectId = isMailItemRelationshipId(input.analysis.projectId)
    ? input.analysis.projectId
    : null;
  const relationshipClientId = isMailItemRelationshipId(input.analysis.clientId)
    ? input.analysis.clientId
    : null;
  const item = normalizeStoredMailItem({
    ...rowBase({
      connectionKey: input.connectionKey,
      messageId: input.analysisInput.summary.id,
      summary: input.analysisInput.summary,
      existing: input.existing,
      now: input.now,
    }),
    clientId: relationshipClientId,
    suggestedProjectId: relationshipProjectId,
    status: "needs-review",
    matchReason: input.analysis.rationale,
    analysisPayload: input.analysis,
    party: input.analysis.party,
    confidence: input.analysis.confidence,
    contentHash: input.contentHash,
    labelDefinitionVersion: INBOX_ANALYSIS_LABEL_DEFINITION_VERSION,
    attemptedLabelDefinitionVersion: null,
    failureAttempts: 0,
    errorCode: null,
  });
  const saved = await saveMailItem(
    input.repository,
    item,
    input.existing ? "upsert" : "insert-if-absent",
  );
  return Object.freeze({
    item,
    inserted: input.existing === null && saved,
    // A message "arrives" in the queue whenever a write moves it into
    // needs-review from anywhere else — a first insert, or a recovery from a
    // failed row (deadline, abort, Gmail read, daily cap). Only a row that was
    // already needs-review is a refresh and owes no notification.
    enteredReview: saved
      && (input.existing === null || input.existing.status !== "needs-review"),
  });
}

function needsReanalysis(item: MailItem) {
  return item.status === "needs-review"
    && item.labelDefinitionVersion !== INBOX_ANALYSIS_LABEL_DEFINITION_VERSION
    && (
      item.attemptedLabelDefinitionVersion
        !== INBOX_ANALYSIS_LABEL_DEFINITION_VERSION
      || item.failureAttempts < MAX_MAIL_ITEM_FAILURE_ATTEMPTS
    );
}

function needsRetry(item: MailItem) {
  return item.status === "failed"
    && (
      item.errorCode === "analysis_daily_limit_reached"
      || item.attemptedLabelDefinitionVersion
        !== INBOX_ANALYSIS_LABEL_DEFINITION_VERSION
      || item.failureAttempts < MAX_MAIL_ITEM_FAILURE_ATTEMPTS
    );
}

function simulationAnalysis(
  message: InboxAnalysisMessage,
  projects: readonly InboxAnalysisProjectCandidate[],
) {
  const fixture = simulationInboxAnalysisFixture(message.id);
  return fixture
    ? parseAssistantInboxAnalysis(fixture, message, projects)
    : null;
}

async function hasOutstandingBacklog(
  repository: ReturnType<typeof createD1MailItemRepository>,
  connectionKey: string,
) {
  return (
    await repository.listRetryableAnalysisRows(
      connectionKey,
      INBOX_ANALYSIS_LABEL_DEFINITION_VERSION,
      1,
    )
  ).length > 0;
}

export async function runInboxAnalysisSweep(input: {
  database: D1Database;
  environment: Readonly<Record<string, string | undefined>>;
  featureEnabled: boolean;
  pageToken?: string;
  signal: AbortSignal;
  actor: string;
  now?: () => number;
  workspace?: InboxAnalysisWorkspace;
  provider?: AssistantProvider;
  onNeedsReviewBatch?: (notification: NeedsReviewNotification) => void;
}): Promise<SweepResult> {
  // The reusable sweep owns the kill switch as well as the HTTP route. A
  // future trigger cannot accidentally reach Gmail, OpenAI, or mail_items by
  // bypassing only the route-level check.
  if (!input.featureEnabled) {
    throw new Error("Inbox analysis is turned off in AI settings.");
  }
  const repository = createD1MailItemRepository(input.database);
  const { config, client } = input.workspace ?? await getWorkspaceGmailClient();
  const now = input.now ?? Date.now;
  let lease: WorkspaceSetupLease | null = await acquireWorkspaceSetupLease(
    input.database,
    {
      id: crypto.randomUUID(),
      connectionKey: config.connectionKey,
      action: "inbox-analysis",
      scopeKey: "gmail-inbox",
      actor: input.actor,
      now: now(),
    },
  );
  if (!lease) {
    return Object.freeze({
      terminationReason: "older-pending",
      message: OLDER_PENDING_MESSAGE,
    });
  }

  try {
  const projects = await readProjectCandidates(input.database);
  const runtime = assistantRuntimeConfiguration(input.environment);
  const apiKey = runtimeValue(input.environment, "OPENAI_API_KEY");
  const provider = !config.simulation && apiKey
    ? input.provider ?? new OpenAIResponsesProvider({ apiKey, model: runtime.model })
    : null;
  if (!config.simulation && !provider) {
    throw new Error("The configured AI provider key is unavailable.");
  }

  const backlog = await repository.listRetryableAnalysisRows(
    config.connectionKey,
    INBOX_ANALYSIS_LABEL_DEFINITION_VERSION,
    MAX_INBOX_ANALYSIS_MESSAGES,
  );
  const scheduled = new Set(backlog.map((item) => item.gmailMessageId));
  const work: AnalysisWork[] = backlog.map((existing) => ({
    messageId: existing.gmailMessageId,
    summary: null,
    existing,
  }));

  let pageToken = input.pageToken;
  let continuationToken: string | null = pageToken ?? null;
  let continuationMessageIds: ReadonlySet<string> | null = null;
  const durableProgressMessageIds = new Set<string>();
  let hitWatermark = false;
  let exhausted = false;
  let discoveryFailed = false;
  let pagesRead = 0;
  const pageBudget = Math.max(
    0,
    Math.min(
      MAX_INBOX_ANALYSIS_PAGES,
      Math.floor((MAX_INBOX_ANALYSIS_MESSAGES - work.length) / 20),
    ),
  );

  while (
    pagesRead < pageBudget
    && work.length < MAX_INBOX_ANALYSIS_MESSAGES
    && !hitWatermark
  ) {
    let page: GmailMessageListPage;
    try {
      page = await client.listMessages({
        labelId: "INBOX",
        ...(pageToken ? { pageToken } : {}),
        mode: "sweep",
      });
    } catch {
      // Work discovered on earlier pages is still durable even when the next
      // Gmail page cannot be read. Return its token for one bounded retry.
      discoveryFailed = true;
      continuationToken = pageToken ?? continuationToken;
      break;
    }
    pagesRead += 1;
    const summaries = new Map(page.messages.map((message) => [message.id, message]));

    for (const messageId of page.messageIds) {
      if (work.length >= MAX_INBOX_ANALYSIS_MESSAGES) break;
      if (scheduled.has(messageId)) continue;
      let existing: MailItem | null;
      try {
        existing = await repository.findByGmailMessageId(
          config.connectionKey,
          messageId,
        );
      } catch {
        // This message was returned by Gmail and therefore crossed the sweep
        // watermark. Give it its own durable failed row instead of aborting
        // previously discovered work.
        scheduled.add(messageId);
        work.push({
          messageId,
          summary: summaries.get(messageId) ?? null,
          existing: null,
          discoveryError: "analysis_state_read_failed",
        });
        continue;
      }
      if (existing) {
        if (
          (needsReanalysis(existing) || needsRetry(existing))
          && !scheduled.has(messageId)
        ) {
          scheduled.add(messageId);
          work.push({
            messageId,
            summary: summaries.get(messageId) ?? null,
            existing,
          });
          continue;
        }
        if (existing.coverageComplete) {
          hitWatermark = true;
          break;
        }
        // An already-current row is durable state for this page, so a sweep
        // resuming an interrupted bootstrap can still advance past it.
        durableProgressMessageIds.add(messageId);
        continue;
      }
      scheduled.add(messageId);
      work.push({
        messageId,
        summary: summaries.get(messageId) ?? null,
        existing: null,
      });
    }

    continuationToken = page.nextPageToken;
    continuationMessageIds = page.nextPageToken
      ? new Set(page.messageIds)
      : null;
    if (hitWatermark) break;
    if (!page.nextPageToken) {
      exhausted = true;
      break;
    }
    pageToken = page.nextPageToken;
  }

  const deadline = AbortSignal.timeout(INBOX_ANALYSIS_SWEEP_DEADLINE_MS);
  const effectiveSignal = AbortSignal.any([input.signal, deadline]);
  let nextWorkIndex = 0;
  const needsReviewArrivals: NeedsReviewArrival[] = [];

  const processWork = async (item: AnalysisWork) => {
    const checkedAt = now();
    if (await isAlreadyFiled(input.database, config.connectionKey, item.messageId)) {
      await saveSkipped({
        repository,
        connectionKey: config.connectionKey,
        messageId: item.messageId,
        summary: item.summary,
        existing: item.existing,
        reason: "already-filed",
        contentHash: item.existing?.contentHash ?? null,
        now: checkedAt,
      });
      return true;
    }
    if (item.discoveryError) {
      await saveDiscoveryFailure({
        repository,
        connectionKey: config.connectionKey,
        messageId: item.messageId,
        summary: item.summary,
        now: checkedAt,
      });
      return false;
    }

    let analysisInput: GmailMessageAnalysisInput;
    try {
      analysisInput = await client.getMessageAnalysisInput(item.messageId);
    } catch {
      await saveFailure({
        repository,
        connectionKey: config.connectionKey,
        messageId: item.messageId,
        summary: item.summary,
        existing: item.existing,
        errorCode: "gmail_read_failed",
        now: checkedAt,
        // Deliberately counted. An exempt read failure is pinned at one attempt
        // forever, and a message deleted from Gmail 404s on every future read —
        // so the row would sit in the retry backlog permanently, block
        // "caught-up" for good, and once enough accumulate consume the whole
        // page budget and stop new mail being discovered at all.
      });
      return false;
    }
    const contentHash = await sha256(analysisContent(analysisInput));
    if (analysisInput.listUnsubscribe) {
      await saveSkipped({
        repository,
        connectionKey: config.connectionKey,
        messageId: item.messageId,
        summary: analysisInput.summary,
        existing: item.existing,
        reason: "list-unsubscribe",
        contentHash,
        now: checkedAt,
      });
      return true;
    }

    const message: InboxAnalysisMessage = {
      id: analysisInput.summary.id,
      from: analysisInput.summary.from,
      subject: analysisInput.summary.subject,
      snippet: analysisInput.summary.snippet,
      body: analysisInput.bodyText,
    };
    let analysis: InboxAnalysis | null = null;
    try {
      if (config.simulation) {
        analysis = simulationAnalysis(message, projects);
      } else {
        const reserved = await reserveInboxAnalysisProviderCall(
          input.database,
          {
            connectionKey: config.connectionKey,
            messageId: item.messageId,
            actor: input.actor,
            now: checkedAt,
          },
        );
        if (!reserved) {
          await saveFailure({
            repository,
            connectionKey: config.connectionKey,
            messageId: item.messageId,
            summary: analysisInput.summary,
            existing: item.existing,
            errorCode: "analysis_daily_limit_reached",
            now: checkedAt,
            countsAgainstAttemptBudget: false,
          });
          return false;
        }
        analysis = await analyzeInboxMessage({
          message,
          projects,
          provider: provider!,
          signal: effectiveSignal,
        });
      }
    } catch {
      analysis = null;
    }
    if (!analysis) {
      await saveFailure({
        repository,
        connectionKey: config.connectionKey,
        messageId: item.messageId,
        summary: analysisInput.summary,
        existing: item.existing,
        errorCode: deadline.aborted
          ? "analysis_deadline_exceeded"
          : "analysis_failed",
        now: checkedAt,
      });
      return false;
    }
    const saved = await saveAnalysis({
      repository,
      connectionKey: config.connectionKey,
      analysisInput,
      analysis,
      existing: item.existing,
      contentHash,
      now: checkedAt,
    });
    // The pre-filter's isAlreadyFiled ran before the Gmail read and the provider
    // call, so a person can file this message while the analysis is in flight.
    // The filing batch would have updated zero rows (this row did not exist
    // yet), and a current needs-review row is never re-swept, so the message
    // would sit in the queue forever. Re-check after the write: whichever of the
    // two paths commits second retires the row, so every interleaving converges.
    // Everything here runs AFTER the analysis is durably committed, so it must
    // not throw: the worker's catch would call saveFailure with the pre-sweep
    // snapshot, whose preservesReview is false, overwriting the paid-for
    // analysis with a bare failed row. A failure here leaves the committed
    // needs-review row standing, and the emit-time re-read still re-verifies
    // before any card is sent.
    try {
      if (await isAlreadyFiled(input.database, config.connectionKey, item.messageId)) {
        await saveSkipped({
          repository,
          connectionKey: config.connectionKey,
          messageId: item.messageId,
          summary: analysisInput.summary,
          existing: saved.item,
          reason: "already-filed",
          contentHash,
          now: checkedAt,
        });
        return true;
      }
    } catch {
      return true;
    }
    if (saved.enteredReview) {
      needsReviewArrivals.push({
        gmailMessageId: saved.item.gmailMessageId,
        subject: saved.item.subject ?? "Message subject unavailable",
        receivedAt: saved.item.receivedAt ?? null,
      });
    }
    return true;
  };

  const workers = Array.from(
    {
      length: Math.min(INBOX_ANALYSIS_PROVIDER_CONCURRENCY, work.length),
    },
    async () => {
      while (nextWorkIndex < work.length) {
        const workIndex = nextWorkIndex;
        nextWorkIndex += 1;
        if (input.signal.aborted || deadline.aborted) {
          await saveFailure({
            repository,
            connectionKey: config.connectionKey,
            messageId: work[workIndex].messageId,
            summary: work[workIndex].summary,
            existing: work[workIndex].existing,
            errorCode: input.signal.aborted
              ? "analysis_request_aborted"
              : "analysis_deadline_exceeded",
            now: now(),
            // Neither abort kind reached Gmail or the provider for this item,
            // so it must not consume the three durable analysis attempts.
            countsAgainstAttemptBudget: false,
          });
          continue;
        }
        try {
          if (await processWork(work[workIndex])) {
            durableProgressMessageIds.add(work[workIndex].messageId);
          }
        } catch {
          // Keep one durable row for a swept message even if a pre-filter,
          // content hash, normalization, or first persistence attempt fails.
          // If storage itself is unavailable this retry still fails closed and
          // the route reports an error rather than claiming coverage.
          await saveFailure({
            repository,
            connectionKey: config.connectionKey,
            messageId: work[workIndex].messageId,
            summary: work[workIndex].summary,
            existing: work[workIndex].existing,
            errorCode: "analysis_item_failed",
            now: now(),
          });
        }
      }
    },
  );
  await Promise.all(workers);

  // One card per sweep, not one per message: a bootstrap sweep can move up to
  // MAX_INBOX_ANALYSIS_MESSAGES rows into review at once, and a card apiece
  // would burst the office space the moment an administrator opens the Inbox.
  // Arrivals are collected as each worker finishes, but the card is emitted
  // once here, so filing can retire a row in between. Re-read the queue state
  // at emit time: a card must describe the queue as it is now, and its count
  // must match. A row that cannot be re-read is kept — a card pointing at a
  // queue is recoverable, a silently dropped one is not.
  const pendingArrivals = [];
  for (const arrival of needsReviewArrivals) {
    let current;
    try {
      current = await repository.findByGmailMessageId(
        config.connectionKey,
        arrival.gmailMessageId,
      );
    } catch {
      pendingArrivals.push(arrival);
      continue;
    }
    if (!current || current.status === "needs-review") pendingArrivals.push(arrival);
  }
  if (pendingArrivals.length > 0 && input.onNeedsReviewBatch) {
    const newest = pendingArrivals.reduce((leader, candidate) =>
      (candidate.receivedAt ?? 0) > (leader.receivedAt ?? 0) ? candidate : leader
    );
    try {
      input.onNeedsReviewBatch({
        gmailMessageId: newest.gmailMessageId,
        subject: coalescedReviewSubject(
          newest.subject,
          pendingArrivals.length,
        ),
        count: pendingArrivals.length,
      });
    } catch {
      // Chat delivery is advisory. A notification failure cannot undo or
      // misreport the durable review rows that were already committed.
    }
  }

  const coverageComplete = !discoveryFailed && (hitWatermark || exhausted);
  if (coverageComplete) {
    await repository.markCoverageComplete(config.connectionKey);
  }
  const outstanding = await hasOutstandingBacklog(
    repository,
    config.connectionKey,
  );
  if (coverageComplete && !outstanding) {
    const result = Object.freeze({
      terminationReason: "caught-up",
      message: CAUGHT_UP_MESSAGE,
    } as const);
    await completeWorkspaceSetupLease(input.database, lease, now());
    lease = null;
    return result;
  }
  const result = Object.freeze({
    terminationReason: "older-pending",
    message: OLDER_PENDING_MESSAGE,
    // Withhold the token only for a fetched page that produced no durable
    // outcome, so an all-failed page cannot spin. A sweep that read no page
    // (a full backlog or a first-page discovery failure) keeps the caller's
    // token, and a page of already-analyzed rows still advances.
    ...(continuationToken
      && (continuationMessageIds === null
        || [...continuationMessageIds].some((messageId) =>
          durableProgressMessageIds.has(messageId)
        ))
      ? { nextPageToken: continuationToken }
      : {}),
  } as const);
  await completeWorkspaceSetupLease(input.database, lease, now());
  lease = null;
  return result;
  } catch (error) {
    if (lease) {
      try {
        await failWorkspaceSetupLease(
          input.database,
          lease,
          "inbox_analysis_failed",
          now(),
        );
      } catch {
        // Preserve the primary error; the established five-minute TTL safely
        // makes an unreleased lease reclaimable.
      }
    }
    throw error;
  }
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return noStoreResponse(originError);
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return noStoreResponse(auth.response);
  const rateLimitResponse = enforceDevelopmentRequestRateLimit("inbox-analysis", auth.user.email);
  if (rateLimitResponse) return noStoreResponse(rateLimitResponse);

  const parsed = await parseBoundedJsonObject(request, {
    maximumBytes: MAX_INBOX_ANALYSIS_BODY_BYTES,
    invalidMessage: "Inbox analysis continuation must be a valid JSON object.",
    tooLargeMessage: "Inbox analysis continuation is too large.",
  });
  if (!parsed.ok) return noStoreJson({ error: parsed.error }, parsed.status);
  const sweepRequest = parseSweepRequest(parsed.body);
  if (!sweepRequest) {
    return noStoreJson(
      { error: "Inbox analysis continuation is invalid." },
      400,
    );
  }

  await ensureWorkspaceSchema();
  const database = env.DB as unknown as D1Database;
  const environment = env as unknown as Record<string, string | undefined>;
  const configuration = await readSitesAssistantConfiguration(
    database,
    environment,
  );
  if (configuration.keyState === "Missing") {
    return noStoreJson(
      {
        error: "Inbox analysis requires a configured AI provider key.",
        code: "assistant_key_missing",
      },
      503,
    );
  }
  if (!configuration.features.inboxAnalysis) {
    return noStoreJson(
      { error: "Inbox analysis is turned off in AI settings." },
      403,
    );
  }

  try {
    return noStoreJson(await runInboxAnalysisSweep({
      database,
      environment,
      featureEnabled: configuration.features.inboxAnalysis,
      actor: auth.user.email,
      ...(sweepRequest.pageToken
        ? { pageToken: sweepRequest.pageToken }
        : {}),
      signal: request.signal,
      onNeedsReviewBatch: (notification) => {
        queueGoogleChatNotification(
          {
            eventType: "gmail.filing_review_needed",
            entityId: notification.gmailMessageId,
            subject: notification.subject,
          },
          auth.user.email,
          request.nextUrl.origin,
        );
      },
    }));
  } catch (error) {
    if (request.signal.aborted) throw error;
    return noStoreResponse(gmailErrorResponse(error));
  }
}

function reviewQueueRow(item: MailItem) {
  return Object.freeze({
    id: item.id,
    subject: item.subject,
    sender: item.sender,
    receivedAt: item.receivedAt,
  });
}

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return noStoreResponse(auth.response);

  try {
    await ensureWorkspaceSchema();
    const database = env.DB as unknown as D1Database;
    const repository = createD1MailItemRepository(database);
    const connectionKey = getGoogleRuntimeConfig().connectionKey;
    const page = await repository.listByStatusPage(
      connectionKey,
      "needs-review",
      500,
    );
    return noStoreJson({
      rows: page.items.map(reviewQueueRow),
      totalCount: page.totalCount,
    });
  } catch {
    return noStoreJson(
      { error: "The inbox review queue could not be loaded." },
      500,
    );
  }
}

export async function PATCH(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return noStoreResponse(originError);
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return noStoreResponse(auth.response);
  const rateLimitResponse = enforceDevelopmentRequestRateLimit(
    "inbox-analysis",
    auth.user.email,
  );
  if (rateLimitResponse) return noStoreResponse(rateLimitResponse);

  const parsed = await parseBoundedJsonObject(request, {
    maximumBytes: MAX_INBOX_ANALYSIS_BODY_BYTES,
    invalidMessage: "Inbox review update must be a valid JSON object.",
    tooLargeMessage: "Inbox review update is too large.",
  });
  if (!parsed.ok) return noStoreJson({ error: parsed.error }, parsed.status);
  const update = parseMarkReviewedRequest(parsed.body);
  if (!update) {
    return noStoreJson({ error: "Choose one valid inbox review row." }, 400);
  }

  try {
    await ensureWorkspaceSchema();
    const database = env.DB as unknown as D1Database;
    const repository = createD1MailItemRepository(database);
    const connectionKey = getGoogleRuntimeConfig().connectionKey;
    const dismissed = await repository.dismissNeedsReview(
      update.id,
      connectionKey,
      Date.now(),
    );
    if (!dismissed) {
      return noStoreJson({ error: "Inbox review row not found." }, 404);
    }
    return noStoreJson({ id: update.id, status: "dismissed" });
  } catch {
    return noStoreJson(
      { error: "Inbox review row could not be marked reviewed." },
      500,
    );
  }
}
