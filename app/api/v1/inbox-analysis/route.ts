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
  type GoogleGmailClient,
  type GmailMessageAnalysisInput,
  type GmailMessageSummary,
} from "../../../lib/google-gmail";
import { noStoreJson, noStoreResponse } from "../../../lib/no-store-json";
import {
  simulationInboxAnalysisFixture,
  type WorkspaceSimulationGmailClient,
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
}>;

type SweepResult = Readonly<{
  terminationReason: "caught-up" | "older-pending";
  message: typeof CAUGHT_UP_MESSAGE | typeof OLDER_PENDING_MESSAGE;
  nextPageToken?: string;
}>;

type InboxAnalysisGmailClient = Pick<
  GoogleGmailClient | WorkspaceSimulationGmailClient,
  "listMessages" | "getMessageAnalysisInput"
>;

type InboxAnalysisWorkspace = Readonly<{
  config: Readonly<{
    simulation: boolean;
    connectionKey: string;
  }>;
  client: InboxAnalysisGmailClient;
}>;

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
) {
  const result = await repository.upsert(item);
  if (
    result.outcome === "saved"
    || result.outcome === "terminal-preserved"
  ) return;
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
  const fallback = await repository.upsert(withoutStaleReferences);
  if (
    fallback.outcome !== "saved"
    && fallback.outcome !== "terminal-preserved"
  ) {
    throw new Error("Inbox analysis could not persist a relationship-safe row.");
  }
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
}) {
  const attempts = input.existing?.attemptedLabelDefinitionVersion
      === INBOX_ANALYSIS_LABEL_DEFINITION_VERSION
    ? Math.min(
        MAX_MAIL_ITEM_FAILURE_ATTEMPTS,
        input.existing.failureAttempts + 1,
      )
    : 1;
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
    errorCode: preservesReview ? null : input.errorCode,
  }));
  return attempts;
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
  await saveMailItem(input.repository, normalizeStoredMailItem({
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
  }));
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
      item.attemptedLabelDefinitionVersion
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
  let hitWatermark = false;
  let exhausted = false;
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
    const page = await client.listMessages({
      labelId: "INBOX",
      ...(pageToken ? { pageToken } : {}),
      mode: "sweep",
    });
    pagesRead += 1;
    const summaries = new Map(page.messages.map((message) => [message.id, message]));

    for (const messageId of page.messageIds) {
      if (work.length >= MAX_INBOX_ANALYSIS_MESSAGES) break;
      if (scheduled.has(messageId)) continue;
      const existing = await repository.findByGmailMessageId(
        config.connectionKey,
        messageId,
      );
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
      return;
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
      });
      return;
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
      return;
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
      analysis = config.simulation
        ? simulationAnalysis(message, projects)
        : await analyzeInboxMessage({
            message,
            projects,
            provider: provider!,
            signal: effectiveSignal,
          });
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
      return;
    }
    await saveAnalysis({
      repository,
      connectionKey: config.connectionKey,
      analysisInput,
      analysis,
      existing: item.existing,
      contentHash,
      now: checkedAt,
    });
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
          });
          continue;
        }
        try {
          await processWork(work[workIndex]);
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

  const coverageComplete = hitWatermark || exhausted;
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
    ...(continuationToken ? { nextPageToken: continuationToken } : {}),
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
  const rateLimitResponse = enforceDevelopmentRequestRateLimit(
    "assistant",
    auth.user.email,
  );
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
    }));
  } catch (error) {
    if (request.signal.aborted) throw error;
    return noStoreResponse(gmailErrorResponse(error));
  }
}
