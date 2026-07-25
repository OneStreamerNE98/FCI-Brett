import { env } from "cloudflare:workers";
import { NextRequest } from "next/server";
import type { D1Database } from "../../../../adapters/d1/d1-database";
import { OpenAIResponsesProvider } from "../../../../adapters/openai/responses-provider";
import {
  ASSISTANT_TRIAGE_MESSAGE_LIMIT,
  readTriageProjectCandidates,
  suggestInboxTriage,
} from "../../../../application/assistant/triage";
import {
  assistantRuntimeConfiguration,
  readSitesAssistantConfiguration,
} from "../../../../lib/assistant-config-sites";
import { parseBoundedJsonObject } from "../../../../lib/api-json-body";
import { enforceDevelopmentRequestRateLimit } from "../../../../lib/development-request-rate-limit";
import { validateGmailMessageId } from "../../../../lib/google-gmail";
import { noStoreJson, noStoreResponse } from "../../../../lib/no-store-json";
import { requireOfficeUser, requireSameOrigin } from "../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../_workspace-data";
import {
  getWorkspaceGmailClient,
  gmailErrorResponse,
} from "../../integrations/google/gmail/_route-helpers";

export const MAX_ASSISTANT_TRIAGE_BODY_BYTES = 8_000;

function runtimeValue(name: string) {
  return (env as unknown as Record<string, string | undefined>)[name]
    ?? process.env[name];
}

function parseMessageIds(body: Record<string, unknown>) {
  if (
    Object.keys(body).length !== 1
    || !Object.hasOwn(body, "messageIds")
    || !Array.isArray(body.messageIds)
    || body.messageIds.length < 1
    || body.messageIds.length > ASSISTANT_TRIAGE_MESSAGE_LIMIT
  ) {
    return null;
  }
  const messageIds: string[] = [];
  try {
    for (const value of body.messageIds) {
      if (typeof value !== "string") return null;
      const messageId = validateGmailMessageId(value.trim());
      if (messageIds.includes(messageId)) return null;
      messageIds.push(messageId);
    }
  } catch {
    return null;
  }
  return messageIds.length > 0 ? messageIds : null;
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return noStoreResponse(originError);
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return noStoreResponse(auth.response);
  const rateLimitResponse = enforceDevelopmentRequestRateLimit("assistant", auth.user.email);
  if (rateLimitResponse) return noStoreResponse(rateLimitResponse);

  const parsed = await parseBoundedJsonObject(request, {
    maximumBytes: MAX_ASSISTANT_TRIAGE_BODY_BYTES,
    invalidMessage: "Choose up to 20 loaded Gmail messages.",
    tooLargeMessage: "AI triage request is too large.",
  });
  if (!parsed.ok) return noStoreJson({ error: parsed.error }, parsed.status);
  const messageIds = parseMessageIds(parsed.body);
  if (!messageIds) {
    return noStoreJson(
      { error: "Choose between 1 and 20 loaded Gmail messages." },
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
        error: "Inbox filing suggestions require a configured AI provider key.",
        code: "assistant_key_missing",
      },
      503,
    );
  }
  if (!configuration.features.triage) {
    return noStoreJson(
      { error: "Inbox filing suggestions are turned off in AI settings." },
      403,
    );
  }

  try {
    const [{ client }, projects] = await Promise.all([
      getWorkspaceGmailClient(),
      readTriageProjectCandidates(database),
    ]);
    // Isolate every summary fetch so one deleted or inaccessible message (listed,
    // then removed before "Suggest with AI") cannot reject the whole batch and
    // mask the other messages' suggestions. Failed fetches drop out; the rest
    // proceed. Exactly one summary call-site per message is preserved.
    const summaries = await Promise.allSettled(
      messageIds.map((messageId) => client.getMessageSummary(messageId)),
    );
    if (request.signal.aborted) {
      throw request.signal.reason ?? new Error("AI triage request aborted.");
    }
    const messages = summaries.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    const runtime = assistantRuntimeConfiguration(environment);
    const apiKey = runtimeValue("OPENAI_API_KEY");
    if (!apiKey) {
      return noStoreJson(
        {
          error: "Inbox filing suggestions require a configured AI provider key.",
          code: "assistant_key_missing",
        },
        503,
      );
    }
    const suggestions = await suggestInboxTriage({
      messages,
      projects,
      provider: new OpenAIResponsesProvider({
        apiKey,
        model: runtime.model,
      }),
      signal: request.signal,
    });
    if (suggestions.length === 0) {
      return noStoreJson(
        { error: "AI filing suggestions are temporarily unavailable." },
        503,
      );
    }
    return noStoreJson({ suggestions });
  } catch (error) {
    if (request.signal.aborted) throw error;
    return noStoreResponse(gmailErrorResponse(error));
  }
}
