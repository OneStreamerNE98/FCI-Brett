import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import {
  acquireWorkspaceSetupLease,
  completeWorkspaceSetupLease,
  failWorkspaceSetupLease,
  googleConnectionLeaseFence,
  type WorkspaceSetupLease,
} from "../../../../../../adapters/d1/workspace-setup-leases";
import { validateWorkspaceMessageInput, validateWorkspaceRecipient } from "../../../../../../lib/google-gmail";
import { writeGoogleIntegrationEvent } from "../../../../../../lib/google-oauth-sites";
import { requireOfficeUser, requireSameOrigin } from "../../../../../../lib/workspace-auth";
import { getWorkspaceGmailClient, gmailErrorResponse, readBoundedJson } from "../_route-helpers";

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return auth.response;

  let lease: WorkspaceSetupLease | null = null;
  try {
    const input = await readBoundedJson(request, 6_000);
    const { config, client } = await getWorkspaceGmailClient(
      request.nextUrl.searchParams.get("mailbox"),
    );
    const recipient = validateWorkspaceRecipient(input.to, config);
    const message = validateWorkspaceMessageInput(input);
    lease = await acquireWorkspaceSetupLease(env.DB, {
      id: crypto.randomUUID(),
      connectionKey: config.connectionKey,
      action: "gmail-send-test",
      scopeKey: "gmail-test-message",
      actor: auth.user.email,
      now: Date.now(),
      connectionFence: googleConnectionLeaseFence(config),
    });
    if (!lease) {
      return NextResponse.json(
        {
          error: "A Gmail test message is already being sent. Try again shortly.",
          code: "gmail_test_send_in_progress",
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    const sent = await client.sendTestMessage({ recipient, ...message });
    await writeGoogleIntegrationEvent(
      config,
      "gmail.test_sent",
      auth.user.email,
      "gmail-message",
      sent.id,
      `recipient=${recipient};mode=${config.environment}`,
    );
    await completeWorkspaceSetupLease(env.DB, lease, Date.now());
    return NextResponse.json(
      { sent: true, recipient, message: sent },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (lease) {
      await failWorkspaceSetupLease(env.DB, lease, "gmail_test_send_failed", Date.now());
    }
    return gmailErrorResponse(error);
  }
}
