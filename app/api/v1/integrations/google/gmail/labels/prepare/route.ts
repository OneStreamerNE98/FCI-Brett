import { NextRequest, NextResponse } from "next/server";
import { FCI_GMAIL_LABELS, summarizeFciLabels } from "../../../../../../../lib/google-gmail";
import { writeGoogleIntegrationEvent } from "../../../../../../../lib/google-oauth-sites";
import { requireOfficeUser, requireSameOrigin } from "../../../../../../../lib/workspace-auth";
import { getWorkspaceGmailClient, gmailErrorResponse } from "../../_route-helpers";

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return auth.response;

  try {
    const { config, client } = await getWorkspaceGmailClient();
    const labels = await client.prepareFciLabels();
    const summarizedLabels = summarizeFciLabels(labels);
    await writeGoogleIntegrationEvent(
      config,
      "gmail.labels_prepared",
      auth.user.email,
      "gmail-labels",
      config.connectionKey,
      `labels=${[FCI_GMAIL_LABELS.intake, FCI_GMAIL_LABELS.needsReview, FCI_GMAIL_LABELS.filed].join(",")};mode=${config.environment}`,
    );
    return NextResponse.json({ prepared: true, labels: summarizedLabels }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return gmailErrorResponse(error);
  }
}
