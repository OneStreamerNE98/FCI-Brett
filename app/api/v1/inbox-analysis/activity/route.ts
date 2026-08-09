import { env } from "cloudflare:workers";
import { NextRequest } from "next/server";

import type { D1Database } from "../../../../adapters/d1/d1-database";
import { createD1MailItemRepository } from "../../../../adapters/d1/mail-item-repository";
import type { MailItem } from "../../../../domain/mail-item";
import { getConnectionScope } from "../../../../lib/google-oauth-sites";
import { noStoreJson, noStoreResponse } from "../../../../lib/no-store-json";
import { requireOfficeUser } from "../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../_workspace-data";
import { readAssistantLabelCatalog } from "../_label-catalog";

const ACTIVITY_PAGE_LIMIT = 100;
const ACTIVITY_CONFIDENCES = new Set(["high", "medium", "low"]);

function activityAnalysis(item: MailItem, knownSlugs: ReadonlySet<string>) {
  const payload = item.analysisPayload;
  const rationale = typeof item.matchReason === "string"
    ? item.matchReason.replace(/\s+/g, " ").trim()
    : "";
  if (
    !payload
    || !Array.isArray(payload.intents)
    || payload.intents.length === 0
    || payload.intents.some((intent) =>
      typeof intent !== "string" || !knownSlugs.has(intent)
    )
    || new Set(payload.intents).size !== payload.intents.length
    || typeof item.confidence !== "string"
    || !ACTIVITY_CONFIDENCES.has(item.confidence)
    || !rationale
    || rationale.length > 200
    || /[\u0000-\u001f\u007f]/.test(item.matchReason ?? "")
  ) {
    return Object.freeze({
      state: "degraded" as const,
      message: "Some saved classification details are unavailable.",
    });
  }
  return Object.freeze({
    state: "available" as const,
    intents: Object.freeze([...payload.intents] as string[]),
    confidence: item.confidence,
    rationale,
  });
}

function activityRow(
  item: MailItem,
  knownSlugs: ReadonlySet<string>,
  currentLabelDefinitionVersion: string,
) {
  const attributionRecorded = item.reviewedBy !== null && item.reviewedAt !== null;
  return Object.freeze({
    id: item.id,
    subject: item.subject,
    sender: item.sender,
    receivedAt: item.receivedAt,
    outcome: item.status,
    reviewedBy: attributionRecorded ? item.reviewedBy : null,
    reviewedAt: attributionRecorded ? item.reviewedAt : null,
    acceptedIntent: item.acceptedIntent,
    acceptedIntentAvailable: item.acceptedIntent === null
      || knownSlugs.has(item.acceptedIntent),
    labelDefinitionVersion: item.labelDefinitionVersion,
    labelSetState: item.labelDefinitionVersion === null
      ? "not-recorded"
      : item.labelDefinitionVersion === currentLabelDefinitionVersion
        ? "current"
        : "earlier",
    attributionState: attributionRecorded ? "recorded" : "not-recorded",
    analysis: activityAnalysis(item, knownSlugs),
  });
}

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return noStoreResponse(auth.response);

  try {
    await ensureWorkspaceSchema();
    const database = env.DB as unknown as D1Database;
    const repository = createD1MailItemRepository(database);
    const connectionKey = getConnectionScope().connectionKey;
    const labelCatalog = await readAssistantLabelCatalog(database);
    const [page, storedCounts] = await Promise.all([
      repository.listReviewActivity(connectionKey, ACTIVITY_PAGE_LIMIT),
      repository.listReviewActivityLabelCounts(
        connectionKey,
        labelCatalog.labels.map(({ slug }) => slug),
      ),
    ]);
    const countBySlug = new Map(storedCounts.map((count) => [count.slug, count]));
    return noStoreJson({
      labels: labelCatalog.labels,
      counts: labelCatalog.labels.map((label) => {
        const count = countBySlug.get(label.slug);
        return Object.freeze({
          slug: label.slug,
          acceptedCount: count?.acceptedCount ?? 0,
          dismissedCount: count?.dismissedCount ?? 0,
        });
      }),
      rows: page.items.map((item) => activityRow(
        item,
        labelCatalog.knownSlugs,
        labelCatalog.version,
      )),
      totalCount: page.totalCount,
      pageLimit: ACTIVITY_PAGE_LIMIT,
    });
  } catch {
    return noStoreJson(
      { error: "AI assistant activity could not be loaded." },
      500,
    );
  }
}
