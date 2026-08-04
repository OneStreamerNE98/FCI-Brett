import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import type { D1Database } from "../../../../adapters/d1/d1-database";
import { createD1WorkspaceSettingsRepository } from "../../../../adapters/d1/workspace-settings-repository";
import {
  DEFAULT_WORKSPACE_PREFERENCES,
  normalizeWorkspacePreferences,
  WORKSPACE_SETTINGS_ID,
} from "../../../../domain/workspace-settings";
import type { WorkspaceSettingsRepository } from "../../../../ports/workspace-settings-repository";
import { ensureWorkspaceSchema } from "../../_workspace-data";
import { requireOfficeUser, requireSameOrigin } from "../../../../lib/workspace-auth";
import { parseBoundedJsonObject } from "../../../../lib/api-json-body";
import { getGoogleRuntimeConfig } from "../../../../lib/google-oauth-sites";

const MAX_WORKSPACE_SETTINGS_BODY_BYTES = 8_000;

async function readSettings(repository: WorkspaceSettingsRepository) {
  const record = await repository.findById(WORKSPACE_SETTINGS_ID);
  const config = getGoogleRuntimeConfig();
  if (!record) {
    return {
      settings: DEFAULT_WORKSPACE_PREFERENCES,
      intakeMailboxOptions: config.expectedGoogleEmails,
      updatedAt: null,
    };
  }
  return {
    settings: normalizeWorkspacePreferences(record.settings),
    intakeMailboxOptions: config.expectedGoogleEmails,
    updatedAt: record.updatedAt,
  };
}

function intakeMailboxValidationError(
  value: unknown,
  expectedGoogleEmails: readonly string[],
  allowedDomains: readonly string[],
) {
  if (value === undefined || value === "") return null;
  if (typeof value !== "string") return "Choose an authorized Google Workspace intake mailbox.";
  const mailbox = value.trim().toLowerCase();
  const domain = mailbox.split("@")[1] ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mailbox)) {
    return "Choose a valid Google Workspace intake mailbox.";
  }
  if (!expectedGoogleEmails.includes(mailbox)) {
    return "Choose an intake mailbox from GOOGLE_WORKSPACE_AUTHORIZED_ACCOUNTS.";
  }
  if (!allowedDomains.includes(domain)) {
    return "The selected intake mailbox must use a domain in GOOGLE_WORKSPACE_ALLOWED_DOMAINS.";
  }
  return null;
}

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request);
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();
  const repository = createD1WorkspaceSettingsRepository(
    env.DB as unknown as D1Database,
  );
  return NextResponse.json(await readSettings(repository), { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return auth.response;
  await ensureWorkspaceSchema();

  const parsed = await parseBoundedJsonObject(request, {
    maximumBytes: MAX_WORKSPACE_SETTINGS_BODY_BYTES,
    invalidMessage: "Send a valid settings object.",
    tooLargeMessage: "Settings update is too large.",
  });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const config = getGoogleRuntimeConfig();
  const validationError = intakeMailboxValidationError(
    parsed.body.intakeMailbox,
    config.expectedGoogleEmails,
    config.allowedDomains,
  );
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
  const settings = normalizeWorkspacePreferences(parsed.body);
  const includesIntakeMailbox = Object.hasOwn(parsed.body, "intakeMailbox");
  const intakeMailboxOnly = Object.keys(parsed.body).length === 1
    && includesIntakeMailbox;
  const settingsPatch = includesIntakeMailbox
    ? settings
    : Object.fromEntries(
      Object.entries(settings).filter(([key]) => key !== "intakeMailbox"),
    );
  const now = Date.now();
  const repository = createD1WorkspaceSettingsRepository(
    env.DB as unknown as D1Database,
  );
  // The repository replaces only these owned top-level keys atomically, so a
  // concurrent assistant or launch-checklist save cannot lose either update.
  await repository.mergeSettings({
    id: WORKSPACE_SETTINGS_ID,
    settings: intakeMailboxOnly ? { intakeMailbox: settings.intakeMailbox } : settingsPatch,
    updatedBy: auth.user.email,
    updatedAt: now,
  });
  return NextResponse.json(await readSettings(repository), { headers: { "Cache-Control": "no-store" } });
}
