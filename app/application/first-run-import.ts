import type {
  FirstRunImportClientPreviewRow,
  FirstRunImportEntity,
  FirstRunImportPreview,
  FirstRunImportProjectPreviewRow,
} from "../domain/first-run-import.ts";
import type {
  FirstRunImportClientCreate,
  FirstRunImportProjectCreate,
  FirstRunImportRepository,
} from "../ports/first-run-import-repository.ts";
import {
  resolveProjectSegment,
  type ProjectSegment,
} from "../domain/project-segment.ts";

export type FirstRunImportConfirmationRow = Readonly<{
  rowKey: string;
  clientId?: string;
  effectiveSegment?: ProjectSegment;
}>;

export type FirstRunImportConfirmationResult = Readonly<{
  entity: FirstRunImportEntity;
  created: number;
  duplicates: number;
  rejected: number;
  rows: readonly Readonly<{
    rowKey: string;
    rowNumber: number;
    outcome: "created" | "duplicate" | "missing-client";
    id: string | null;
    identifier: string | null;
  }>[];
}>;

export class FirstRunImportConfirmationError extends Error {
  readonly code: string;
  readonly status: 400 | 409;

  constructor(code: string, message: string, status: 400 | 409) {
    super(message);
    this.name = "FirstRunImportConfirmationError";
    this.code = code;
    this.status = status;
  }
}

function fallbackClientCode(id: string) {
  return `CL-${id.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

function projectNumber(id: string, createdAt: number) {
  return `CF-${new Date(createdAt).getUTCFullYear()}-${id.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

const DURABLE_CLIENT_DUPLICATE_CODES = new Set([
  "duplicate_code",
  "duplicate_name",
  "duplicate_email",
  "duplicate_phone",
  "duplicate_address",
]);
const DURABLE_PROJECT_DUPLICATE_CODES = new Set(["duplicate_project"]);

function durableDuplicate(row: FirstRunImportPreview["rows"][number]) {
  if (row.state !== "duplicate") return false;
  const durableCodes = row.entity === "clients"
    ? DURABLE_CLIENT_DUPLICATE_CODES
    : DURABLE_PROJECT_DUPLICATE_CODES;
  return row.issues.some(({ code }) => durableCodes.has(code));
}

function confirmationRows(
  preview: FirstRunImportPreview,
  selected: readonly FirstRunImportConfirmationRow[],
) {
  if (selected.length === 0) {
    throw new FirstRunImportConfirmationError(
      "import_selection_empty",
      "Select at least one reviewed row to import.",
      400,
    );
  }
  const unique = new Map(selected.map((row) => [row.rowKey, row]));
  if (unique.size !== selected.length) {
    throw new FirstRunImportConfirmationError(
      "import_selection_invalid",
      "Each reviewed import row can be selected only once.",
      400,
    );
  }
  const previewByKey = new Map(preview.rows.map((row) => [row.rowKey, row]));
  return selected.map((selection) => {
    const row = previewByKey.get(selection.rowKey);
    if (!row) {
      throw new FirstRunImportConfirmationError(
        "import_review_stale",
        "The import source changed after review. Preview it again before confirming.",
        409,
      );
    }
    if (row.entity === "projects") {
      const reviewedClient = row.values?.resolvedClient;
      const reviewedSegment = resolveProjectSegment(
        row.values?.projectDraft?.segment,
        reviewedClient?.industry,
      );
      if (
        !reviewedClient
        || selection.clientId !== reviewedClient.id
        || selection.effectiveSegment !== reviewedSegment
      ) {
        throw new FirstRunImportConfirmationError(
          "import_review_stale",
          "The project client or segment changed after review. Preview it again before confirming.",
          409,
        );
      }
    }
    if ((row.state !== "ready" && !durableDuplicate(row)) || !row.values) {
      throw new FirstRunImportConfirmationError(
        "import_row_not_ready",
        `Row ${row.rowNumber} is no longer ready to import. Review its current status.`,
        409,
      );
    }
    return row;
  });
}

function clientCreates(input: Readonly<{
  rows: readonly FirstRunImportClientPreviewRow[];
  actor: string;
  sourceKind: "spreadsheet" | "csv";
  newId: () => string;
  now: () => number;
}>) {
  return input.rows.map((row): FirstRunImportClientCreate => {
    if (!row.values) {
      throw new FirstRunImportConfirmationError(
        "import_row_not_ready",
        `Row ${row.rowNumber} has no validated client values.`,
        409,
      );
    }
    const id = input.newId();
    const createdAt = input.now();
    const primary = row.values.client.primaryContact;
    return Object.freeze({
      id,
      clientCode: row.values.persistedClientCode ?? fallbackClientCode(id),
      name: row.values.client.name,
      status: row.values.client.status,
      industry: row.values.client.industry,
      duplicateAddress: row.values.address,
      primaryContact: primary
        ? Object.freeze({
            id: input.newId(),
            name: primary.name,
            email: primary.email,
            phone: primary.phone,
            role: primary.role,
          })
        : null,
      activityId: input.newId(),
      actor: input.actor,
      createdAt,
      provenance: Object.freeze({
        sourceKind: input.sourceKind,
        sourceRow: row.rowNumber,
        sourceClientCode: row.values.sourceClientCode,
        sourceAddressDigest: row.values.addressDigest,
      }),
    });
  });
}

function projectCreates(input: Readonly<{
  rows: readonly FirstRunImportProjectPreviewRow[];
  actor: string;
  sourceKind: "spreadsheet" | "csv";
  newId: () => string;
  now: () => number;
}>) {
  return input.rows.map((row): FirstRunImportProjectCreate => {
    const project = row.values?.project;
    if (!project) {
      throw new FirstRunImportConfirmationError(
        "import_row_not_ready",
        `Row ${row.rowNumber} has no reviewed client match.`,
        409,
      );
    }
    const id = input.newId();
    const createdAt = input.now();
    return Object.freeze({
      id,
      projectNumber: projectNumber(id, createdAt),
      clientId: project.clientId,
      name: project.name,
      status: project.status,
      site: project.site,
      projectManagerId: input.actor,
      estimatedValue: project.estimatedValue,
      flooringCategory: project.flooringCategory,
      squareFeet: project.squareFeet,
      contractValue: project.contractValue,
      // Persist the server-reviewed effective value so an industry change after
      // preview cannot change the segment inside the repository insert.
      segment: resolveProjectSegment(
        project.segment,
        row.values?.resolvedClient?.industry,
      ),
      activityId: input.newId(),
      actor: input.actor,
      createdAt,
      provenance: Object.freeze({
        sourceKind: input.sourceKind,
        sourceRow: row.rowNumber,
      }),
    });
  });
}

export async function confirmFirstRunImport(input: Readonly<{
  preview: FirstRunImportPreview;
  selected: readonly FirstRunImportConfirmationRow[];
  actor: string;
  sourceKind: "spreadsheet" | "csv";
  repository: FirstRunImportRepository;
  newId: () => string;
  now: () => number;
}>): Promise<FirstRunImportConfirmationResult> {
  const reviewed = confirmationRows(input.preview, input.selected);
  const readyRows = reviewed.filter((row) => row.state === "ready");
  const repositoryResults = input.preview.entity === "clients"
    ? await input.repository.createClients(clientCreates({
        rows: readyRows as readonly FirstRunImportClientPreviewRow[],
        actor: input.actor,
        sourceKind: input.sourceKind,
        newId: input.newId,
        now: input.now,
      }))
    : await input.repository.createProjects(projectCreates({
        rows: readyRows as readonly FirstRunImportProjectPreviewRow[],
        actor: input.actor,
        sourceKind: input.sourceKind,
        newId: input.newId,
        now: input.now,
      }));
  let repositoryIndex = 0;
  const rows = reviewed.map((row) => {
    if (row.state === "duplicate") {
      return Object.freeze({
        rowKey: row.rowKey,
        rowNumber: row.rowNumber,
        outcome: "duplicate" as const,
        id: null,
        identifier: null,
      });
    }
    const result = repositoryResults[repositoryIndex];
    repositoryIndex += 1;
    return Object.freeze({
      rowKey: row.rowKey,
      rowNumber: row.rowNumber,
      outcome: result.outcome,
      id: result.id,
      identifier: result.identifier,
    });
  });
  return Object.freeze({
    entity: input.preview.entity,
    created: rows.filter(({ outcome }) => outcome === "created").length,
    duplicates: rows.filter(({ outcome }) => outcome === "duplicate").length,
    rejected: rows.filter(({ outcome }) => outcome === "missing-client").length,
    rows: Object.freeze(rows),
  });
}
