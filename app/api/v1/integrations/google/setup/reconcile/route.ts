import { env } from "cloudflare:workers";
import { NextRequest } from "next/server";

import type { D1Database } from "../../../../../../adapters/d1/d1-database";
import {
  acquireWorkspaceSetupLease,
  completeWorkspaceSetupLease,
  failWorkspaceSetupLease,
  googleConnectionLeaseFence,
  type WorkspaceSetupLease,
} from "../../../../../../adapters/d1/workspace-setup-leases";
import { parseBoundedJsonObject } from "../../../../../../lib/api-json-body";
import { GoogleCalendarClient } from "../../../../../../lib/google-calendar-client";
import { GoogleDriveClient } from "../../../../../../lib/google-drive";
import { setupReconcileRunIntegrationEvent } from "../../../../../../lib/google-integration-events";
import { googleIntegrationErrorResponse } from "../../../../../../lib/google-integration-error";
import {
  getEffectiveGoogleRuntimeSetup,
  getGoogleAccessToken,
  writeGoogleIntegrationEvent,
} from "../../../../../../lib/google-oauth-sites";
import { discoverWorkspaceReconcileActual } from "../../../../../../lib/google-workspace-reconcile";
import { noStoreJson as response, noStoreResponse } from "../../../../../../lib/no-store-json";
import {
  deriveWorkspaceReconcileDrift,
  workspaceReconcileDesiredResources,
} from "../../../../../../lib/workspace-reconcile";
import { workspaceReconcileSimulationActual } from "../../../../../../lib/workspace-reconcile-simulation";
import { requireOfficeUser, requireSameOrigin } from "../../../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../../../_workspace-data";

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return noStoreResponse(originError);
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return noStoreResponse(auth.response);

  if (request.body) {
    const parsed = await parseBoundedJsonObject(request, {
      maximumBytes: 1_000,
      invalidMessage: "Provide an empty JSON object to check Workspace drift.",
      tooLargeMessage: "The Workspace reconcile request is too large.",
    });
    if (!parsed.ok) return response({ error: parsed.error }, parsed.status);
    if (Object.keys(parsed.body).length > 0) {
      return response({ error: "Provide no fields when checking Workspace drift." }, 400);
    }
  }
  await ensureWorkspaceSchema();

  const setup = await getEffectiveGoogleRuntimeSetup();
  const { config, blueprint, blueprintVersion, resources, effectiveResources } = setup;
  const database = env.DB as unknown as D1Database;
  let lease: WorkspaceSetupLease | null = null;
  const sharedDrive = resources.find((resource) => (
    resource.resourceType === "drive.shared-drive" && resource.resourceKey === "primary"
  ));
  if (!config.connectReady || !config.drive.rootFolderId || !sharedDrive) {
    return response({
      error: "Adopt and verify the Shared Drive before checking Workspace drift.",
      code: "shared_drive_not_adopted",
    }, 409);
  }

  try {
    const registeredCalendars = new Map(
      resources
        .filter((resource) => resource.resourceType === "calendar.calendar")
        .map((resource) => [resource.resourceKey, resource.externalId]),
    );
    const registeredDriveResources = effectiveResources.clientDirectorySheet.externalId
      ? [{
        resourceType: "sheets.spreadsheet" as const,
        key: effectiveResources.clientDirectorySheet.resourceKey,
        externalId: effectiveResources.clientDirectorySheet.externalId,
      }]
      : [];
    if (!config.simulation) {
      for (const resource of [
        effectiveResources.clientAppointmentsCalendar,
        effectiveResources.fieldScheduleCalendar,
      ]) {
        if (resource.externalId) registeredCalendars.set(resource.resourceKey, resource.externalId);
      }
    }

    let calendar: GoogleCalendarClient | null = null;
    const readableCalendars = [...registeredCalendars].map(([key, externalId]) => ({ key, externalId }));
    if (!config.simulation && readableCalendars.length > 0) {
      if (!config.enabledServices.includes("calendar")) {
        return response({
          error: "Calendar reconciliation is unavailable because Calendar is not enabled for this Workspace connection.",
          code: "calendar_reconcile_unavailable",
        }, 409);
      }
      calendar = new GoogleCalendarClient(
        await getGoogleAccessToken(config, "calendar"),
        config,
      );
    }

    const actual = config.simulation
      ? workspaceReconcileSimulationActual(blueprint, resources)
      : await discoverWorkspaceReconcileActual({
        blueprint,
        rootExternalId: sharedDrive.externalId,
        resources,
        driveRegistrations: registeredDriveResources,
        calendarRegistrations: readableCalendars,
        drive: new GoogleDriveClient(
          await getGoogleAccessToken(config, "drive"),
          config,
        ),
        calendar,
      });
    const desiredCalendarKeys = new Set(
      (config.simulation
        ? resources
          .filter((resource) => resource.resourceType === "calendar.calendar")
          .map((resource) => resource.resourceKey)
        : readableCalendars.map((resource) => resource.key)),
    );
    const desired = workspaceReconcileDesiredResources(blueprint, desiredCalendarKeys);
    const result = deriveWorkspaceReconcileDrift(desired, actual);
    const event = setupReconcileRunIntegrationEvent(config.connectionKey, result.counts);
    if (!config.simulation) {
      lease = await acquireWorkspaceSetupLease(database, {
        id: crypto.randomUUID(),
        connectionKey: config.workspaceConnectionKey,
        action: "setup-reconcile",
        scopeKey: "setup-reconcile",
        actor: auth.user.email,
        now: Date.now(),
        connectionFence: googleConnectionLeaseFence(config),
      });
      if (!lease) {
        return response({
          error: "The Google connection changed or Workspace drift is already being checked. Try again.",
          code: "workspace_reconcile_in_progress",
        }, 409);
      }
    }
    await writeGoogleIntegrationEvent(
      config,
      event.eventType,
      auth.user.email,
      event.entityType,
      event.entityId,
      event.detail,
    );
    if (lease) {
      await completeWorkspaceSetupLease(database, lease, Date.now());
      lease = null;
    }
    return response({
      reconciled: true,
      simulated: config.simulation,
      blueprintVersion,
      checkedAt: Date.now(),
      counts: result.counts,
      drift: result.drift,
    });
  } catch (error) {
    if (lease) {
      await failWorkspaceSetupLease(database, lease, "workspace_reconcile_failed", Date.now());
    }
    return noStoreResponse(googleIntegrationErrorResponse(
      error,
      "Workspace drift could not be checked. No Google resource was changed.",
    ));
  }
}
