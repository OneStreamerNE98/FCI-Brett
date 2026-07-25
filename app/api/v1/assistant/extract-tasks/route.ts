import { env } from "cloudflare:workers";
import { NextRequest } from "next/server";
import type { D1Database } from "../../../../adapters/d1/d1-database";
import { OpenAIResponsesProvider } from "../../../../adapters/openai/responses-provider";
import {
  extractTaskProposals,
  readMeetingTaskSource,
  recordsOnlyTaskProposals,
} from "../../../../application/assistant/extract-tasks";
import {
  assistantRuntimeConfiguration,
  readSitesAssistantConfiguration,
} from "../../../../lib/assistant-config-sites";
import { parseBoundedJsonObject } from "../../../../lib/api-json-body";
import { enforceDevelopmentRequestRateLimit } from "../../../../lib/development-request-rate-limit";
import { noStoreJson as noStore, noStoreResponse } from "../../../../lib/no-store-json";
import {
  requireOfficeUser,
  requireSameOrigin,
} from "../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../_workspace-data";

export const MAX_TASK_EXTRACTION_BODY_BYTES = 8_000;

const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function runtimeValue(name: string) {
  return (env as unknown as Record<string, string | undefined>)[name]
    ?? process.env[name];
}

function knownOfficeEmails(actorEmail: string) {
  // FCI_ADMIN_EMAILS grants a role only after workspace-auth has separately
  // admitted that identity through the office email/domain allowlist. It is
  // therefore not an assignee allowlist by itself.
  return [...new Set([
    actorEmail,
    ...(runtimeValue("FCI_OFFICE_EMAILS") ?? "").split(","),
  ].map((email) => email.trim().toLowerCase()).filter((email) => (
    email.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  )))].slice(0, 100);
}

function validInput(body: Record<string, unknown>) {
  if (
    Object.keys(body).length !== 2
    || !Object.hasOwn(body, "projectId")
    || !Object.hasOwn(body, "meetingId")
  ) {
    return null;
  }
  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  const meetingId = typeof body.meetingId === "string" ? body.meetingId.trim() : "";
  return IDENTIFIER_PATTERN.test(projectId) && IDENTIFIER_PATTERN.test(meetingId)
    ? { projectId, meetingId }
    : null;
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return noStoreResponse(originError);
  const auth = requireOfficeUser(request);
  if ("response" in auth) return noStoreResponse(auth.response);
  const rateLimitResponse = enforceDevelopmentRequestRateLimit("assistant", auth.user.email);
  if (rateLimitResponse) return noStoreResponse(rateLimitResponse);

  const parsed = await parseBoundedJsonObject(request, {
    maximumBytes: MAX_TASK_EXTRACTION_BODY_BYTES,
    invalidMessage: "Task extraction details must be valid JSON.",
    tooLargeMessage: "Task extraction request is too large.",
  });
  if (!parsed.ok) return noStore({ error: parsed.error }, { status: parsed.status });
  const input = validInput(parsed.body);
  if (!input) {
    return noStore(
      { error: "Choose one valid project meeting to review." },
      { status: 400 },
    );
  }

  await ensureWorkspaceSchema();
  const database = env.DB as unknown as D1Database;
  const meeting = await readMeetingTaskSource(
    database,
    input.projectId,
    input.meetingId,
  );
  if (!meeting) {
    return noStore(
      { error: "Meeting not found for this project." },
      { status: 404 },
    );
  }

  const environment = env as unknown as Record<string, string | undefined>;
  const configuration = await readSitesAssistantConfiguration(
    database,
    environment,
  );
  const fallback = recordsOnlyTaskProposals(meeting);
  if (configuration.keyState === "Missing") {
    return noStore({
      mode: "records-only",
      proposals: fallback,
      cause: "The OpenAI API key is missing. Showing saved meeting action items instead.",
    });
  }
  if (!configuration.features.taskExtraction) {
    return noStore(
      { error: "Task extraction is turned off in AI settings." },
      { status: 403 },
    );
  }

  const runtime = assistantRuntimeConfiguration(environment);
  const apiKey = runtimeValue("OPENAI_API_KEY");
  const provider = apiKey
    ? new OpenAIResponsesProvider({ apiKey, model: runtime.model })
    : null;
  const proposals = provider
    ? await extractTaskProposals({
        meeting,
        knownOfficeEmails: knownOfficeEmails(auth.user.email),
        provider,
        signal: request.signal,
      }).catch((error) => {
        if (request.signal.aborted) throw error;
        return null;
      })
    : null;

  if (!proposals) {
    return noStore({
      mode: "records-only",
      proposals: fallback,
      cause: "AI task extraction is unavailable. Showing saved meeting action items instead.",
    });
  }
  return noStore({
    mode: "ai-assisted",
    proposals,
    cause: null,
  });
}
