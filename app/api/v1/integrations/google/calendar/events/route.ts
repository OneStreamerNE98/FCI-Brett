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
import { readGoogleIntegrationVerification } from "../../../../../../adapters/d1/google-integration-verification";
import { GoogleIntegrationError, getEffectiveGoogleRuntimeSetup, writeGoogleIntegrationEvent } from "../../../../../../lib/google-oauth-sites";
import { listWorkspaceCalendarEvents } from "../../../../../../lib/google-calendar-sites";
import { calendarEventsListedIntegrationEvent } from "../../../../../../lib/google-integration-events";
import { listSimulationCalendarEvents } from "../../../../../../lib/workspace-simulation";
import { requireOfficeUser } from "../../../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../../../_workspace-data";
import { noStoreJson as noStore } from "../../../../../../lib/no-store-json";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const { config } = await getEffectiveGoogleRuntimeSetup();
  const database = env.DB as unknown as D1Database;
  let lease: WorkspaceSetupLease | null = null;
  if (!config.calendarEnabled) {
    return noStore({ error: "Enable Calendar for the Google Workspace connection before using appointments." }, { status: 409 });
  }
  if (!config.oauthReady || !config.clientAppointmentsCalendarId) {
    return noStore({ error: "Google Calendar setup is incomplete.", code: "calendar_configuration_required", missing: config.missing }, { status: 409 });
  }

  try {
    const verificationOnly = new URL(request.url).searchParams.get("verification") === "status";
    if (verificationOnly) {
      const verification = await readGoogleIntegrationVerification(
        database,
        config.connectionKey,
      );
      return noStore({ events: [], verificationPassed: verification.calendarChecked });
    }
    if (config.simulation) {
      const result = await listSimulationCalendarEvents();
      const event = calendarEventsListedIntegrationEvent(
        config.clientAppointmentsCalendarId,
        result.window,
        result.events.length,
      );
      await writeGoogleIntegrationEvent(
        config,
        event.eventType,
        auth.user.email,
        event.entityType,
        event.entityId,
        event.detail,
      );
      return noStore(result);
    }
    // The calendar helper persists the list audit immediately after its
    // provider read, so this lease deliberately spans that bounded unit.
    lease = await acquireWorkspaceSetupLease(database, {
      id: crypto.randomUUID(),
      connectionKey: config.workspaceConnectionKey,
      action: "calendar-events-list",
      scopeKey: "calendar-events-list",
      actor: auth.user.email,
      now: Date.now(),
      connectionFence: googleConnectionLeaseFence(config),
    });
    if (!lease) {
      return noStore({
        error: "The Google connection changed or Calendar is already being read. Try again.",
        code: "calendar_read_in_progress",
      }, { status: 409 });
    }
    const result = await listWorkspaceCalendarEvents(config, auth.user.email);
    await completeWorkspaceSetupLease(database, lease, Date.now());
    lease = null;
    return noStore(result);
  } catch (error) {
    if (lease) {
      await failWorkspaceSetupLease(database, lease, "calendar_read_failed", Date.now());
    }
    if (error instanceof GoogleIntegrationError) {
      return noStore({ error: error.message, code: error.code }, { status: error.status });
    }
    return noStore({ error: "The Workspace Calendar could not be read. Try again." }, { status: 503 });
  }
}
