import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { OpenAIResponsesProvider } from "../../../adapters/openai/responses-provider";
import {
  answerProjectQuestion,
  answerQuestion,
  boundedFallbackSearch,
} from "../../../application/assistant/answer-question";
import { fallbackAnswer } from "../../../application/assistant/fallback-answer";
import {
  orgWideFallbackFromEvidence,
  searchResultEvidence,
} from "../../../application/assistant/org-wide-fallback";
import { projectEvidence } from "../../../application/assistant/project-evidence";
import { createAssistantToolRegistry } from "../../../application/assistant/tools";
import {
  normalizeSearchQuery,
  searchRecords,
} from "../../../application/search-records";
import { parseBoundedJsonObject } from "../../../lib/api-json-body";
import { enforceDevelopmentRequestRateLimit } from "../../../lib/development-request-rate-limit";
import { getGoogleRuntimeConfig } from "../../../lib/google-oauth-sites";
import { requireOfficeUser, requireSameOrigin } from "../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../_workspace-data";

function runtimeValue(name: string) {
  return (env as unknown as Record<string, string | undefined>)[name]
    ?? process.env[name];
}

function noStore(body: unknown, init: ResponseInit = {}) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function noStoreResponse(response: Response) {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function provider() {
  const apiKey = runtimeValue("OPENAI_API_KEY");
  return apiKey
    ? new OpenAIResponsesProvider({
        apiKey,
        model: runtimeValue("OPENAI_MODEL") ?? "gpt-5.4",
      })
    : null;
}

async function fallbackSearchEvidence(question: string) {
  let query: string | null = null;
  try {
    query = normalizeSearchQuery(question.slice(0, 100));
  } catch {
    query = null;
  }
  const results = query ? await searchRecords(env.DB, query) : [];
  return results.map(searchResultEvidence);
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return noStoreResponse(originError);
  const auth = requireOfficeUser(request);
  if ("response" in auth) return noStoreResponse(auth.response);
  const rateLimitResponse = enforceDevelopmentRequestRateLimit("assistant", auth.user.email);
  if (rateLimitResponse) return noStoreResponse(rateLimitResponse);
  const parsed = await parseBoundedJsonObject(request, {
    maximumBytes: 9_000,
    invalidMessage: "question is required",
    tooLargeMessage: "Question request is too large.",
  });
  if (!parsed.ok) return noStore({ error: parsed.error }, { status: parsed.status });
  const question = typeof parsed.body.question === "string"
    ? parsed.body.question.trim()
    : "";
  const hasProjectId = Object.hasOwn(parsed.body, "projectId");
  const projectId = typeof parsed.body.projectId === "string"
    ? parsed.body.projectId.trim()
    : "";
  if (!question) {
    return noStore({ error: "question is required" }, { status: 400 });
  }
  if (question.length > 2_000 || /[\u0000-\u001f\u007f]/.test(question)) {
    return noStore(
      { error: "question is too long or contains invalid characters" },
      { status: 413 },
    );
  }
  if (hasProjectId && !/^[A-Za-z0-9_-]{1,128}$/.test(projectId)) {
    return noStore(
      { error: "Choose one project before asking the assistant." },
      { status: 400 },
    );
  }

  await ensureWorkspaceSchema();
  const google = getGoogleRuntimeConfig();
  const assistantProvider = provider();

  if (hasProjectId) {
    const context = await projectEvidence(
      env.DB,
      google.connectionKey,
      projectId,
      { includeFinancials: true },
    );
    if (!context) {
      return noStore(
        { error: "Project not found." },
        { status: 404 },
      );
    }
    const fallback = fallbackAnswer(
      question,
      context.project,
      context.evidence,
      context.totals,
      context.primaryContact,
      context.meetings,
    );
    const model = assistantProvider
      ? await answerProjectQuestion({
          question,
          projectNumber: context.project.project_number,
          projectName: context.project.name,
          evidence: context.evidence,
          provider: assistantProvider,
          signal: request.signal,
        }).catch(() => null)
      : null;
    return noStore(
      model
        ? {
            mode: "ai-grounded",
            answer: model.answer,
            citations: model.citations,
            missingEvidence: model.missingEvidence,
          }
        : fallback,
    );
  }

  const tools = createAssistantToolRegistry({
    database: env.DB,
    connectionKey: google.connectionKey,
    isAdmin: auth.user.isAdmin,
  });
  const modelOutcome = assistantProvider
    ? await answerQuestion({
        question,
        provider: assistantProvider,
        tools,
        fallbackSearch: () => fallbackSearchEvidence(question),
        signal: request.signal,
      }).catch(() => ({
        answer: null,
        toolExecutions: 6,
        searchedRecords: true,
        searchEvidence: [],
        fallbackEvidence: [],
      }))
    : {
        answer: null,
        toolExecutions: 1,
        searchedRecords: true,
        searchEvidence: [],
        fallbackEvidence: await boundedFallbackSearch({
          search: () => fallbackSearchEvidence(question),
          signal: request.signal,
        }).catch(() => []),
      };
  const model = modelOutcome?.answer ?? null;
  const payload = model
    ? {
        mode: "ai-grounded" as const,
        answer: model.answer,
        citations: model.citations,
        missingEvidence: model.missingEvidence,
      }
    : orgWideFallbackFromEvidence(question, modelOutcome.fallbackEvidence);
  return noStore(payload);
}
