import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { ensureWorkspaceSchema } from "../_workspace-data";
import { requireOfficeUser } from "../../../lib/workspace-auth";
import {
  normalizeSearchQuery,
  searchRecords,
} from "../../../application/search-records";

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  let query: string | null;
  try {
    query = normalizeSearchQuery(request.nextUrl.searchParams.get("q"));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Search term is invalid." }, { status: 400 });
  }
  if (!query) return NextResponse.json({ results: [] }, { headers: { "Cache-Control": "no-store" } });

  const results = await searchRecords(env.DB, query);
  return NextResponse.json({ query, results }, { headers: { "Cache-Control": "no-store" } });
}
