import {
  normalizeClientCreation,
  type NormalizedClientCreation,
} from "./client-creation.ts";
import { normalizeClientNameKey } from "./client-name-key.ts";
import {
  normalizeProjectCreation,
  type NormalizedProjectCreation,
} from "./project-creation.ts";
import type {
  FirstRunImportSnapshot,
  FirstRunImportStoredClient,
} from "../ports/first-run-import-repository.ts";
import { MAX_ADDRESS_LENGTH } from "./address-validation.ts";

// Ten client rows stay below the development D1 per-invocation query budget
// even when every row includes contact and provenance statements.
export const FIRST_RUN_IMPORT_MAX_ROWS = 10;
export const FIRST_RUN_IMPORT_TEST_MARKER = "FCI TEST — DO NOT USE";
export const FIRST_RUN_IMPORT_REAL_DATA_ALLOWED = false;
export const FIRST_RUN_IMPORT_GATE_NOTICE =
  "Test data only — real client data stays blocked until the WS-11 acceptance gate is complete and the owner approves launch.";

export type FirstRunImportEntity = "clients" | "projects";
export type FirstRunImportRowState =
  | "ready"
  | "duplicate"
  | "invalid"
  | "blocked-real-data"
  | "unmatched-client"
  | "ambiguous-client";

export type FirstRunImportIssue = Readonly<{
  code: string;
  message: string;
  clientIds?: readonly string[];
}>;

export type FirstRunImportClientValues = Readonly<{
  sourceClientCode: string | null;
  persistedClientCode: string | null;
  client: NormalizedClientCreation;
  address: string | null;
  addressDigest: string | null;
}>;

export type FirstRunImportProjectValues = Readonly<{
  clientCode: string | null;
  clientName: string | null;
  clientEmail: string | null;
  projectDraft: Omit<NormalizedProjectCreation, "clientId"> | null;
  project: NormalizedProjectCreation | null;
  resolvedClient: Readonly<{
    id: string;
    clientCode: string;
    name: string;
    industry: string | null;
    resolution: "matched" | "reviewed-override";
  }> | null;
}>;

export type FirstRunImportClientPreviewRow = Readonly<{
  entity: "clients";
  rowKey: string;
  rowNumber: number;
  state: FirstRunImportRowState;
  issues: readonly FirstRunImportIssue[];
  values: FirstRunImportClientValues | null;
}>;

export type FirstRunImportProjectPreviewRow = Readonly<{
  entity: "projects";
  rowKey: string;
  rowNumber: number;
  state: FirstRunImportRowState;
  issues: readonly FirstRunImportIssue[];
  values: FirstRunImportProjectValues | null;
}>;

export type FirstRunImportPreviewRow =
  | FirstRunImportClientPreviewRow
  | FirstRunImportProjectPreviewRow;

export type FirstRunImportPreview = Readonly<{
  entity: FirstRunImportEntity;
  rows: readonly FirstRunImportPreviewRow[];
  counts: Readonly<Record<FirstRunImportRowState, number>>;
  total: number;
  confirmable: number;
}>;

export class FirstRunImportValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FirstRunImportValidationError";
    this.code = code;
  }
}

type NormalizedClientRow = Readonly<{
  rowKey: string;
  rowNumber: number;
  values: FirstRunImportClientValues | null;
  issues: readonly FirstRunImportIssue[];
  testData: boolean;
}>;

type NormalizedProjectRow = Readonly<{
  rowKey: string;
  rowNumber: number;
  clientCode: string | null;
  clientName: string | null;
  clientEmail: string | null;
  projectWithoutClient: Omit<NormalizedProjectCreation, "clientId"> | null;
  issues: readonly FirstRunImportIssue[];
  testData: boolean;
}>;

function recordCount(
  rows: readonly FirstRunImportPreviewRow[],
): Record<FirstRunImportRowState, number> {
  const counts: Record<FirstRunImportRowState, number> = {
    ready: 0,
    duplicate: 0,
    invalid: 0,
    "blocked-real-data": 0,
    "unmatched-client": 0,
    "ambiguous-client": 0,
  };
  for (const row of rows) counts[row.state] += 1;
  return counts;
}

function normalizedText(value: unknown, maximum: number) {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (
    !normalized
    || normalized.length > maximum
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(normalized)
  ) return null;
  return normalized;
}

function optionalText(value: unknown, maximum: number) {
  if (typeof value !== "string" || !value.trim()) return null;
  return normalizedText(value, maximum);
}

function suppliedText(value: unknown) {
  return typeof value === "string" && Boolean(value.trim());
}

function emailValue(value: unknown) {
  // A cell rejected for length or control characters must surface an issue like its
  // address/industry siblings — blanking it silently imports an empty contact field.
  const supplied = suppliedText(value);
  const normalized = optionalText(value, 254)?.toLowerCase() ?? null;
  if (!normalized) return { value: null, valid: !supplied } as const;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)) {
    return { value: null, valid: false } as const;
  }
  return { value: normalized, valid: true } as const;
}

function phoneValue(value: unknown) {
  const supplied = suppliedText(value);
  const normalized = optionalText(value, 40);
  if (!normalized) return { value: null, key: null, valid: !supplied } as const;
  const key = normalized.replace(/\D/gu, "");
  if (key.length < 7 || key.length > 18) {
    return { value: null, key: null, valid: false } as const;
  }
  return { value: normalized, key, valid: true } as const;
}

function addressKey(value: string | null) {
  return value
    ? value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase()
    : null;
}

function codeKey(value: string | null) {
  return value
    ? value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase()
    : null;
}

function isMarkedTestData(value: string) {
  const normalized = value.normalize("NFKC").trim();
  return normalized === FIRST_RUN_IMPORT_TEST_MARKER
    || normalized.startsWith(`${FIRST_RUN_IMPORT_TEST_MARKER} `);
}

function issue(code: string, message: string, clients?: readonly string[]) {
  return Object.freeze({
    code,
    message,
    ...(clients && clients.length > 0
      ? { clientIds: Object.freeze([...new Set(clients)]) }
      : {}),
  });
}

function uniqueIssues(issues: readonly FirstRunImportIssue[]) {
  const seen = new Set<string>();
  return Object.freeze(issues.filter((candidate) => {
    const key = `${candidate.code}\u0000${candidate.message}\u0000${candidate.clientIds?.join(",") ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }));
}

function integerValue(value: unknown, options: { positive?: boolean } = {}) {
  if (typeof value !== "string" || !value.trim()) {
    return { value: null, valid: true } as const;
  }
  const cleaned = value.trim().replace(/[$,\s]/gu, "");
  if (!/^-?\d+$/u.test(cleaned)) {
    return { value: null, valid: false } as const;
  }
  const parsed = Number(cleaned);
  const valid = Number.isSafeInteger(parsed)
    && (options.positive ? parsed > 0 : parsed >= 0);
  return valid
    ? { value: parsed, valid: true } as const
    : { value: null, valid: false } as const;
}

function spreadsheetRows(
  values: readonly (readonly string[])[],
  expectedHeaders: readonly string[],
) {
  if (values.length === 0) {
    throw new FirstRunImportValidationError(
      "import_source_empty",
      "The selected import source has no header row.",
    );
  }
  const headers = [...values[0]];
  if (headers[0]?.charCodeAt(0) === 0xfeff) headers[0] = headers[0].slice(1);
  while (headers.length > 0 && headers.at(-1) === "") headers.pop();
  if (
    headers.length !== expectedHeaders.length
    || headers.some((header, index) => header !== expectedHeaders[index])
  ) {
    throw new FirstRunImportValidationError(
      "import_source_headers_invalid",
      "The import headers do not match the first-run template.",
    );
  }
  const rows = values
    .slice(1)
    .map((row, index) => {
      if (
        row
          .slice(expectedHeaders.length)
          .some((cell) => String(cell ?? "").trim())
      ) {
        throw new FirstRunImportValidationError(
          "import_source_rows_invalid",
          `Spreadsheet row ${index + 2} has values outside the closed import columns.`,
        );
      }
      return {
        rowNumber: index + 2,
        cells: expectedHeaders.map((_, cellIndex) => String(row[cellIndex] ?? "")),
      };
    })
    .filter(({ cells }) => cells.some((cell) => cell.trim()));
  if (rows.length > FIRST_RUN_IMPORT_MAX_ROWS) {
    throw new FirstRunImportValidationError(
      "import_batch_too_large",
      `Import at most ${FIRST_RUN_IMPORT_MAX_ROWS} rows at a time.`,
    );
  }
  return rows;
}

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function rowKey(
  entity: FirstRunImportEntity,
  rowNumber: number,
  cells: readonly string[],
) {
  return `${entity}:${rowNumber}:${await sha256(JSON.stringify(cells))}`;
}

function duplicateIndex<T>(
  rows: readonly T[],
  key: (row: T) => string | null,
) {
  const index = new Map<string, T[]>();
  for (const row of rows) {
    const value = key(row);
    if (!value) continue;
    index.set(value, [...(index.get(value) ?? []), row]);
  }
  return index;
}

function storedClientIndexes(clients: readonly FirstRunImportStoredClient[]) {
  const byCode = new Map<string, FirstRunImportStoredClient[]>();
  const byName = new Map<string, FirstRunImportStoredClient[]>();
  const byEmail = new Map<string, FirstRunImportStoredClient[]>();
  const byPhone = new Map<string, FirstRunImportStoredClient[]>();
  const byAddress = new Map<string, FirstRunImportStoredClient[]>();
  const add = (
    index: Map<string, FirstRunImportStoredClient[]>,
    key: string | null,
    client: FirstRunImportStoredClient,
  ) => {
    if (!key) return;
    const current = index.get(key) ?? [];
    if (!current.some(({ id }) => id === client.id)) current.push(client);
    index.set(key, current);
  };
  for (const client of clients) {
    add(byCode, codeKey(client.clientCode), client);
    for (const alias of client.sourceClientCodes) add(byCode, codeKey(alias), client);
    add(byName, normalizeClientNameKey(client.name), client);
    for (const email of client.emails) add(byEmail, emailValue(email).value, client);
    for (const phone of client.phones) add(byPhone, phoneValue(phone).key, client);
    for (const address of client.addresses) add(byAddress, addressKey(address), client);
  }
  const byAddressDigest = new Map<string, FirstRunImportStoredClient[]>();
  for (const client of clients) {
    for (const digest of client.addressDigests) add(byAddressDigest, digest, client);
  }
  return { byCode, byName, byEmail, byPhone, byAddress, byAddressDigest };
}

function storedClientDuplicateIssuesByCriterion(
  values: FirstRunImportClientValues,
  stored: ReturnType<typeof storedClientIndexes>,
) {
  const email = values.client.primaryContact?.email ?? null;
  const phone = phoneValue(values.client.primaryContact?.phone ?? null).key;
  const keys = {
    code: codeKey(values.sourceClientCode),
    name: normalizeClientNameKey(values.client.name),
    email: emailValue(email).value,
    phone,
    address: addressKey(values.address),
  };
  const storedIndexes = {
    code: stored.byCode,
    name: stored.byName,
    email: stored.byEmail,
    phone: stored.byPhone,
  };
  const labels = {
    code: "client code",
    name: "client name",
    email: "contact email",
    phone: "contact phone",
  };
  const issues: Record<"code" | "name" | "email" | "phone" | "address", FirstRunImportIssue[]> = {
    code: [],
    name: [],
    email: [],
    phone: [],
    address: [],
  };
  for (const criterion of ["code", "name", "email", "phone"] as const) {
    const key = keys[criterion];
    if (!key) continue;
    const storedMatches = storedIndexes[criterion].get(key) ?? [];
    if (storedMatches.length > 0) {
      issues[criterion].push(issue(
        `duplicate_${criterion}`,
        `This ${labels[criterion]} matches an existing client.`,
        storedMatches.map(({ id }) => id),
      ));
    }
  }
  if (keys.address) {
    const storedMatches = [
      ...(stored.byAddress.get(keys.address) ?? []),
      ...(values.addressDigest
        ? stored.byAddressDigest.get(values.addressDigest) ?? []
        : []),
    ].filter((client, index, matches) => (
      matches.findIndex(({ id }) => id === client.id) === index
    ));
    if (storedMatches.length > 0) {
      issues.address.push(issue(
        "duplicate_address",
        "This address matches an existing client.",
        storedMatches.map(({ id }) => id),
      ));
    }
  }
  return issues;
}

/**
 * SET-25's canonical existing-client matcher. New review-first intake paths use
 * this entry point instead of inventing another normalization or match policy.
 */
export async function matchFirstRunClientDuplicates(input: Readonly<{
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
}>, clients: readonly FirstRunImportStoredClient[]) {
  const name = normalizedText(input.name, 180);
  const email = emailValue(input.email ?? null);
  const phone = phoneValue(input.phone ?? null);
  const address = optionalText(input.address ?? null, 300);
  if (!name || !email.valid || !phone.valid || (input.address && !address)) {
    return Object.freeze([]) as readonly FirstRunImportIssue[];
  }
  const normalizedAddress = addressKey(address);
  const addressDigest = normalizedAddress
    ? await sha256(`client-address\u0000${normalizedAddress}`)
    : null;
  const normalized = normalizeClientCreation({
    name,
    primaryContact: email.value || phone.value
      ? {
          name,
          email: email.value ?? undefined,
          phone: phone.value ?? undefined,
          role: "Primary contact",
        }
      : undefined,
  });
  if (!normalized.ok) return Object.freeze([]) as readonly FirstRunImportIssue[];
  const issues = storedClientDuplicateIssuesByCriterion(Object.freeze({
    sourceClientCode: null,
    persistedClientCode: null,
    client: normalized.value,
    address,
    addressDigest,
  }), storedClientIndexes(clients));
  return Object.freeze([
    ...issues.code,
    ...issues.name,
    ...issues.email,
    ...issues.phone,
    ...issues.address,
  ]);
}

async function normalizeClientRows(
  sourceRows: ReturnType<typeof spreadsheetRows>,
) {
  return Promise.all(sourceRows.map(async ({ rowNumber, cells }): Promise<NormalizedClientRow> => {
    const [
      rawCode,
      rawName,
      rawStatus,
      rawIndustry,
      rawContactName,
      rawEmail,
      rawPhone,
      rawAddress,
    ] = cells;
    const issues: FirstRunImportIssue[] = [];
    const name = normalizedText(rawName, 180);
    const sourceClientCode = optionalText(rawCode, 80);
    const industry = optionalText(rawIndustry, 80);
    const contactName = optionalText(rawContactName, 160);
    const email = emailValue(rawEmail);
    const phone = phoneValue(rawPhone);
    const address = optionalText(rawAddress, 300);
    const normalizedAddress = addressKey(address);
    const addressDigest = normalizedAddress
      ? await sha256(`client-address\u0000${normalizedAddress}`)
      : null;

    if (!name) issues.push(issue("client_name_invalid", "Enter a client or company name."));
    if (rawCode.trim() && !sourceClientCode) {
      issues.push(issue("client_code_invalid", "The source client code is too long or invalid."));
    }
    if (rawIndustry.trim() && !industry) {
      issues.push(issue("client_industry_invalid", "The client industry is too long or invalid."));
    }
    if (rawContactName.trim() && !contactName) {
      issues.push(issue("contact_name_invalid", "The primary contact name is too long or invalid."));
    }
    if (!email.valid) issues.push(issue("contact_email_invalid", "Enter a valid contact email."));
    if (!phone.valid) issues.push(issue("contact_phone_invalid", "Enter a valid contact phone."));
    if (rawAddress.trim() && !address) {
      issues.push(issue("client_address_invalid", "The duplicate-review address is too long or invalid."));
    }
    if ((email.value || phone.value) && !contactName) {
      issues.push(issue(
        "contact_name_required",
        "Add a primary contact name when an email or phone is supplied.",
      ));
    }

    let normalized: NormalizedClientCreation | null = null;
    if (name) {
      const result = normalizeClientCreation({
        name,
        status: rawStatus || undefined,
        industry: industry ?? undefined,
        primaryContact: contactName
          ? {
              name: contactName,
              email: email.value ?? undefined,
              phone: phone.value ?? undefined,
              role: "Primary contact",
            }
          : undefined,
      });
      if (result.ok) normalized = result.value;
      else issues.push(issue("client_values_invalid", result.message));
    }
    const persistedClientCode = sourceClientCode
      && /^CL-[A-Z0-9]{8}$/u.test(sourceClientCode.toUpperCase())
      ? sourceClientCode.toUpperCase()
      : null;
    return Object.freeze({
      rowKey: await rowKey("clients", rowNumber, cells),
      rowNumber,
      values: normalized
        ? Object.freeze({
            sourceClientCode,
            persistedClientCode,
            client: normalized,
            address,
            addressDigest,
          })
        : null,
      issues: uniqueIssues(issues),
      testData: Boolean(name && isMarkedTestData(name)),
    });
  }));
}

function clientDuplicateIssues(
  row: NormalizedClientRow,
  rows: readonly NormalizedClientRow[],
  stored: ReturnType<typeof storedClientIndexes>,
) {
  if (!row.values) return [];
  const storedIssues = storedClientDuplicateIssuesByCriterion(row.values, stored);
  const issues: FirstRunImportIssue[] = [];
  const email = row.values.client.primaryContact?.email ?? null;
  const phone = phoneValue(row.values.client.primaryContact?.phone ?? null).key;
  const keys = {
    code: codeKey(row.values.sourceClientCode),
    name: normalizeClientNameKey(row.values.client.name),
    email: emailValue(email).value,
    phone,
    address: addressKey(row.values.address),
  };
  const rowIndexes = {
    code: duplicateIndex(rows, (candidate) => codeKey(candidate.values?.sourceClientCode ?? null)),
    name: duplicateIndex(rows, (candidate) => candidate.values
      ? normalizeClientNameKey(candidate.values.client.name)
      : null),
    email: duplicateIndex(rows, (candidate) => emailValue(
      candidate.values?.client.primaryContact?.email ?? null,
    ).value),
    phone: duplicateIndex(rows, (candidate) => phoneValue(
      candidate.values?.client.primaryContact?.phone ?? null,
    ).key),
    address: duplicateIndex(rows, (candidate) => addressKey(candidate.values?.address ?? null)),
  };
  const labels = {
    code: "client code",
    name: "client name",
    email: "contact email",
    phone: "contact phone",
  };
  for (const criterion of ["code", "name", "email", "phone"] as const) {
    const key = keys[criterion];
    if (!key) continue;
    issues.push(...storedIssues[criterion]);
    if ((rowIndexes[criterion].get(key)?.length ?? 0) > 1) {
      issues.push(issue(
        `duplicate_import_${criterion}`,
        `This ${labels[criterion]} appears more than once in the import.`,
      ));
    }
  }
  if (keys.address) {
    issues.push(...storedIssues.address);
    if ((rowIndexes.address.get(keys.address)?.length ?? 0) > 1) {
      issues.push(issue(
        "duplicate_import_address",
        "This address appears more than once in the import.",
      ));
    }
  }
  return issues;
}

async function previewClients(
  values: readonly (readonly string[])[],
  expectedHeaders: readonly string[],
  snapshot: FirstRunImportSnapshot,
): Promise<FirstRunImportPreview> {
  const rows = await normalizeClientRows(spreadsheetRows(values, expectedHeaders));
  const stored = storedClientIndexes(snapshot.clients);
  const previewRows: FirstRunImportClientPreviewRow[] = rows.map((row) => {
    const duplicates = clientDuplicateIssues(row, rows, stored);
    const issues = uniqueIssues([...row.issues, ...duplicates]);
    const state: FirstRunImportRowState = row.issues.length > 0
      ? "invalid"
      : !FIRST_RUN_IMPORT_REAL_DATA_ALLOWED && !row.testData
        ? "blocked-real-data"
        : duplicates.length > 0
          ? "duplicate"
          : "ready";
    return Object.freeze({
      entity: "clients",
      rowKey: row.rowKey,
      rowNumber: row.rowNumber,
      state,
      issues: state === "blocked-real-data"
        ? uniqueIssues([
            ...issues,
            issue(
              "real_data_gate_closed",
              `Client names must begin with “${FIRST_RUN_IMPORT_TEST_MARKER}” until WS-11 is approved.`,
            ),
          ])
        : issues,
      values: row.values,
    });
  });
  const counts = Object.freeze(recordCount(previewRows));
  return Object.freeze({
    entity: "clients",
    rows: Object.freeze(previewRows),
    counts,
    total: previewRows.length,
    confirmable: counts.ready,
  });
}

async function normalizeProjectRows(
  sourceRows: ReturnType<typeof spreadsheetRows>,
) {
  return Promise.all(sourceRows.map(async ({ rowNumber, cells }): Promise<NormalizedProjectRow> => {
    const [
      rawName,
      rawClientCode,
      rawClientName,
      rawClientEmail,
      rawSite,
      rawStatus,
      rawEstimatedValue,
      rawFlooringCategory,
      rawSquareFeet,
      rawContractValue,
      rawSegment,
    ] = cells;
    const issues: FirstRunImportIssue[] = [];
    const name = normalizedText(rawName, 180);
    const clientCode = optionalText(rawClientCode, 80);
    const clientName = optionalText(rawClientName, 180);
    const clientEmail = emailValue(rawClientEmail);
    const site = optionalText(rawSite, MAX_ADDRESS_LENGTH);
    const estimatedValue = integerValue(rawEstimatedValue);
    const squareFeet = integerValue(rawSquareFeet, { positive: true });
    const contractValue = integerValue(rawContractValue);
    if (!name) issues.push(issue("project_name_invalid", "Enter a project name."));
    if (rawClientCode.trim() && !clientCode) {
      issues.push(issue("project_client_code_invalid", "The client code is too long or invalid."));
    }
    if (rawClientName.trim() && !clientName) {
      issues.push(issue("project_client_name_invalid", "The client name is too long or invalid."));
    }
    if (!clientEmail.valid) {
      issues.push(issue("project_client_email_invalid", "Enter a valid client email."));
    }
    if (!clientCode && !clientName && !clientEmail.value) {
      issues.push(issue(
        "project_client_reference_required",
        "Add a client code, client name, or client email for review.",
      ));
    }
    if (rawSite.trim() && !site) issues.push(issue("project_site_invalid", "The site is too long or invalid."));
    if (!estimatedValue.valid) issues.push(issue("estimated_value_invalid", "Estimated value must be a non-negative whole number."));
    if (!squareFeet.valid) issues.push(issue("square_feet_invalid", "Square feet must be a positive whole number."));
    if (!contractValue.valid) issues.push(issue("contract_value_invalid", "Contract value must be a non-negative whole number."));

    let projectWithoutClient: Omit<NormalizedProjectCreation, "clientId"> | null = null;
    if (name) {
      const result = normalizeProjectCreation({
        clientId: "preview-client",
        name,
        status: rawStatus || undefined,
        site: site ?? undefined,
        estimatedValue: estimatedValue.value,
        flooringCategory: rawFlooringCategory || null,
        squareFeet: squareFeet.value,
        contractValue: contractValue.value,
        segment: rawSegment || null,
      });
      if (result.ok) {
        const project = result.value;
        projectWithoutClient = Object.freeze({
          name: project.name,
          status: project.status,
          site: project.site,
          projectManagerId: project.projectManagerId,
          estimatedValue: project.estimatedValue,
          flooringCategory: project.flooringCategory,
          squareFeet: project.squareFeet,
          contractValue: project.contractValue,
          segment: project.segment,
        });
      } else {
        issues.push(issue("project_values_invalid", result.message));
      }
    }
    return Object.freeze({
      rowKey: await rowKey("projects", rowNumber, cells),
      rowNumber,
      clientCode,
      clientName,
      clientEmail: clientEmail.value,
      projectWithoutClient,
      issues: uniqueIssues(issues),
      testData: Boolean(name && isMarkedTestData(name)),
    });
  }));
}

function resolvedProjectClient(
  row: NormalizedProjectRow,
  indexes: ReturnType<typeof storedClientIndexes>,
  clients: readonly FirstRunImportStoredClient[],
  override: string | undefined,
) {
  const references = [
    row.clientCode
      ? indexes.byCode.get(codeKey(row.clientCode) ?? "") ?? []
      : null,
    row.clientName
      ? indexes.byName.get(normalizeClientNameKey(row.clientName)) ?? []
      : null,
    row.clientEmail
      ? indexes.byEmail.get(row.clientEmail) ?? []
      : null,
  ].filter((matches): matches is FirstRunImportStoredClient[] => matches !== null);
  let natural: {
    client: FirstRunImportStoredClient | null;
    resolution: "matched" | null;
    issue: FirstRunImportIssue | null;
  };
  if (
    references.length === 0
    || references.some((matches) => matches.length === 0)
  ) {
    natural = {
      client: null,
      resolution: null,
      issue: issue(
        "project_client_unmatched",
        "No saved client matches every supplied code, name, and email reference.",
      ),
    };
  } else {
    const candidates = [...new Set(references.flat().map(({ id }) => id))];
    const oneClient = candidates.length === 1
      && references.every((matches) => matches.length === 1 && matches[0]?.id === candidates[0]);
    natural = oneClient
      ? {
          client: clients.find(({ id }) => id === candidates[0]) ?? null,
          resolution: "matched",
          issue: null,
        }
      : {
          client: null,
          resolution: null,
          issue: issue(
            "project_client_ambiguous",
            "The supplied client references do not resolve to one saved client.",
            candidates,
          ),
        };
  }
  if (!override) return natural;
  const selected = clients.find(({ id }) => id === override);
  if (!selected) {
    return {
      client: null,
      resolution: null,
      issue: issue(
        "project_client_override_invalid",
        "The reviewed client override no longer exists.",
      ),
    };
  }
  if (natural.client && natural.client.id !== selected.id) {
    return {
      client: null,
      resolution: null,
      issue: issue(
        "project_client_override_conflict",
        "A reviewed override cannot replace an exact client match.",
        [natural.client.id],
      ),
    };
  }
  if (natural.client) return natural;
  return {
    client: selected,
    resolution: "reviewed-override" as const,
    issue: null,
  };
}

async function previewProjects(
  values: readonly (readonly string[])[],
  expectedHeaders: readonly string[],
  snapshot: FirstRunImportSnapshot,
  clientOverrides: Readonly<Record<string, string>>,
): Promise<FirstRunImportPreview> {
  const rows = await normalizeProjectRows(spreadsheetRows(values, expectedHeaders));
  const indexes = storedClientIndexes(snapshot.clients);
  const resolved = rows.map((row) => ({
    row,
    match: resolvedProjectClient(
      row,
      indexes,
      snapshot.clients,
      clientOverrides[row.rowKey],
    ),
  }));
  const importedDuplicateIndex = duplicateIndex(resolved, ({ row, match }) => (
    row.projectWithoutClient && match.client
      ? [
          match.client.id,
          normalizeClientNameKey(row.projectWithoutClient.name),
          addressKey(row.projectWithoutClient.site) ?? "",
        ].join("\u0000")
      : null
  ));
  const storedDuplicates = new Set(snapshot.projects.map((project) => [
    project.clientId,
    normalizeClientNameKey(project.name),
    addressKey(project.site) ?? "",
  ].join("\u0000")));

  const previewRows: FirstRunImportProjectPreviewRow[] = resolved.map(({ row, match }) => {
    const issues = [...row.issues];
    if (match.issue) issues.push(match.issue);
    const tuple = row.projectWithoutClient && match.client
      ? [
          match.client.id,
          normalizeClientNameKey(row.projectWithoutClient.name),
          addressKey(row.projectWithoutClient.site) ?? "",
        ].join("\u0000")
      : null;
    let duplicate = false;
    if (tuple && storedDuplicates.has(tuple)) {
      duplicate = true;
      issues.push(issue(
        "duplicate_project",
        "A project with this client, name, and site already exists.",
      ));
    }
    if (tuple && (importedDuplicateIndex.get(tuple)?.length ?? 0) > 1) {
      duplicate = true;
      issues.push(issue(
        "duplicate_import_project",
        "This client, project name, and site appears more than once in the import.",
      ));
    }
    const state: FirstRunImportRowState = row.issues.length > 0
      ? "invalid"
      : !FIRST_RUN_IMPORT_REAL_DATA_ALLOWED && !row.testData
        ? "blocked-real-data"
        : match.issue?.code === "project_client_ambiguous"
          ? "ambiguous-client"
          : match.issue?.code === "project_client_unmatched"
            ? "unmatched-client"
            : match.issue
              ? "invalid"
              : duplicate
                ? "duplicate"
                : "ready";
    const project = row.projectWithoutClient && match.client
      ? Object.freeze({
          ...row.projectWithoutClient,
          clientId: match.client.id,
        })
      : null;
    return Object.freeze({
      entity: "projects",
      rowKey: row.rowKey,
      rowNumber: row.rowNumber,
      state,
      issues: state === "blocked-real-data"
        ? uniqueIssues([
            ...issues,
            issue(
              "real_data_gate_closed",
              `Project names must begin with “${FIRST_RUN_IMPORT_TEST_MARKER}” until WS-11 is approved.`,
            ),
          ])
        : uniqueIssues(issues),
      values: Object.freeze({
        clientCode: row.clientCode,
        clientName: row.clientName,
        clientEmail: row.clientEmail,
        projectDraft: row.projectWithoutClient,
        project,
        resolvedClient: match.client && match.resolution
          ? Object.freeze({
              id: match.client.id,
              clientCode: match.client.clientCode,
              name: match.client.name,
              industry: match.client.industry ?? null,
              resolution: match.resolution,
            })
          : null,
      }),
    });
  });
  const counts = Object.freeze(recordCount(previewRows));
  return Object.freeze({
    entity: "projects",
    rows: Object.freeze(previewRows),
    counts,
    total: previewRows.length,
    confirmable: counts.ready,
  });
}

export async function previewFirstRunImport(input: Readonly<{
  entity: FirstRunImportEntity;
  values: readonly (readonly string[])[];
  expectedHeaders: readonly string[];
  snapshot: FirstRunImportSnapshot;
  clientOverrides?: Readonly<Record<string, string>>;
}>): Promise<FirstRunImportPreview> {
  return input.entity === "clients"
    ? previewClients(input.values, input.expectedHeaders, input.snapshot)
    : previewProjects(
        input.values,
        input.expectedHeaders,
        input.snapshot,
        input.clientOverrides ?? {},
      );
}

export function parseFirstRunImportCsv(csv: string) {
  if (typeof csv !== "string" || !csv.trim()) {
    throw new FirstRunImportValidationError(
      "import_csv_empty",
      "Choose a non-empty CSV file.",
    );
  }
  if (csv.includes("\u0000")) {
    throw new FirstRunImportValidationError(
      "import_csv_invalid",
      "The CSV file contains unsupported control characters.",
    );
  }
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (quoted) {
      if (character === "\"") {
        if (csv[index + 1] === "\"") {
          field += "\"";
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (character === "\"" && field === "") {
      quoted = true;
      continue;
    }
    if (character === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (character === "\r" || character === "\n") {
      if (character === "\r" && csv[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += character;
  }
  if (quoted) {
    throw new FirstRunImportValidationError(
      "import_csv_invalid",
      "The CSV file contains an unterminated quoted field.",
    );
  }
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return Object.freeze(rows.map((cells) => Object.freeze(cells)));
}
