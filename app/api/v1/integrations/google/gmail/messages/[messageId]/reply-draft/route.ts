import { NextRequest, NextResponse } from "next/server";
import { validateGmailMessageId, validateReplyDraftBody, validateTestRecipient } from "../../../../../../../../lib/google-gmail";
import { writeGoogleIntegrationEvent } from "../../../../../../../../lib/google-oauth";
import { requireOfficeUser, requireSameOrigin } from "../../../../../../../../lib/workspace-auth";
import { getTestGmailClient, gmailErrorResponse, readBoundedJson } from "../../../_route-helpers";

/**
 * Personal-test reply flow: this saves an unsent Gmail draft addressed only to
 * the approved test account. It intentionally never sends email from the app.
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
    const { config, client } = await getTestGmailClient();
    const reply = await client.getReplyContext(safeMessageId);
    const recipient = validateTestRecipient(reply.recipient, config);
    const draft = await client.createReplyDraft({ ...reply, recipient, body: replyBody });
    await writeGoogleIntegrationEvent(
      config,
      "gmail.reply_draft_created",
      auth.user.email,
      "gmail-message",
      safeMessageId,
      `recipient=${recipient};thread=${reply.threadId};environment=test;sent=false`,
    );
    return NextResponse.json({ draftSaved: true, recipient, subject: reply.subject, draft, sent: false }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return gmailErrorResponse(error);
  }
}
