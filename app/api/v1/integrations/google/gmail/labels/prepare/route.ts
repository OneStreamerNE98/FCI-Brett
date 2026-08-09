import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import {
  acquireWorkspaceSetupLease,
  completeWorkspaceSetupLease,
  failWorkspaceSetupLease,
  googleConnectionLeaseFence,
  type WorkspaceSetupLease,
} from "../../../../../../../adapters/d1/workspace-setup-leases";
import { FCI_GMAIL_LABELS, summarizeFciLabels } from "../../../../../../../lib/google-gmail";
import { writeGoogleIntegrationEvent } from "../../../../../../../lib/google-oauth-sites";
import { requireOfficeUser, requireSameOrigin } from "../../../../../../../lib/workspace-auth";
import { getWorkspaceGmailClient, gmailErrorResponse } from "../../_route-helpers";

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return auth.response;

  let lease: WorkspaceSetupLease | null = null;
  try {
    const { config, client } = await getWorkspaceGmailClient(
      request.nextUrl.searchParams.get("mailbox"),
    );
    lease = await acquireWorkspaceSetupLease(env.DB, {
      id: crypto.randomUUID(),
      connectionKey: config.connectionKey,
      action: "gmail-labels-prepare",
      scopeKey: "gmail-labels",
      actor: auth.user.email,
      now: Date.now(),
      connectionFence: googleConnectionLeaseFence(config),
    });
    if (!lease) {
      return NextResponse.json(
        {
          error: "Gmail label preparation is already in progress. Try again shortly.",
          code: "gmail_labels_prepare_in_progress",
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
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
    await completeWorkspaceSetupLease(env.DB, lease, Date.now());
    return NextResponse.json({ prepared: true, labels: summarizedLabels }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (lease) {
      await failWorkspaceSetupLease(env.DB, lease, "gmail_labels_prepare_failed", Date.now());
    }
    return gmailErrorResponse(error);
  }
}
