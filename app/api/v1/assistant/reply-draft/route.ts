import { env } from "cloudflare:workers";
import { NextRequest } from "next/server";
import type { D1Database } from "../../../../adapters/d1/d1-database";
import { createD1UserPreferencesRepository } from "../../../../adapters/d1/user-preferences-repository";
import { OpenAIResponsesProvider } from "../../../../adapters/openai/responses-provider";
import {
  generateReplyDraft,
  readReplyFilingInputs,
  resolveReplyProjectRecords,
} from "../../../../application/assistant/reply-draft";
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

export const MAX_ASSISTANT_REPLY_DRAFT_BODY_BYTES = 8_000;

function runtimeValue(name: string) {
  return (env as unknown as Record<string, string | undefined>)[name]
    ?? process.env[name];
}

function parseMessageId(body: Record<string, unknown>) {
  if (
    Object.keys(body).length !== 1
    || !Object.hasOwn(body, "messageId")
    || typeof body.messageId !== "string"
  ) {
    return null;
  }
  try {
    return validateGmailMessageId(body.messageId.trim());
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return noStoreResponse(originError);
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return noStoreResponse(auth.response);
  const rateLimitResponse = enforceDevelopmentRequestRateLimit("assistant", auth.user.email);
  if (rateLimitResponse) return noStoreResponse(rateLimitResponse);

  const parsed = await parseBoundedJsonObject(request, {
    maximumBytes: MAX_ASSISTANT_REPLY_DRAFT_BODY_BYTES,
    invalidMessage: "Choose one loaded Gmail message to draft a reply for.",
    tooLargeMessage: "Reply draft request is too large.",
  });
  if (!parsed.ok) return noStoreJson({ error: parsed.error }, parsed.status);
  const messageId = parseMessageId(parsed.body);
  if (!messageId) {
    return noStoreJson(
      { error: "Choose one loaded Gmail message to draft a reply for." },
      400,
    );
  }

  await ensureWorkspaceSchema();
  const database = env.DB as unknown as D1Database;
  const environment = env as unknown as Record<string, string | undefined>;
  const configuration = await readSitesAssistantConfiguration(database, environment);
  if (configuration.keyState === "Missing") {
    return noStoreJson(
      {
        error: "Reply drafting requires a configured AI provider key.",
        code: "assistant_key_missing",
      },
      503,
    );
  }
  if (!configuration.features.replyDrafts) {
    return noStoreJson(
      { error: "Reply drafting is turned off in AI settings." },
      403,
    );
  }

  try {
    const { client } = await getWorkspaceGmailClient();
    // Read-only Gmail: the server-derived reply context (recipient/subject/thread)
    // and a bounded, untrusted text/plain body extraction. This route NEVER
    // creates, sends, labels, or modifies a Gmail draft or message — the human
    // uses the separate Save draft action for the only Gmail write.
    const context = await client.getReplyContext(messageId);
    const emailBody = await client.getMessageBodyText(messageId);
    // The same bounded {from, subject, snippet} view the inbox filing surfaces
    // evaluate. The full untrusted body is deliberately NOT fed into rule
    // matching — the existing call sites match on the snippet only.
    const summary = await client.getMessageSummary(messageId);
    if (request.signal.aborted) {
      throw request.signal.reason ?? new Error("AI reply draft request aborted.");
    }
    const [preferences, filing] = await Promise.all([
      createD1UserPreferencesRepository(database).findByEmail(auth.user.email),
      readReplyFilingInputs(database),
    ]);
    // Saved records are joined through the shared filing-rules evaluator: an
    // exact project number or a known contact with one eligible project. Any
    // ambiguous message yields null, and the draft keeps [...] placeholders.
    const records = resolveReplyProjectRecords({
      message: {
        from: summary.from,
        subject: summary.subject,
        snippet: summary.snippet,
      },
      filing,
    });
    const runtime = assistantRuntimeConfiguration(environment);
    const apiKey = runtimeValue("OPENAI_API_KEY");
    if (!apiKey) {
      return noStoreJson(
        {
          error: "Reply drafting requires a configured AI provider key.",
          code: "assistant_key_missing",
        },
        503,
      );
    }
    const draft = await generateReplyDraft({
      context: { subject: context.subject, recipient: context.recipient },
      emailBody,
      records,
      signature: preferences?.replySignature?.trim() || null,
      provider: new OpenAIResponsesProvider({ apiKey, model: runtime.model }),
      signal: request.signal,
    });
    if (!draft) {
      return noStoreJson(
        { error: "AI reply drafting is temporarily unavailable." },
        503,
      );
    }
    return noStoreJson({ draft });
  } catch (error) {
    if (request.signal.aborted) throw error;
    return noStoreResponse(gmailErrorResponse(error));
  }
}
