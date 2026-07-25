import { env } from "cloudflare:workers";
import { NextRequest } from "next/server";

import type { D1Database } from "../../../../adapters/d1/d1-database";
import { createD1FirstRunImportRepository } from "../../../../adapters/d1/first-run-import-repository";
import {
  FIRST_RUN_IMPORT_MAX_ROWS,
  FIRST_RUN_IMPORT_REAL_DATA_ALLOWED,
} from "../../../../domain/first-run-import";
import { getEffectiveGoogleRuntimeSetup } from "../../../../lib/google-oauth-sites";
import { noStoreJson, noStoreResponse } from "../../../../lib/no-store-json";
import { requireOfficeUser } from "../../../../lib/workspace-auth";
import { ensureWorkspaceSchema } from "../../_workspace-data";

export async function GET(request: NextRequest) {
  const auth = requireOfficeUser(request, { admin: true });
  if ("response" in auth) return noStoreResponse(auth.response);

  try {
    await ensureWorkspaceSchema();
    const repository = createD1FirstRunImportRepository(
      env.DB as unknown as D1Database,
    );
    const [snapshot, setup] = await Promise.all([
      repository.snapshot(),
      getEffectiveGoogleRuntimeSetup(),
    ]);
    const sources = setup.blueprint.spreadsheets
      .filter(({ role }) => role === "import")
      .map((spreadsheet) => Object.freeze({
        key: spreadsheet.key,
        name: spreadsheet.name,
        ready: setup.resources.some((resource) => (
          resource.resourceType === "sheets.spreadsheet"
          && resource.resourceKey === spreadsheet.key
          && Boolean(resource.externalId)
        )),
      }));
    const counts = Object.freeze({
      clients: snapshot.clients.length,
      projects: snapshot.projects.length,
    });
    return noStoreJson({
      counts,
      recordsExist: counts.clients + counts.projects > 0,
      realDataAllowed: FIRST_RUN_IMPORT_REAL_DATA_ALLOWED,
      batchLimit: FIRST_RUN_IMPORT_MAX_ROWS,
      simulation: setup.config.simulation,
      sources,
    });
  } catch {
    return noStoreJson({
      error: "First-run import readiness could not be loaded.",
    }, 500);
  }
}
