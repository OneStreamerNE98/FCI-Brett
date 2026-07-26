import { env } from "cloudflare:workers";
import { NextRequest } from "next/server";

import type { D1Database } from "../../../../../adapters/d1/d1-database";
import { createD1FirstRunImportRepository } from "../../../../../adapters/d1/first-run-import-repository";
import { projectSegmentFromClientIndustry } from "../../../../../domain/project-segment";
import { noStoreJson, noStoreResponse } from "../../../../../lib/no-store-json";
import { requireOfficeUser } from "../../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../../_workspace-data";

const FIRST_RUN_IMPORT_CLIENT_SEARCH_LIMIT = 20;

function normalizedClientSearchQuery(value: string | null) {
  const query = value?.normalize("NFKC").trim().replace(/\s+/gu, " ") ?? "";
  if (
    query.length < 2
    || query.length > 100
    || /[\u0000-\u001f\u007f]/u.test(query)
  ) {
    return null;
  }
  return query;
}

function normalizedMatchValue(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return noStoreResponse(auth.response);

  const query = normalizedClientSearchQuery(
    request.nextUrl.searchParams.get("q"),
  );
  if (!query) {
    return noStoreJson({
      error: "Client search must be between 2 and 100 characters.",
    }, 400);
  }

  try {
    await ensureWorkspaceSchema();
    const repository = createD1FirstRunImportRepository(
      env.DB as unknown as D1Database,
    );
    const snapshot = await repository.snapshot();
    const match = normalizedMatchValue(query);
    const matches = snapshot.clients.filter((client) => (
      normalizedMatchValue(client.clientCode).includes(match)
      || normalizedMatchValue(client.name).includes(match)
      || client.sourceClientCodes.some((code) => (
        normalizedMatchValue(code).includes(match)
      ))
      || client.emails.some((email) => (
        normalizedMatchValue(email).includes(match)
      ))
    ));
    const results = matches
      .slice(0, FIRST_RUN_IMPORT_CLIENT_SEARCH_LIMIT)
      .map((client) => Object.freeze({
        id: client.id,
        code: client.clientCode,
        name: client.name,
        ...(client.emails[0] ? { email: client.emails[0] } : {}),
        defaultSegment: projectSegmentFromClientIndustry(client.industry),
      }));

    return noStoreJson({
      query,
      results,
      more: matches.length > FIRST_RUN_IMPORT_CLIENT_SEARCH_LIMIT,
    });
  } catch {
    return noStoreJson({
      error: "Saved clients could not be searched.",
    }, 500);
  }
}
