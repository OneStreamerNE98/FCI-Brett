import { env } from "cloudflare:workers";
import { NextRequest } from "next/server";

import type { D1Database } from "../../../../adapters/d1/d1-database";
import {
  createD1FirstRunImportRepository,
  FirstRunImportLeaseLostError,
} from "../../../../adapters/d1/first-run-import-repository";
import {
  acquireWorkspaceSetupLease,
  failWorkspaceSetupLease,
  type WorkspaceSetupLease,
} from "../../../../adapters/d1/workspace-setup-leases";
import {
  confirmFirstRunImport,
  FirstRunImportConfirmationError,
  type FirstRunImportConfirmationRow,
} from "../../../../application/first-run-import";
import {
  FIRST_RUN_IMPORT_MAX_ROWS,
  FirstRunImportValidationError,
  parseFirstRunImportCsv,
  previewFirstRunImport,
  type FirstRunImportEntity,
  type FirstRunImportPreview,
} from "../../../../domain/first-run-import";
import { parseBoundedJsonObject } from "../../../../lib/api-json-body";
import { firstRunImportSimulationRows } from "../../../../lib/first-run-import-simulation";
import { googleIntegrationErrorResponse } from "../../../../lib/google-integration-error";
import {
  getEffectiveGoogleRuntimeSetup,
  getGoogleAccessToken,
} from "../../../../lib/google-oauth-sites";
import {
  GOOGLE_IMPORT_CLIENT_HEADERS,
  GOOGLE_IMPORT_CLIENTS_TAB,
  GOOGLE_IMPORT_PROJECT_HEADERS,
  GOOGLE_IMPORT_PROJECTS_TAB,
  GoogleSheetsClient,
} from "../../../../lib/google-sheets";
import { noStoreJson, noStoreResponse } from "../../../../lib/no-store-json";
import { WORKSPACE_BLUEPRINT_KEY_PATTERN } from "../../../../lib/workspace-blueprint";
import { ensureWorkspaceSchema } from "../../_workspace-data";
import {
  projectSegmentFromClientIndustry,
  resolveProjectSegment,
} from "../../../../domain/project-segment";
import type {
  FirstRunImportSnapshot,
  FirstRunImportStoredClient,
} from "../../../../ports/first-run-import-repository";

const MAX_FIRST_RUN_IMPORT_BODY_BYTES = 600_000;
const MAX_FIRST_RUN_IMPORT_CSV_BYTES = 256_000;
const MAX_SOURCE_FILE_NAME_LENGTH = 120;
const MAX_FIRST_RUN_IMPORT_SHEET_COLUMNS = 64;

type SpreadsheetSource = Readonly<{
  kind: "spreadsheet";
  spreadsheetKey: string;
}>;

type CsvSource = Readonly<{
  kind: "csv";
  fileName: string;
  content: string;
}>;

type ImportSource = SpreadsheetSource | CsvSource;

type PreviewRequest = Readonly<{
  entity: FirstRunImportEntity;
  source: ImportSource;
}>;

type ConfirmRequest = Readonly<{
  entity: FirstRunImportEntity;
  source: ImportSource;
  rows: readonly FirstRunImportConfirmationRow[];
}>;

type LoadedSource = Readonly<{
  kind: "spreadsheet" | "csv";
  publicSource:
    | Readonly<{ kind: "spreadsheet"; spreadsheetKey: string }>
    | Readonly<{ kind: "csv"; fileName: string }>;
  values: readonly (readonly string[])[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
) {
  const keys = Object.keys(value);
  return keys.length === allowed.length
    && keys.every((key) => allowed.includes(key));
}

function safeFileName(value: unknown) {
  if (typeof value !== "string") return null;
  const baseName = value.split(/[\\/]/u).at(-1)?.normalize("NFKC").trim() ?? "";
  if (
    !baseName
    || baseName.length > MAX_SOURCE_FILE_NAME_LENGTH
    || !/\.csv$/iu.test(baseName)
    || /[\u0000-\u001f\u007f]/u.test(baseName)
  ) return null;
  return baseName;
}

function sourceDescriptor(value: unknown): ImportSource | null {
  if (!isRecord(value) || typeof value.kind !== "string") return null;
  if (value.kind === "spreadsheet") {
    if (
      !hasExactKeys(value, ["kind", "spreadsheetKey"])
      || typeof value.spreadsheetKey !== "string"
    ) return null;
    const spreadsheetKey = value.spreadsheetKey.trim();
    if (!WORKSPACE_BLUEPRINT_KEY_PATTERN.test(spreadsheetKey)) return null;
    return Object.freeze({ kind: "spreadsheet", spreadsheetKey });
  }
  if (value.kind === "csv") {
    if (
      !hasExactKeys(value, ["kind", "fileName", "content"])
      || typeof value.content !== "string"
    ) return null;
    const fileName = safeFileName(value.fileName);
    if (!fileName) return null;
    if (new TextEncoder().encode(value.content).byteLength > MAX_FIRST_RUN_IMPORT_CSV_BYTES) {
      throw new FirstRunImportValidationError(
        "import_csv_too_large",
        "Choose a CSV file no larger than 256,000 bytes.",
      );
    }
    return Object.freeze({
      kind: "csv",
      fileName,
      content: value.content,
    });
  }
  return null;
}

function confirmationRows(
  value: unknown,
  entity: FirstRunImportEntity,
) {
  if (!Array.isArray(value) || value.length < 1 || value.length > FIRST_RUN_IMPORT_MAX_ROWS) {
    return null;
  }
  const rows: FirstRunImportConfirmationRow[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate)) return null;
    const allowedKeys = entity === "projects"
      ? ["rowKey", "clientId", "effectiveSegment"]
      : ["rowKey"];
    if (!Object.keys(candidate).every((key) => allowedKeys.includes(key))) return null;
    if (
      typeof candidate.rowKey !== "string"
      || !new RegExp(`^${entity}:\\d+:[0-9a-f]{64}$`, "u").test(candidate.rowKey)
    ) return null;
    if (entity === "projects") {
      if (
        typeof candidate.clientId !== "string"
        || !candidate.clientId.trim()
        || candidate.clientId.length > 128
        || /[\s\u0000-\u001f\u007f]/u.test(candidate.clientId)
        || (candidate.effectiveSegment !== "commercial"
          && candidate.effectiveSegment !== "residential")
      ) return null;
    } else if (
      candidate.clientId !== undefined
      || candidate.effectiveSegment !== undefined
    ) {
      return null;
    }
    rows.push(Object.freeze({
      rowKey: candidate.rowKey,
      ...(entity === "clients"
        ? {}
        : {
            clientId: candidate.clientId as string,
            effectiveSegment: candidate.effectiveSegment as "commercial" | "residential",
          }),
    }));
  }
  return Object.freeze(rows);
}

function previewRequestBody(body: Record<string, unknown>): PreviewRequest | null {
  if (
    !hasExactKeys(body, ["entity", "source"])
    || (body.entity !== "clients" && body.entity !== "projects")
  ) return null;
  const source = sourceDescriptor(body.source);
  return source
    ? Object.freeze({ entity: body.entity, source })
    : null;
}

function confirmRequestBody(body: Record<string, unknown>): ConfirmRequest | null {
  if (
    !hasExactKeys(body, ["entity", "source", "rows"])
    || (body.entity !== "clients" && body.entity !== "projects")
  ) return null;
  const source = sourceDescriptor(body.source);
  const rows = confirmationRows(body.rows, body.entity);
  return source && rows
    ? Object.freeze({ entity: body.entity, source, rows })
    : null;
}

function expectedHeaders(entity: FirstRunImportEntity) {
  return entity === "clients"
    ? GOOGLE_IMPORT_CLIENT_HEADERS
    : GOOGLE_IMPORT_PROJECT_HEADERS;
}

function importTab(entity: FirstRunImportEntity) {
  return entity === "clients"
    ? GOOGLE_IMPORT_CLIENTS_TAB
    : GOOGLE_IMPORT_PROJECTS_TAB;
}

function a1ColumnLabel(columnCount: number) {
  let remaining = columnCount;
  let label = "";
  while (remaining > 0) {
    remaining -= 1;
    label = String.fromCharCode(65 + (remaining % 26)) + label;
    remaining = Math.floor(remaining / 26);
  }
  return label;
}

function importRange(
  metadata: Awaited<ReturnType<GoogleSheetsClient["metadata"]>>,
  entity: FirstRunImportEntity,
) {
  const title = importTab(entity);
  const sheet = metadata.sheets
    ?.map(({ properties }) => properties)
    .find((properties) => properties?.title === title);
  const expectedWidth = expectedHeaders(entity).length;
  const actualWidth = sheet?.gridProperties?.columnCount;
  if (
    !Number.isSafeInteger(actualWidth)
    || (actualWidth ?? 0) < expectedWidth
    || (actualWidth ?? 0) > MAX_FIRST_RUN_IMPORT_SHEET_COLUMNS
  ) {
    throw new FirstRunImportValidationError(
      "import_sheet_dimensions_invalid",
      `The ${title} tab must have between ${expectedWidth} and ${MAX_FIRST_RUN_IMPORT_SHEET_COLUMNS} columns.`,
    );
  }
  // Header + the bounded batch + one sentinel row lets validation reject overflow.
  return `'${title}'!A1:${a1ColumnLabel(actualWidth as number)}${FIRST_RUN_IMPORT_MAX_ROWS + 2}`;
}

async function loadSource(
  entity: FirstRunImportEntity,
  source: ImportSource,
): Promise<LoadedSource> {
  if (source.kind === "csv") {
    return Object.freeze({
      kind: "csv",
      publicSource: Object.freeze({ kind: "csv", fileName: source.fileName }),
      values: parseFirstRunImportCsv(source.content),
    });
  }

  const setup = await getEffectiveGoogleRuntimeSetup();
  const spreadsheet = setup.blueprint.spreadsheets.find((candidate) => (
    candidate.key === source.spreadsheetKey && candidate.role === "import"
  ));
  if (!spreadsheet) {
    throw new FirstRunImportValidationError(
      "import_spreadsheet_not_registered",
      "Choose an import-role spreadsheet from the saved Workspace blueprint.",
    );
  }
  const resource = setup.resources.find((candidate) => (
    candidate.resourceType === "sheets.spreadsheet"
    && candidate.resourceKey === spreadsheet.key
  ));
  if (!resource?.externalId) {
    throw new FirstRunImportValidationError(
      "import_spreadsheet_not_ready",
      "Create the selected import spreadsheet in Google Workspace setup before previewing it.",
    );
  }
  const publicSource = Object.freeze({
    kind: "spreadsheet" as const,
    spreadsheetKey: spreadsheet.key,
  });
  if (setup.config.simulation) {
    return Object.freeze({
      kind: "spreadsheet",
      publicSource,
      values: firstRunImportSimulationRows(entity),
    });
  }

  const token = await getGoogleAccessToken(setup.config, "sheets");
  const sheets = new GoogleSheetsClient(token, resource.externalId);
  const metadata = await sheets.metadata();
  const response = await sheets.values(importRange(metadata, entity));
  return Object.freeze({
    kind: "spreadsheet",
    publicSource,
    values: Object.freeze((response.values ?? []).map((row) => Object.freeze([...row]))),
  });
}

function publicPreview(
  preview: FirstRunImportPreview,
  snapshot: FirstRunImportSnapshot,
  source: LoadedSource["publicSource"],
) {
  const clientOption = (client: FirstRunImportStoredClient) => Object.freeze({
    id: client.id,
    code: client.clientCode,
    name: client.name,
    defaultSegment: projectSegmentFromClientIndustry(client.industry),
    ...(client.emails[0] ? { email: client.emails[0] } : {}),
  });
  const rows = preview.rows.map((row) => {
    if (row.entity === "clients") {
      const contact = row.values?.client.primaryContact;
      return Object.freeze({
        rowKey: row.rowKey,
        rowNumber: row.rowNumber,
        state: row.state,
        reasons: Object.freeze(row.issues.map(({ message }) => message)),
        values: row.state !== "invalid" && row.values
          ? Object.freeze({
              name: row.values.client.name,
              code: row.values.sourceClientCode ?? undefined,
              codeDisposition: row.values.sourceClientCode
                ? row.values.persistedClientCode
                  ? "preserved"
                  : "import-alias"
                : "system-assigned",
              status: row.values.client.status,
              industry: row.values.client.industry ?? undefined,
              primaryContact: contact?.name ?? undefined,
              email: contact?.email ?? undefined,
              phone: contact?.phone ?? undefined,
              address: row.values.address ?? undefined,
              addressReviewOnly: Boolean(row.values.address),
            })
          : Object.freeze({}),
      });
    }
    const draft = row.values?.projectDraft;
    const matchedClient = row.values?.resolvedClient
      ? snapshot.clients.find(({ id }) => id === row.values?.resolvedClient?.id) ?? null
      : null;
    return Object.freeze({
      rowKey: row.rowKey,
      rowNumber: row.rowNumber,
      state: row.state,
      reasons: Object.freeze(row.issues.map(({ message }) => message)),
      values: row.state !== "invalid" && row.values && draft
        ? Object.freeze({
            name: draft.name,
            clientCode: row.values.clientCode ?? undefined,
            clientName: row.values.clientName ?? undefined,
            clientEmail: row.values.clientEmail ?? undefined,
            site: draft.site ?? undefined,
            status: draft.status,
            estimatedValue: draft.estimatedValue ?? undefined,
            flooringCategory: draft.flooringCategory ?? undefined,
            squareFeet: draft.squareFeet ?? undefined,
            contractValue: draft.contractValue ?? undefined,
            segment: draft.segment
              ?? (row.values.resolvedClient
                ? resolveProjectSegment(null, row.values.resolvedClient.industry)
                : undefined),
            segmentSource: draft.segment
              ? "explicit"
              : row.values.resolvedClient
                ? "derived-client-industry"
                : "awaiting-client-match",
            projectManager: "confirming-administrator",
          })
        : Object.freeze({}),
      ...(row.state !== "invalid" && row.values?.resolvedClient
        ? {
            clientId: row.values.resolvedClient.id,
            ...(matchedClient ? { matchedClient: clientOption(matchedClient) } : {}),
          }
        : {}),
    });
  });
  const clientOptions = preview.entity === "projects"
    ? snapshot.clients
      .map(clientOption)
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(0, FIRST_RUN_IMPORT_MAX_ROWS)
    : [];
  return Object.freeze({
    entity: preview.entity,
    source,
    rows: Object.freeze(rows),
    summary: Object.freeze({
      total: preview.total,
      ready: preview.counts.ready,
      duplicates: preview.counts.duplicate,
      invalid: preview.counts.invalid,
      blockedRealData: preview.counts["blocked-real-data"],
      unmatchedClients: preview.counts["unmatched-client"],
      ambiguousClients: preview.counts["ambiguous-client"],
    }),
    clientOptions: Object.freeze(clientOptions),
    clientOptionsTruncated: preview.entity === "projects"
      && snapshot.clients.length > clientOptions.length,
  });
}

async function parseRequest(
  request: NextRequest,
) {
  return parseBoundedJsonObject(request, {
    maximumBytes: MAX_FIRST_RUN_IMPORT_BODY_BYTES,
    invalidMessage: "First-run import details must be valid JSON.",
    tooLargeMessage: "First-run import details are too large.",
  });
}

function invalidRequest() {
  return noStoreJson({
    error: "Send valid first-run import details.",
    code: "import_request_invalid",
  }, 400);
}

function sourceError(error: unknown) {
  if (error instanceof FirstRunImportValidationError) {
    return noStoreJson({ error: error.message, code: error.code }, 400);
  }
  return noStoreResponse(googleIntegrationErrorResponse(
    error,
    "The first-run import source could not be read. Try again.",
  ));
}

export async function handleFirstRunImportPreview(request: NextRequest) {
  const parsed = await parseRequest(request);
  if (!parsed.ok) return noStoreJson({ error: parsed.error }, parsed.status);

  let body: PreviewRequest | null;
  try {
    body = previewRequestBody(parsed.body);
  } catch (error) {
    return sourceError(error);
  }
  if (!body) return invalidRequest();

  try {
    await ensureWorkspaceSchema();
    const repository = createD1FirstRunImportRepository(
      env.DB as unknown as D1Database,
    );
    const loaded = await loadSource(body.entity, body.source);
    const snapshot = await repository.snapshot();
    const preview = await previewFirstRunImport({
      entity: body.entity,
      values: loaded.values,
      expectedHeaders: expectedHeaders(body.entity),
      snapshot,
    });
    return noStoreJson(publicPreview(preview, snapshot, loaded.publicSource));
  } catch (error) {
    return sourceError(error);
  }
}

export async function handleFirstRunImportConfirm(
  request: NextRequest,
  actor: string,
) {
  const parsed = await parseRequest(request);
  if (!parsed.ok) return noStoreJson({ error: parsed.error }, parsed.status);

  let body: ConfirmRequest | null;
  try {
    body = confirmRequestBody(parsed.body);
  } catch (error) {
    return sourceError(error);
  }
  if (!body) return invalidRequest();

  let lease: WorkspaceSetupLease | null = null;
  const database = env.DB as unknown as D1Database;
  try {
    await ensureWorkspaceSchema();
    const readRepository = createD1FirstRunImportRepository(database);
    // Reading Sheets can be the slow part. Finish that bounded provider read
    // before taking the global snapshot-to-write lease.
    const loaded = await loadSource(body.entity, body.source);
    const setup = await getEffectiveGoogleRuntimeSetup();
    lease = await acquireWorkspaceSetupLease(database, {
      id: crypto.randomUUID(),
      connectionKey: setup.config.connectionKey,
      action: "first-run-import-confirm",
      scopeKey: "records",
      actor,
      now: Date.now(),
    });
    if (!lease) {
      return noStoreJson({
        error: "Another first-run import confirmation is already in progress. Try again shortly.",
        code: "import_in_progress",
      }, 409);
    }
    const snapshot = await readRepository.snapshot();
    const clientOverrides = Object.fromEntries(
      body.rows
        .filter((row): row is Required<FirstRunImportConfirmationRow> => (
          typeof row.clientId === "string"
        ))
        .map((row) => [row.rowKey, row.clientId]),
    );
    const preview = await previewFirstRunImport({
      entity: body.entity,
      values: loaded.values,
      expectedHeaders: expectedHeaders(body.entity),
      snapshot,
      clientOverrides,
    });
    if (Date.now() >= lease.leaseExpiresAt) {
      throw new FirstRunImportConfirmationError(
        "import_confirmation_expired",
        "The import confirmation took too long. Preview the source again before confirming.",
        409,
      );
    }
    const writeRepository = createD1FirstRunImportRepository(database, lease);
    const confirmation = await confirmFirstRunImport({
      preview,
      selected: body.rows,
      actor,
      sourceKind: loaded.kind,
      repository: writeRepository,
      newId: () => crypto.randomUUID(),
      now: () => Date.now(),
    });
    return noStoreJson({
      entity: confirmation.entity,
      created: confirmation.created,
      duplicates: confirmation.duplicates,
      rejected: confirmation.rejected,
      results: confirmation.rows,
    }, confirmation.created > 0 ? 201 : 200);
  } catch (error) {
    if (lease) {
      const code = error instanceof FirstRunImportConfirmationError
        ? error.code
        : error instanceof FirstRunImportLeaseLostError
          ? "import_confirmation_expired"
          : error instanceof FirstRunImportValidationError
            ? error.code
            : "first_run_import_confirm_failed";
      await failWorkspaceSetupLease(database, lease, code, Date.now());
    }
    if (error instanceof FirstRunImportConfirmationError) {
      return noStoreJson({
        error: error.message,
        code: error.code,
      }, error.status);
    }
    if (error instanceof FirstRunImportLeaseLostError) {
      return noStoreJson({
        error: "The import confirmation lease expired or was replaced. Preview the source again before confirming.",
        code: "import_confirmation_expired",
      }, 409);
    }
    return sourceError(error);
  }
}
