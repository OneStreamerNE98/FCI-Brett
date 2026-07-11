import { NextRequest, NextResponse } from "next/server";
import { validateTestMessageInput, validateTestRecipient } from "../../../../../../lib/google-gmail";
import { writeGoogleIntegrationEvent } from "../../../../../../lib/google-oauth";
import { requireOfficeUser, requireSameOrigin } from "../../../../../../lib/workspace-auth";
import { getTestGmailClient, gmailErrorResponse, readBoundedJson } from "../_route-helpers";

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return auth.response;

  try {
    const input = await readBoundedJson(request, 6_000);
    const { config, client } = await getTestGmailClient();
    const recipient = validateTestRecipient(input.to, config);
    const message = validateTestMessageInput(input);
    const sent = await client.sendTestMessage({ recipient, ...message });
    await writeGoogleIntegrationEvent(
      config,
      "gmail.test_sent",
      auth.user.email,
      "gmail-message",
      sent.id,
      `recipient=${recipient};environment=test`,
    );
    return NextResponse.json(
      { sent: true, recipient, message: sent },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return gmailErrorResponse(error);
  }
}
