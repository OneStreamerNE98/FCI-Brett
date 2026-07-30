import { normalizeClientNameKey } from "../../domain/client-name-key.ts";
import type { D1Database, D1PreparedStatement } from "./d1-database.ts";
import type {
  FirstRunImportClientCreate,
  FirstRunImportCreateResult,
  FirstRunImportProjectCreate,
  FirstRunImportRepository,
  FirstRunImportStoredClient,
} from "../../ports/first-run-import-repository.ts";

type ClientContactRow = Readonly<{
  id: string;
  client_code: string;
  name: string;
  industry: string | null;
  email: string | null;
  phone: string | null;
}>;

type ClientAddressRow = Readonly<{
  client_id: string;
  site: string;
}>;

type ProjectRow = Readonly<{
  id: string;
  client_id: string;
  name: string;
  site: string | null;
}>;

type ImportedClientProvenanceRow = Readonly<{
  record_id: string;
  detail: string | null;
}>;

type FirstRunImportWriteFence = Readonly<{
  operationKey: string;
  leaseExpiresAt: number;
}>;

export class FirstRunImportLeaseLostError extends Error {
  constructor() {
    super("The first-run import lease expired or was replaced before the write completed.");
    this.name = "FirstRunImportLeaseLostError";
  }
}

function encodedDetailValue(value: string) {
  return encodeURIComponent(value.replace(/[\uD800-\uDFFF]/gu, "\uFFFD"));
}

function encodedSourceClientCode(value: string | null | undefined) {
  if (!value) return null;
  return encodedDetailValue(
    value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase(),
  );
}

function provenanceDetail(
  provenance: FirstRunImportClientCreate["provenance"],
) {
  return [
    "SET-25 first-run import",
    `source=${provenance.sourceKind}`,
    `row=${provenance.sourceRow}`,
    ...(encodedSourceClientCode(provenance.sourceClientCode)
      ? [`sourceClientCode=${encodedSourceClientCode(provenance.sourceClientCode)}`]
      : []),
    ...(provenance.sourceAddressDigest
      ? [`sourceAddressDigest=${provenance.sourceAddressDigest}`]
      : []),
    "testData=true",
  ].join(" · ");
}

function clientRows(
  contacts: readonly ClientContactRow[],
  addresses: readonly ClientAddressRow[],
  importedProvenance: readonly ImportedClientProvenanceRow[],
): FirstRunImportStoredClient[] {
  const byId = new Map<string, {
    id: string;
    clientCode: string;
    name: string;
    industry: string | null;
    sourceClientCodes: Set<string>;
    emails: Set<string>;
    phones: Set<string>;
    addresses: Set<string>;
    addressDigests: Set<string>;
  }>();
  for (const row of contacts) {
    const current = byId.get(row.id) ?? {
      id: row.id,
      clientCode: row.client_code,
      name: row.name,
      industry: row.industry,
      sourceClientCodes: new Set<string>(),
      emails: new Set<string>(),
      phones: new Set<string>(),
      addresses: new Set<string>(),
      addressDigests: new Set<string>(),
    };
    if (row.email?.trim()) current.emails.add(row.email);
    if (row.phone?.trim()) current.phones.add(row.phone);
    byId.set(row.id, current);
  }
  for (const row of addresses) {
    const current = byId.get(row.client_id);
    if (current && row.site.trim()) current.addresses.add(row.site);
  }
  for (const row of importedProvenance) {
    const current = byId.get(row.record_id);
    const encodedCode = row.detail?.match(
      /(?:^| · )sourceClientCode=([^ ·]+)(?: · |$)/u,
    )?.[1];
    const addressDigest = row.detail?.match(
      /(?:^| · )sourceAddressDigest=([0-9a-f]{64})(?: · |$)/u,
    )?.[1];
    if (!current) continue;
    if (encodedCode) {
      try {
        const decoded = decodeURIComponent(encodedCode).trim();
        if (decoded) current.sourceClientCodes.add(decoded);
      } catch {
        // A malformed legacy detail is ignored rather than widening a match.
      }
    }
    if (addressDigest) current.addressDigests.add(addressDigest);
  }
  return [...byId.values()].map((row) => Object.freeze({
    id: row.id,
    clientCode: row.clientCode,
    sourceClientCodes: Object.freeze([...row.sourceClientCodes]),
    name: row.name,
    industry: row.industry,
    emails: Object.freeze([...row.emails]),
    phones: Object.freeze([...row.phones]),
    addresses: Object.freeze([...row.addresses]),
    addressDigests: Object.freeze([...row.addressDigests]),
  }));
}

function clientStatements(
  database: D1Database,
  row: FirstRunImportClientCreate,
  fence: FirstRunImportWriteFence,
) {
  const emailKey = row.primaryContact?.email?.trim().toLowerCase() ?? null;
  const phoneKey = row.primaryContact?.phone?.replace(/\D/gu, "") || null;
  const sourceClientCode = encodedSourceClientCode(row.provenance.sourceClientCode);
  const addressDigest = row.provenance.sourceAddressDigest ?? null;
  const normalizedNameKey = normalizeClientNameKey(row.name);
  const statements: D1PreparedStatement[] = [];
  const insertIndex = statements.length;
  statements.push(
    database.prepare(
      "INSERT INTO clients (id, client_code, name, normalized_name_key, status, industry, created_by, created_at, updated_at) "
      + "SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? "
      + "WHERE NOT EXISTS (SELECT 1 FROM clients WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) "
      + "OR normalized_name_key = ? OR client_code = ? LIMIT 1) "
      + "AND (? IS NULL OR NOT EXISTS (SELECT 1 FROM contacts WHERE LOWER(TRIM(COALESCE(email, ''))) = ? LIMIT 1)) "
      + "AND (? IS NULL OR NOT EXISTS (SELECT 1 FROM contacts WHERE "
      + "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(phone, '')), ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), '.', ''), '/', '') = ? LIMIT 1)) "
      + "AND (? IS NULL OR NOT EXISTS (SELECT 1 FROM projects WHERE LOWER(TRIM(COALESCE(site, ''))) = LOWER(TRIM(?)) LIMIT 1)) "
      + "AND (? IS NULL OR NOT EXISTS (SELECT 1 FROM activity_events WHERE action = 'Client imported' "
      + "AND INSTR(COALESCE(detail, ''), 'sourceClientCode=' || ? || ' ·') > 0 LIMIT 1)) "
      + "AND (? IS NULL OR NOT EXISTS (SELECT 1 FROM activity_events WHERE action = 'Client imported' "
      + "AND INSTR(COALESCE(detail, ''), 'sourceAddressDigest=' || ?) > 0 LIMIT 1)) "
      + "AND EXISTS (SELECT 1 FROM google_drive_operations WHERE operation_key = ? "
      + "AND status = 'committing' AND lease_expires_at = ?)",
    ).bind(
      row.id,
      row.clientCode,
      row.name,
      normalizedNameKey,
      row.status,
      row.industry,
      row.actor,
      row.createdAt,
      row.createdAt,
      row.name,
      normalizedNameKey,
      row.clientCode,
      emailKey,
      emailKey,
      phoneKey,
      phoneKey,
      row.duplicateAddress,
      row.duplicateAddress,
      sourceClientCode,
      sourceClientCode,
      addressDigest,
      addressDigest,
      fence.operationKey,
      fence.leaseExpiresAt,
    ),
  );
  statements.push(
    database.prepare(
      "INSERT INTO activity_events (id, record_id, action, actor, detail, created_at) "
      + "SELECT ?, ?, 'Client imported', ?, ?, ? "
      + "WHERE EXISTS (SELECT 1 FROM clients WHERE id = ? AND client_code = ? AND name = ? AND created_by = ? AND created_at = ?)",
    ).bind(
      row.activityId,
      row.id,
      row.actor,
      provenanceDetail(row.provenance),
      row.createdAt,
      row.id,
      row.clientCode,
      row.name,
      row.actor,
      row.createdAt,
    ),
  );
  if (row.primaryContact) {
    statements.push(
      database.prepare(
        "INSERT INTO contacts (id, client_id, name, email, phone, role, is_primary, created_at, updated_at) "
        + "SELECT ?, ?, ?, ?, ?, ?, 1, ?, ? "
        + "WHERE EXISTS (SELECT 1 FROM clients WHERE id = ? AND client_code = ? AND name = ? AND created_by = ? AND created_at = ?)",
      ).bind(
        row.primaryContact.id,
        row.id,
        row.primaryContact.name,
        row.primaryContact.email,
        row.primaryContact.phone,
        row.primaryContact.role,
        row.createdAt,
        row.createdAt,
        row.id,
        row.clientCode,
        row.name,
        row.actor,
        row.createdAt,
      ),
    );
  }
  return { statements, insertIndex };
}

function projectStatements(
  database: D1Database,
  row: FirstRunImportProjectCreate,
  fence: FirstRunImportWriteFence,
) {
  const insert = database.prepare(
    "INSERT INTO projects (id, project_number, client_id, name, status, site, project_manager, estimated_value, flooring_category, square_feet, contract_value, segment, created_by, created_at, updated_at) "
    + "SELECT ?, ?, c.id, ?, ?, ?, ?, ?, ?, ?, ?, "
    + "CASE WHEN ? = 'residential' THEN 'residential' WHEN ? = 'commercial' THEN 'commercial' "
    + "WHEN LOWER(TRIM(COALESCE(c.industry, ''))) = 'residential' THEN 'residential' ELSE 'commercial' END, ?, ?, ? "
    + "FROM clients c WHERE c.id = ? "
    + "AND EXISTS (SELECT 1 FROM google_drive_operations WHERE operation_key = ? "
    + "AND status = 'committing' AND lease_expires_at = ?) "
    + "AND NOT EXISTS ("
    + "SELECT 1 FROM projects p WHERE p.client_id = c.id "
    + "AND LOWER(TRIM(p.name)) = LOWER(TRIM(?)) "
    + "AND LOWER(TRIM(COALESCE(p.site, ''))) = LOWER(TRIM(COALESCE(?, ''))) LIMIT 1)",
  ).bind(
    row.id,
    row.projectNumber,
    row.name,
    row.status,
    row.site,
    row.projectManagerId,
    row.estimatedValue,
    row.flooringCategory,
    row.squareFeet,
    row.contractValue,
    row.segment,
    row.segment,
    row.actor,
    row.createdAt,
    row.createdAt,
    row.clientId,
    fence.operationKey,
    fence.leaseExpiresAt,
    row.name,
    row.site,
  );
  const activity = database.prepare(
    "INSERT INTO activity_events (id, record_id, action, actor, detail, created_at) "
    + "SELECT ?, ?, 'Project imported', ?, ?, ? "
    + "WHERE EXISTS (SELECT 1 FROM projects WHERE id = ? AND project_number = ? AND name = ? AND created_by = ? AND created_at = ?)",
  ).bind(
    row.activityId,
    row.id,
    row.actor,
    provenanceDetail(row.provenance),
    row.createdAt,
    row.id,
    row.projectNumber,
    row.name,
    row.actor,
    row.createdAt,
  );
  return [insert, activity] as const;
}

function leaseCommitClaimStatement(
  database: D1Database,
  fence: FirstRunImportWriteFence,
  now: number,
) {
  return database.prepare(
    "UPDATE google_drive_operations SET status = 'committing', updated_at = ? "
    + "WHERE operation_key = ? AND status = 'in-progress' AND lease_expires_at = ? "
    + "AND lease_expires_at > CAST(strftime('%s', 'now') AS INTEGER) * 1000",
  ).bind(now, fence.operationKey, fence.leaseExpiresAt);
}

function leaseCompletionStatement(
  database: D1Database,
  fence: FirstRunImportWriteFence,
  now: number,
) {
  return database.prepare(
    "UPDATE google_drive_operations SET status = 'completed', lease_expires_at = NULL, "
    + "last_error_code = NULL, updated_at = ? WHERE operation_key = ? "
    + "AND status = 'committing' AND lease_expires_at = ?",
  ).bind(now, fence.operationKey, fence.leaseExpiresAt);
}

async function completeNoopLease(
  database: D1Database,
  fence: FirstRunImportWriteFence,
) {
  const now = Date.now();
  const results = await database.batch([
    leaseCommitClaimStatement(database, fence, now),
    leaseCompletionStatement(database, fence, now),
  ]);
  if (
    results[0]?.meta.changes !== 1
    || results[1]?.meta.changes !== 1
  ) {
    throw new FirstRunImportLeaseLostError();
  }
}

export function createD1FirstRunImportRepository(
  database: D1Database,
  writeFence?: FirstRunImportWriteFence,
): FirstRunImportRepository {
  return {
    async snapshot() {
      const [contacts, addresses, projects, importedProvenance] = await Promise.all([
        database.prepare(
          "SELECT c.id, c.client_code, c.name, c.industry, ct.email, ct.phone "
          + "FROM clients c LEFT JOIN contacts ct ON ct.client_id = c.id "
          + "ORDER BY c.name ASC, ct.is_primary DESC, ct.created_at ASC",
        ).all<ClientContactRow>(),
        database.prepare(
          "SELECT client_id, site FROM projects WHERE site IS NOT NULL AND TRIM(site) <> '' ORDER BY client_id ASC",
        ).all<ClientAddressRow>(),
        database.prepare(
          "SELECT id, client_id, name, site FROM projects ORDER BY created_at ASC",
        ).all<ProjectRow>(),
        database.prepare(
          "SELECT record_id, detail FROM activity_events "
          + "WHERE action = 'Client imported' AND detail IS NOT NULL ORDER BY created_at ASC",
        ).all<ImportedClientProvenanceRow>(),
      ]);
      return Object.freeze({
        clients: Object.freeze(clientRows(
          contacts.results,
          addresses.results,
          importedProvenance.results,
        )),
        projects: Object.freeze(projects.results.map((row) => Object.freeze({
          id: row.id,
          clientId: row.client_id,
          name: row.name,
          site: row.site,
        }))),
      });
    },

    async createClients(rows) {
      if (!writeFence) throw new FirstRunImportLeaseLostError();
      if (rows.length === 0) {
        await completeNoopLease(database, writeFence);
        return [];
      }
      const claimIndex = 0;
      const statements: D1PreparedStatement[] = [
        leaseCommitClaimStatement(database, writeFence, Date.now()),
      ];
      const positions: number[] = [];
      for (const row of rows) {
        const built = clientStatements(database, row, writeFence);
        positions.push(statements.length + built.insertIndex);
        statements.push(...built.statements);
      }
      const completionIndex = statements.length;
      statements.push(leaseCompletionStatement(database, writeFence, Date.now()));
      const results = await database.batch(statements);
      if (
        results[claimIndex]?.meta.changes !== 1
        || results[completionIndex]?.meta.changes !== 1
      ) {
        throw new FirstRunImportLeaseLostError();
      }
      return rows.map((row, index): FirstRunImportCreateResult => Object.freeze({
        id: results[positions[index]]?.meta.changes === 1 ? row.id : null,
        identifier: results[positions[index]]?.meta.changes === 1
          ? row.clientCode
          : null,
        outcome: results[positions[index]]?.meta.changes === 1 ? "created" : "duplicate",
      }));
    },

    async createProjects(rows) {
      if (!writeFence) throw new FirstRunImportLeaseLostError();
      if (rows.length === 0) {
        await completeNoopLease(database, writeFence);
        return [];
      }
      const claimIndex = 0;
      const statements: D1PreparedStatement[] = [
        leaseCommitClaimStatement(database, writeFence, Date.now()),
      ];
      const positions: number[] = [];
      for (const row of rows) {
        positions.push(statements.length);
        statements.push(...projectStatements(database, row, writeFence));
      }
      const completionIndex = statements.length;
      statements.push(leaseCompletionStatement(database, writeFence, Date.now()));
      const results = await database.batch(statements);
      if (
        results[claimIndex]?.meta.changes !== 1
        || results[completionIndex]?.meta.changes !== 1
      ) {
        throw new FirstRunImportLeaseLostError();
      }
      return Promise.all(rows.map(async (row, index): Promise<FirstRunImportCreateResult> => {
        if (results[positions[index]]?.meta.changes === 1) {
          return Object.freeze({
            id: row.id,
            identifier: row.projectNumber,
            outcome: "created",
          });
        }
        const client = await database.prepare(
          "SELECT id FROM clients WHERE id = ? LIMIT 1",
        ).bind(row.clientId).first<{ id: string }>();
        return Object.freeze({
          id: null,
          identifier: null,
          outcome: client ? "duplicate" : "missing-client",
        });
      }));
    },
  };
}
