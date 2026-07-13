import { NextRequest, NextResponse } from "next/server";
import { validateGmailMessageId, validateReplyDraftBody, validateReplyRecipient } from "../../../../../../../../lib/google-gmail";
import { writeGoogleIntegrationEvent } from "../../../../../../../../lib/google-oauth";
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
  try {
    const body = await readBoundedJson(request, 7_000);
    const { messageId } = await context.params;
    const safeMessageId = validateGmailMessageId(messageId);
    const replyBody = validateReplyDraftBody(body.body);
    const { config, client } = await getWorkspaceGmailClient();
    const reply = await client.getReplyContext(safeMessageId);
    // The address is derived from the source Gmail message, never accepted from
    // the browser. External customer/vendor recipients are valid here; the
    // separate test-send endpoint remains restricted to approved Workspace mail.
    const recipient = validateReplyRecipient(reply.recipient);
    const draft = await client.createReplyDraft({ ...reply, recipient, body: replyBody });
    await writeGoogleIntegrationEvent(
      config,
      "gmail.reply_draft_created",
      auth.user.email,
      "gmail-message",
      safeMessageId,
      `recipient=${recipient};thread=${reply.threadId};mode=${config.environment};sent=false`,
    );
    return NextResponse.json({ draftSaved: true, recipient, subject: reply.subject, draft, sent: false }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return gmailErrorResponse(error);
  }
}
