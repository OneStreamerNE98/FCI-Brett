import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import {
  acquireWorkspaceSetupLease,
  completeWorkspaceSetupLease,
  failWorkspaceSetupLease,
  googleConnectionLeaseFence,
  type WorkspaceSetupLease,
} from "../../../../../../../../adapters/d1/workspace-setup-leases";
import { validateGmailMessageId, validateReplyDraftBody, validateReplyRecipient } from "../../../../../../../../lib/google-gmail";
import { writeGoogleIntegrationEvent } from "../../../../../../../../lib/google-oauth-sites";
import { requireOfficeUser, requireSameOrigin } from "../../../../../../../../lib/workspace-auth";
import { getWorkspaceGmailClient, gmailErrorResponse, readBoundedJson } from "../../../_route-helpers";

/**
 * Saves an unsent Workspace Gmail draft in the source thread. Simulation mode
 * stores the draft only in local simulation state and never contacts Google.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ messageId: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return auth.response;
  let lease: WorkspaceSetupLease | null = null;
  try {
    const body = await readBoundedJson(request, 7_000);
    const { messageId } = await context.params;
    const safeMessageId = validateGmailMessageId(messageId);
    const replyBody = validateReplyDraftBody(body.body);
    const { config, client } = await getWorkspaceGmailClient(
      request.nextUrl.searchParams.get("mailbox"),
    );
    const reply = await client.getReplyContext(safeMessageId);
    // The address is derived from the source Gmail message, never accepted from
    // the browser. External customer/vendor recipients are valid here; the
    // separate test-send endpoint remains restricted to approved Workspace mail.
    const recipient = validateReplyRecipient(reply.recipient);
    lease = await acquireWorkspaceSetupLease(env.DB, {
      id: crypto.randomUUID(),
      connectionKey: config.connectionKey,
      action: `gmail-reply-draft:${safeMessageId}`,
      scopeKey: "gmail-reply-draft",
      actor: auth.user.email,
      now: Date.now(),
      connectionFence: googleConnectionLeaseFence(config),
    });
    if (!lease) {
      return NextResponse.json(
        {
          error: "A reply draft for this Gmail message is already in progress. Try again shortly.",
          code: "gmail_reply_draft_in_progress",
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    const draft = await client.createReplyDraft({ ...reply, recipient, body: replyBody });
    await writeGoogleIntegrationEvent(
      config,
      "gmail.reply_draft_created",
      auth.user.email,
      "gmail-message",
      safeMessageId,
      `recipient=${recipient};thread=${reply.threadId};mode=${config.environment};sent=false`,
    );
    await completeWorkspaceSetupLease(env.DB, lease, Date.now());
    return NextResponse.json({ draftSaved: true, recipient, subject: reply.subject, draft, sent: false }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (lease) {
      await failWorkspaceSetupLease(env.DB, lease, "gmail_reply_draft_failed", Date.now());
    }
    return gmailErrorResponse(error);
  }
}
