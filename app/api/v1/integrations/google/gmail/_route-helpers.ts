import { NextResponse } from "next/server";
import { GoogleGmailClient, assertWorkspaceGmailConnection } from "../../../../../lib/google-gmail";
import { GoogleIntegrationError, assertGoogleService, getGoogleAccessToken, getGoogleRuntimeConfig, type GoogleRuntimeConfig } from "../../../../../lib/google-oauth-sites";
import { WorkspaceSimulationGmailClient } from "../../../../../lib/workspace-simulation";
import { ensureWorkspaceSchema } from "../../../_workspace-data";

export function gmailErrorResponse(error: unknown) {
  if (error instanceof GoogleIntegrationError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  return NextResponse.json({ error: "The Workspace Gmail integration could not complete that request." }, { status: 500 });
}

export async function getWorkspaceGmailClient(): Promise<{ config: GoogleRuntimeConfig; client: GoogleGmailClient | WorkspaceSimulationGmailClient }> {
  await ensureWorkspaceSchema();
  const config = getGoogleRuntimeConfig();
  assertWorkspaceGmailConnection(config);
  assertGoogleService(config, "gmail");
  if (config.simulation) return { config, client: new WorkspaceSimulationGmailClient() };
  const accessToken = await getGoogleAccessToken(config, "gmail");
  return { config, client: new GoogleGmailClient(accessToken) };
}

export async function readBoundedJson(request: Request, maximumBytes: number) {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new GoogleIntegrationError("request_too_large", "That request is too large.", 413);
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maximumBytes) {
    throw new GoogleIntegrationError("request_too_large", "That request is too large.", 413);
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new GoogleIntegrationError("invalid_request", "Send a valid JSON object.", 400);
  }
}
