import { NextRequest, NextResponse } from "next/server";
import { validateGmailMessageId } from "../../../../../../../../lib/google-gmail";
import { writeGoogleIntegrationEvent } from "../../../../../../../../lib/google-oauth";
import { requireOfficeUser, requireSameOrigin } from "../../../../../../../../lib/workspace-auth";
import { getWorkspaceGmailClient, gmailErrorResponse } from "../../../_route-helpers";

export async function POST(request: NextRequest, context: { params: Promise<{ messageId: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return auth.response;

  try {
    const { messageId } = await context.params;
    const safeMessageId = validateGmailMessageId(messageId);
    const { config, client } = await getWorkspaceGmailClient();
    const result = await client.applyFiledLabel(safeMessageId);
    await writeGoogleIntegrationEvent(
      config,
      "gmail.message_labeled_filed",
      auth.user.email,
      "gmail-message",
      result.id,
      `label=FCI/Filed;inbox_retained=true;mode=${config.environment}`,
    );
    return NextResponse.json(
      { filed: true, message: result },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return gmailErrorResponse(error);
  }
}
