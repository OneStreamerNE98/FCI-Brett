"use client";

import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  RefreshCw,
  ShieldCheck,
  Upload,
} from "lucide-react";
import {
  OperationsDataTable,
  OperationsDataTableCell,
  type OperationsDataTableColumn,
} from "../../components/operations/OperationsDataTable";
import {
  FIRST_RUN_IMPORT_GATE_NOTICE,
  FIRST_RUN_IMPORT_TEST_MARKER,
} from "../../domain/first-run-import";
import styles from "./FirstRunImportCard.module.css";

const IMPORT_STATUS_PATH = "/api/v1/settings/first-run-import";
const IMPORT_PREVIEW_PATH = `${IMPORT_STATUS_PATH}/preview`;
const IMPORT_CONFIRM_PATH = `${IMPORT_STATUS_PATH}/confirm`;
const IMPORT_CLIENT_SEARCH_PATH = `${IMPORT_STATUS_PATH}/clients`;
const MAX_CSV_FILE_BYTES = 256_000;

type ImportEntity = "clients" | "projects";
type ImportRowState =
  | "ready"
  | "duplicate"
  | "invalid"
  | "blocked-real-data"
  | "unmatched-client"
  | "ambiguous-client";
type ImportRequestSource =
  | Readonly<{ kind: "spreadsheet"; spreadsheetKey: string }>
  | Readonly<{ kind: "csv"; fileName: string; content: string }>;
type ImportSourceDescriptor =
  | Readonly<{ kind: "spreadsheet"; spreadsheetKey: string }>
  | Readonly<{ kind: "csv"; fileName: string }>;

type ImportStatus = Readonly<{
  counts: Readonly<{ clients: number; projects: number }>;
  recordsExist: boolean;
  realDataAllowed: false;
  batchLimit: number;
  simulation: boolean;
  sources: readonly Readonly<{ key: string; name: string; ready: boolean }>[];
}>;

type ClientOption = Readonly<{
  id: string;
  code: string;
  name: string;
  email?: string;
  defaultSegment: "commercial" | "residential";
}>;

type PreviewRow = Readonly<{
  rowKey: string;
  rowNumber: number;
  state: ImportRowState;
  reasons: readonly string[];
  values: Readonly<Record<string, unknown>>;
  clientId?: string;
  matchedClient?: ClientOption;
}>;

type ImportPreview = Readonly<{
  entity: ImportEntity;
  source: ImportSourceDescriptor;
  rows: readonly PreviewRow[];
  summary: unknown;
  clientOptions: readonly ClientOption[];
  clientOptionsTruncated: boolean;
}>;

type ClientSearchResult = Readonly<{
  clients: readonly ClientOption[];
  more: boolean;
}>;

type ConfirmationResult = Readonly<{
  entity: ImportEntity;
  created: number;
  duplicates: number;
  rejected: number;
  results: readonly unknown[];
}>;

type CsvSelection = Readonly<{
  fileName: string;
  content: string;
}>;

type LoadState = "loading" | "ready" | "error";
type SourceKind = ImportRequestSource["kind"];

const CLIENT_COLUMNS = [
  { key: "select", label: "Select" },
  { key: "row", label: "Client" },
  { key: "values", label: "Imported values" },
  { key: "state", label: "Review state" },
] as const satisfies readonly OperationsDataTableColumn[];

const PROJECT_COLUMNS = [
  { key: "select", label: "Select" },
  { key: "row", label: "Project" },
  { key: "values", label: "Imported values" },
  { key: "state", label: "Review state" },
  { key: "client", label: "Client match" },
] as const satisfies readonly OperationsDataTableColumn[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isImportSourceDescriptor(value: unknown): value is ImportSourceDescriptor {
  if (!isRecord(value) || !["spreadsheet", "csv"].includes(String(value.kind))) return false;
  if (value.kind === "spreadsheet") {
    return typeof value.spreadsheetKey === "string"
      && value.spreadsheetKey.trim().length > 0
      && value.content === undefined;
  }
  return typeof value.fileName === "string"
    && value.fileName.trim().length > 0
    && value.content === undefined;
}

function parseStatus(value: unknown): ImportStatus | null {
  if (!isRecord(value) || !isRecord(value.counts) || !Array.isArray(value.sources)) return null;
  if (
    !nonnegativeInteger(value.counts.clients)
    || !nonnegativeInteger(value.counts.projects)
    || typeof value.recordsExist !== "boolean"
    || value.realDataAllowed !== false
    || !nonnegativeInteger(value.batchLimit)
    || value.batchLimit < 1
    || typeof value.simulation !== "boolean"
  ) return null;
  const sources = value.sources.flatMap((source) => (
    isRecord(source)
    && typeof source.key === "string"
    && source.key.trim().length > 0
    && typeof source.name === "string"
    && source.name.trim().length > 0
    && typeof source.ready === "boolean"
      ? [{ key: source.key, name: source.name, ready: source.ready }]
      : []
  ));
  if (sources.length !== value.sources.length) return null;
  return {
    counts: {
      clients: value.counts.clients as number,
      projects: value.counts.projects as number,
    },
    recordsExist: value.recordsExist,
    realDataAllowed: false,
    batchLimit: value.batchLimit,
    simulation: value.simulation,
    sources,
  };
}

function parseClientOption(value: unknown): ClientOption | null {
  if (
    !isRecord(value)
    || typeof value.id !== "string"
    || typeof value.code !== "string"
    || typeof value.name !== "string"
    || (value.email !== undefined && typeof value.email !== "string")
    || !["commercial", "residential"].includes(String(value.defaultSegment))
  ) return null;
  return {
    id: value.id,
    code: value.code,
    name: value.name,
    ...(typeof value.email === "string" ? { email: value.email } : {}),
    defaultSegment: value.defaultSegment as "commercial" | "residential",
  };
}

function parseClientSearchResult(value: unknown): ClientSearchResult | null {
  if (!isRecord(value) || !Array.isArray(value.results) || typeof value.more !== "boolean") {
    return null;
  }
  const clients = value.results.map(parseClientOption);
  if (clients.some((client) => client === null)) return null;
  return {
    clients: clients as ClientOption[],
    more: value.more,
  };
}

function parsePreviewRow(value: unknown): PreviewRow | null {
  if (
    !isRecord(value)
    || typeof value.rowKey !== "string"
    || !nonnegativeInteger(value.rowNumber)
    || ![
      "ready",
      "duplicate",
      "invalid",
      "blocked-real-data",
      "unmatched-client",
      "ambiguous-client",
    ].includes(String(value.state))
    || !Array.isArray(value.reasons)
    || !value.reasons.every((reason) => typeof reason === "string")
    || !isRecord(value.values)
    || (value.clientId !== undefined && typeof value.clientId !== "string")
  ) return null;
  const matchedClient = value.matchedClient === undefined
    ? undefined
    : parseClientOption(value.matchedClient);
  if (value.matchedClient !== undefined && !matchedClient) return null;
  return {
    rowKey: value.rowKey,
    rowNumber: value.rowNumber as number,
    state: value.state as ImportRowState,
    reasons: value.reasons,
    values: value.values,
    ...(typeof value.clientId === "string" ? { clientId: value.clientId } : {}),
    ...(matchedClient ? { matchedClient } : {}),
  };
}

function parsePreview(value: unknown): ImportPreview | null {
  if (
    !isRecord(value)
    || !["clients", "projects"].includes(String(value.entity))
    || !isImportSourceDescriptor(value.source)
    || !Array.isArray(value.rows)
    || !Array.isArray(value.clientOptions)
    || typeof value.clientOptionsTruncated !== "boolean"
  ) return null;
  const rows = value.rows.map(parsePreviewRow);
  const clientOptions = value.clientOptions.map(parseClientOption);
  if (rows.some((row) => row === null) || clientOptions.some((client) => client === null)) return null;
  if (
    value.entity === "projects"
    && rows.some((row) => (
      row?.state === "ready"
      && (!row.clientId || !row.matchedClient)
    ))
  ) return null;
  return {
    entity: value.entity as ImportEntity,
    source: value.source.kind === "spreadsheet"
      ? { kind: "spreadsheet", spreadsheetKey: value.source.spreadsheetKey }
      : { kind: "csv", fileName: value.source.fileName },
    rows: rows as PreviewRow[],
    summary: value.summary,
    clientOptions: clientOptions as ClientOption[],
    clientOptionsTruncated: value.clientOptionsTruncated,
  };
}

function parseConfirmation(value: unknown): ConfirmationResult | null {
  if (
    !isRecord(value)
    || !["clients", "projects"].includes(String(value.entity))
    || !nonnegativeInteger(value.created)
    || !nonnegativeInteger(value.duplicates)
    || !nonnegativeInteger(value.rejected)
    || !Array.isArray(value.results)
  ) return null;
  return {
    entity: value.entity as ImportEntity,
    created: value.created as number,
    duplicates: value.duplicates as number,
    rejected: value.rejected as number,
    results: value.results,
  };
}

function importError(value: unknown, fallback: string) {
  return isRecord(value) && typeof value.error === "string" && value.error.trim()
    ? value.error
    : fallback;
}

async function readJson(response: Response) {
  return response.json().catch(() => null) as Promise<unknown>;
}

async function requestImportStatus(signal?: AbortSignal) {
  const response = await fetch(IMPORT_STATUS_PATH, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal,
  });
  const body = await readJson(response);
  const parsed = response.ok ? parseStatus(body) : null;
  if (!parsed) throw new Error(importError(body, "Import readiness could not be loaded."));
  return parsed;
}

function displayValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return "";
}

function firstValue(values: Readonly<Record<string, unknown>>, keys: readonly string[]) {
  for (const key of keys) {
    const value = displayValue(values[key]);
    if (value) return value;
  }
  return "";
}

function optionalDisplay(value: unknown) {
  return displayValue(value) || "Not supplied";
}

function moneyDisplay(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(value)
    : "Not supplied";
}

function rowPresentation(
  entity: ImportEntity,
  row: PreviewRow,
  reviewedClient?: ClientOption,
) {
  if (entity === "clients") {
    const name = firstValue(row.values, ["name", "clientName", "client_name", "company", "client"]);
    const code = firstValue(row.values, ["code", "clientCode", "client_code"]);
    const codeDisposition = firstValue(row.values, ["codeDisposition"]);
    const codeDetail = code
      ? codeDisposition === "preserved"
        ? `Source code ${code} · saved as the client code`
        : `Source code ${code} · kept as an import alias; FCI assigns the client code`
      : "FCI assigns the client code at confirmation";
    return {
      title: name || `Client row ${row.rowNumber}`,
      identity: `${codeDetail} · Spreadsheet row ${row.rowNumber}`,
      values: [
        `Status: ${optionalDisplay(row.values.status)}`,
        `Industry: ${optionalDisplay(row.values.industry)}`,
        `Primary contact: ${optionalDisplay(row.values.primaryContact)}`,
        `Email: ${optionalDisplay(row.values.email)}`,
        `Phone: ${optionalDisplay(row.values.phone)}`,
        `Address (duplicate review; readable value not saved): ${optionalDisplay(row.values.address)}`,
      ].join(" · "),
    };
  }
  const name = firstValue(row.values, ["name", "projectName", "project_name", "project"]);
  const clientReferences = [
    firstValue(row.values, ["clientCode", "client_code"])
      ? `code ${firstValue(row.values, ["clientCode", "client_code"])}`
      : "",
    firstValue(row.values, ["clientName", "client_name", "client"])
      ? `name ${firstValue(row.values, ["clientName", "client_name", "client"])}`
      : "",
    firstValue(row.values, ["clientEmail", "client_email"])
      ? `email ${firstValue(row.values, ["clientEmail", "client_email"])}`
      : "",
  ].filter(Boolean);
  const explicitSegment = firstValue(row.values, ["segmentSource"]) === "explicit";
  const segment = explicitSegment
    ? optionalDisplay(row.values.segment)
    : reviewedClient?.defaultSegment ?? optionalDisplay(row.values.segment);
  const segmentDetail = explicitSegment
    ? segment
    : segment === "Not supplied"
      ? "Choose a client to derive"
      : `${segment} (derived from client industry)`;
  return {
    title: name || `Project row ${row.rowNumber}`,
    identity: clientReferences.length > 0
      ? `Client references: ${clientReferences.join(" · ")} · Spreadsheet row ${row.rowNumber}`
      : `Spreadsheet row ${row.rowNumber}`,
    values: [
      `Status: ${optionalDisplay(row.values.status)}`,
      `Site: ${optionalDisplay(row.values.site)}`,
      `Estimated value: ${moneyDisplay(row.values.estimatedValue)}`,
      `Flooring category: ${optionalDisplay(row.values.flooringCategory)}`,
      `Square feet: ${optionalDisplay(row.values.squareFeet)}`,
      `Contract value: ${moneyDisplay(row.values.contractValue)}`,
      `Segment: ${segmentDetail}`,
      "Project manager: confirming administrator",
    ].join(" · "),
  };
}

function rowStatePresentation(row: PreviewRow, hasManualClientMatch: boolean) {
  if (row.state === "ready") return { label: "Ready", detail: row.reasons.join(" ") || "Ready for your confirmation.", ready: true };
  if (row.state === "duplicate") return { label: "Duplicate", detail: row.reasons.join(" ") || "An existing record matches this row.", ready: false };
  if (["unmatched-client", "ambiguous-client"].includes(row.state) && hasManualClientMatch) {
    return {
      label: "Ready",
      detail: [
        row.reasons.join(" "),
        "Reviewed override: you selected an existing client for this project.",
      ].filter(Boolean).join(" "),
      ready: true,
    };
  }
  if (row.state === "unmatched-client") return { label: "Needs client match", detail: row.reasons.join(" ") || "Choose an existing client before importing this project.", ready: false };
  if (row.state === "ambiguous-client") return { label: "Ambiguous client match", detail: row.reasons.join(" ") || "More than one client matches. Choose the exact saved client.", ready: false };
  if (row.state === "blocked-real-data") return { label: "Blocked", detail: row.reasons.join(" ") || "This row is outside the current test-data boundary.", ready: false };
  return { label: "Invalid", detail: row.reasons.join(" ") || "Correct the source row and preview again.", ready: false };
}

function sourceLabel(source: ImportSourceDescriptor) {
  return source.kind === "spreadsheet" ? "Workspace import spreadsheet" : source.fileName;
}

function normalizedCsvFileName(value: string) {
  return value.split(/[\\/]/u).at(-1)?.normalize("NFKC").trim() ?? "";
}

function sourceDescriptorMatches(
  source: ImportRequestSource,
  descriptor: ImportSourceDescriptor,
) {
  if (source.kind === "spreadsheet" && descriptor.kind === "spreadsheet") {
    return source.spreadsheetKey === descriptor.spreadsheetKey;
  }
  return source.kind === "csv"
    && descriptor.kind === "csv"
    && normalizedCsvFileName(source.fileName) === normalizedCsvFileName(descriptor.fileName);
}

function entityLabel(entity: ImportEntity) {
  return entity === "clients" ? "clients" : "projects";
}

function pluralRows(count: number) {
  return `${count} row${count === 1 ? "" : "s"}`;
}

function Notice({
  kind,
  icon,
  children,
}: {
  kind: "gate" | "error" | "source" | "confirmation";
  icon: ReactNode;
  children: ReactNode;
}) {
  const className = kind === "gate"
    ? styles.gateNotice
    : kind === "error"
      ? styles.errorNotice
      : kind === "confirmation"
        ? styles.confirmationSummary
        : styles.sourceNotice;
  return <div className={className} role={kind === "error" ? "alert" : undefined}>
    {icon}
    <div>{children}</div>
  </div>;
}

export function FirstRunImportCard({
  onImportConfirmed,
}: {
  onImportConfirmed: () => Promise<void>;
}) {
  const headingId = useId();
  const sourceHeadingId = useId();
  const previewHeadingId = useId();
  const sourceHeadingRef = useRef<HTMLDivElement>(null);
  const previewHeadingRef = useRef<HTMLDivElement>(null);
  const reopenButtonRef = useRef<HTMLButtonElement>(null);
  const pendingReopenFocusRef = useRef<number | null>(null);
  const requestGenerationRef = useRef(0);
  const clientSearchGenerationRef = useRef(0);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [opened, setOpened] = useState(false);
  const [entity, setEntity] = useState<ImportEntity>("clients");
  const [sourceKind, setSourceKind] = useState<SourceKind>("spreadsheet");
  const [spreadsheetKey, setSpreadsheetKey] = useState("");
  const [csvSelections, setCsvSelections] = useState<Partial<Record<ImportEntity, CsvSelection>>>({});
  const [readingFile, setReadingFile] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [selectedRows, setSelectedRows] = useState<ReadonlySet<string>>(() => new Set());
  const [clientMatches, setClientMatches] = useState<Readonly<Record<string, string>>>({});
  const [clientSearchQuery, setClientSearchQuery] = useState("");
  const [clientSearchResults, setClientSearchResults] = useState<readonly ClientOption[]>([]);
  const [clientSearchBusy, setClientSearchBusy] = useState(false);
  const [clientSearchError, setClientSearchError] = useState("");
  const [clientSearchMessage, setClientSearchMessage] = useState("");
  const [busyAction, setBusyAction] = useState<"preview" | "confirm" | null>(null);
  const [error, setError] = useState("");
  const [liveMessage, setLiveMessage] = useState("");
  const [lastConfirmation, setLastConfirmation] = useState<ConfirmationResult | null>(null);

  // "Reopen import tools" only mounts in the commit that collapses the card, and a
  // requestAnimationFrame callback carries no ordering guarantee against that commit
  // under concurrent React — the focus call would silently no-op and never retry.
  // Queue the handoff before the state change and complete it after a commit instead.
  useEffect(() => {
    const generation = pendingReopenFocusRef.current;
    if (generation === null) return;
    if (requestGenerationRef.current !== generation) {
      pendingReopenFocusRef.current = null;
      return;
    }
    const button = reopenButtonRef.current;
    if (!button) return;
    pendingReopenFocusRef.current = null;
    button.focus();
  });

  function invalidatePendingRequests() {
    requestGenerationRef.current += 1;
    setBusyAction(null);
    return requestGenerationRef.current;
  }

  function beginRequest(action: "preview" | "confirm") {
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    setBusyAction(action);
    return generation;
  }

  function clearClientSearch() {
    clientSearchGenerationRef.current += 1;
    setClientSearchQuery("");
    setClientSearchResults([]);
    setClientSearchBusy(false);
    setClientSearchError("");
    setClientSearchMessage("");
  }

  async function loadStatus(
    signal?: AbortSignal,
    expectedGeneration?: number,
  ): Promise<ImportStatus | null> {
    const isCurrent = () => (
      expectedGeneration === undefined || requestGenerationRef.current === expectedGeneration
    );
    if (!isCurrent()) return null;
    setLoadState("loading");
    setError("");
    try {
      const parsed = await requestImportStatus(signal);
      if (!isCurrent()) return null;
      setStatus(parsed);
      setSpreadsheetKey((current) => {
        const currentReady = parsed.sources.some((source) => source.key === current && source.ready);
        return currentReady ? current : parsed.sources.find((source) => source.ready)?.key ?? "";
      });
      setOpened((current) => current || !parsed.recordsExist);
      setLoadState("ready");
      return parsed;
    } catch (caught) {
      if (!isCurrent() || (caught instanceof DOMException && caught.name === "AbortError")) return null;
      setError(caught instanceof Error ? caught.message : "Import readiness could not be loaded.");
      setLoadState("error");
      return null;
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void requestImportStatus(controller.signal).then((parsed) => {
      setStatus(parsed);
      setSpreadsheetKey(parsed.sources.find((source) => source.ready)?.key ?? "");
      setOpened(!parsed.recordsExist);
      setLoadState("ready");
    }).catch((caught: unknown) => {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(caught instanceof Error ? caught.message : "Import readiness could not be loaded.");
      setLoadState("error");
    });
    return () => {
      controller.abort();
      requestGenerationRef.current += 1;
      clientSearchGenerationRef.current += 1;
    };
  }, []);

  const clientStepReady = Boolean(
    (status?.counts.clients ?? 0) > 0
    || (lastConfirmation?.entity === "clients" && lastConfirmation.created > 0),
  );
  const currentCsv = csvSelections[entity];
  const readySpreadsheet = status?.sources.find((source) => source.key === spreadsheetKey && source.ready) ?? null;
  const canPreview = sourceKind === "spreadsheet" ? Boolean(readySpreadsheet) : Boolean(currentCsv);
  const interactionLocked = busyAction !== null || readingFile || clientSearchBusy;

  function resetReview(nextEntity = entity) {
    setEntity(nextEntity);
    setPreview(null);
    setSelectedRows(new Set());
    setClientMatches({});
    clearClientSearch();
    setError("");
    setLastConfirmation(null);
    setLiveMessage("");
  }

  function chooseEntity(nextEntity: ImportEntity) {
    if (nextEntity === "projects" && !clientStepReady) return;
    invalidatePendingRequests();
    resetReview(nextEntity);
  }

  function chooseSource(nextKind: SourceKind) {
    invalidatePendingRequests();
    setSourceKind(nextKind);
    setPreview(null);
    setSelectedRows(new Set());
    setClientMatches({});
    clearClientSearch();
    setError("");
    setLastConfirmation(null);
    setLiveMessage("");
  }

  function chooseSpreadsheet(nextSpreadsheetKey: string) {
    invalidatePendingRequests();
    setSpreadsheetKey(nextSpreadsheetKey);
    setPreview(null);
    setSelectedRows(new Set());
    setClientMatches({});
    clearClientSearch();
    setError("");
    setLastConfirmation(null);
    setLiveMessage("");
  }

  async function chooseCsvFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    const generation = invalidatePendingRequests();
    setReadingFile(false);
    setCsvSelections((current) => {
      const next = { ...current };
      delete next[entity];
      return next;
    });
    setPreview(null);
    setSelectedRows(new Set());
    setClientMatches({});
    clearClientSearch();
    setLastConfirmation(null);
    setLiveMessage("");
    if (file.size > MAX_CSV_FILE_BYTES) {
      setError("Choose a CSV file no larger than 256 KB.");
      input.value = "";
      return;
    }
    const fileName = normalizedCsvFileName(file.name);
    setReadingFile(true);
    setError("");
    try {
      const content = await file.text();
      if (requestGenerationRef.current !== generation) return;
      setCsvSelections((current) => ({
        ...current,
        [entity]: { fileName, content },
      }));
      setPreview(null);
      setSelectedRows(new Set());
      setClientMatches({});
      clearClientSearch();
    } catch {
      if (requestGenerationRef.current !== generation) return;
      setError("That CSV file could not be read. Choose the file again.");
      input.value = "";
    } finally {
      if (requestGenerationRef.current === generation) setReadingFile(false);
    }
  }

  function currentSource(): ImportRequestSource | null {
    if (sourceKind === "spreadsheet") {
      return readySpreadsheet ? { kind: "spreadsheet", spreadsheetKey: readySpreadsheet.key } : null;
    }
    return currentCsv ? { kind: "csv", fileName: currentCsv.fileName, content: currentCsv.content } : null;
  }

  async function previewImport() {
    const source = currentSource();
    if (!source) return;
    const requestEntity = entity;
    const generation = beginRequest("preview");
    setError("");
    setLiveMessage("");
    setLastConfirmation(null);
    try {
      const response = await fetch(IMPORT_PREVIEW_PATH, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ entity: requestEntity, source }),
      });
      const body = await readJson(response);
      const parsed = response.ok ? parsePreview(body) : null;
      if (requestGenerationRef.current !== generation) return;
      if (
        !parsed
        || parsed.entity !== requestEntity
        || !sourceDescriptorMatches(source, parsed.source)
      ) {
        throw new Error(importError(body, `The ${entityLabel(requestEntity)} preview could not be prepared.`));
      }
      setPreview(parsed);
      setSelectedRows(new Set());
      setClientMatches({});
      const readyCount = parsed.rows.filter((row) => row.state === "ready").length;
      setLiveMessage(`${pluralRows(parsed.rows.length)} reviewed. ${pluralRows(readyCount)} ready for confirmation.`);
      requestAnimationFrame(() => {
        if (requestGenerationRef.current === generation) previewHeadingRef.current?.focus();
      });
    } catch (caught) {
      if (requestGenerationRef.current !== generation) return;
      setPreview(null);
      setError(caught instanceof Error ? caught.message : `The ${entityLabel(requestEntity)} preview could not be prepared.`);
    } finally {
      if (requestGenerationRef.current === generation) setBusyAction(null);
    }
  }

  function rowEligible(row: PreviewRow) {
    return (
      row.state === "ready"
      && (
        entity === "clients"
        || Boolean(row.clientId && row.matchedClient)
      )
    ) || (
      entity === "projects"
      && ["unmatched-client", "ambiguous-client"].includes(row.state)
      && Boolean(clientMatches[row.rowKey])
    );
  }

  function toggleRow(row: PreviewRow, checked: boolean) {
    if (!rowEligible(row)) return;
    setSelectedRows((current) => {
      const next = new Set(current);
      if (checked) next.add(row.rowKey);
      else next.delete(row.rowKey);
      return next;
    });
  }

  function selectAllReady() {
    if (!preview) return;
    const eligible = preview.rows.filter(rowEligible).map((row) => row.rowKey);
    setSelectedRows((current) => {
      const allSelected = eligible.length > 0 && eligible.every((rowKey) => current.has(rowKey));
      return allSelected ? new Set() : new Set(eligible);
    });
  }

  function setClientMatch(row: PreviewRow, clientId: string) {
    setClientMatches((current) => ({ ...current, [row.rowKey]: clientId }));
    if (!clientId) {
      setSelectedRows((current) => {
        const next = new Set(current);
        next.delete(row.rowKey);
        return next;
      });
    }
  }

  async function searchSavedClients(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = clientSearchQuery.normalize("NFKC").replace(/\s+/gu, " ").trim();
    if (query.length < 2 || query.length > 100) {
      setClientSearchError("Enter 2 to 100 characters to find a saved client.");
      setClientSearchMessage("");
      return;
    }
    const sourceGeneration = requestGenerationRef.current;
    const searchGeneration = clientSearchGenerationRef.current + 1;
    clientSearchGenerationRef.current = searchGeneration;
    setClientSearchBusy(true);
    setClientSearchError("");
    setClientSearchMessage("");
    try {
      const response = await fetch(
        `${IMPORT_CLIENT_SEARCH_PATH}?q=${encodeURIComponent(query)}`,
        { cache: "no-store", headers: { Accept: "application/json" } },
      );
      const body = await readJson(response);
      const parsed = response.ok ? parseClientSearchResult(body) : null;
      if (
        requestGenerationRef.current !== sourceGeneration
        || clientSearchGenerationRef.current !== searchGeneration
      ) return;
      if (!parsed) {
        throw new Error(importError(body, "Saved clients could not be searched."));
      }
      setClientSearchResults((current) => {
        const unique = new Map(
          [...current, ...parsed.clients].map((client) => [client.id, client]),
        );
        const selectedIds = new Set(Object.values(clientMatches));
        const pinned = [...unique.values()].filter(({ id }) => selectedIds.has(id));
        const remaining = [...unique.values()].filter(({ id }) => !selectedIds.has(id));
        const capacity = Math.max(0, 100 - pinned.length);
        return capacity > 0
          ? [...pinned, ...remaining.slice(-capacity)]
          : pinned.slice(0, 100);
      });
      setClientSearchMessage(
        parsed.clients.length === 0
          ? "No saved clients matched that search."
          : `${parsed.clients.length} saved client${parsed.clients.length === 1 ? "" : "s"} added to the client-match choices.${parsed.more ? " Narrow the search to see a specific client." : ""}`,
      );
    } catch (caught) {
      if (
        requestGenerationRef.current !== sourceGeneration
        || clientSearchGenerationRef.current !== searchGeneration
      ) return;
      setClientSearchError(
        caught instanceof Error ? caught.message : "Saved clients could not be searched.",
      );
    } finally {
      if (
        requestGenerationRef.current === sourceGeneration
        && clientSearchGenerationRef.current === searchGeneration
      ) setClientSearchBusy(false);
    }
  }

  async function confirmImport() {
    if (!preview || selectedRows.size === 0 || interactionLocked) return;
    const source = currentSource();
    const sourceMatchesPreview = source ? sourceDescriptorMatches(source, preview.source) : false;
    if (!source || !sourceMatchesPreview) {
      const invalidationGeneration = invalidatePendingRequests();
      setPreview(null);
      setSelectedRows(new Set());
      setClientMatches({});
      setError("The import source changed after preview. Choose the source and preview it again.");
      requestAnimationFrame(() => {
        if (requestGenerationRef.current === invalidationGeneration) sourceHeadingRef.current?.focus();
      });
      return;
    }
    const rows = preview.rows
      .filter((row) => selectedRows.has(row.rowKey) && rowEligible(row))
      .flatMap((row) => {
        if (entity === "clients") return [{ rowKey: row.rowKey }];
        const clientId = clientMatches[row.rowKey] ?? row.clientId;
        const client = availableClientOptions.find(({ id }) => id === clientId);
        const importedSegment = row.values.segment;
        const effectiveSegment = importedSegment === "commercial" || importedSegment === "residential"
          ? importedSegment
          : client?.defaultSegment;
        return clientId && effectiveSegment
          ? [{ rowKey: row.rowKey, clientId, effectiveSegment }]
          : [];
      });
    if (rows.length === 0) return;
    const requestEntity = entity;
    const generation = beginRequest("confirm");
    setError("");
    setLiveMessage("");
    try {
      const response = await fetch(IMPORT_CONFIRM_PATH, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ entity: requestEntity, source, rows }),
      });
      const body = await readJson(response);
      const parsed = response.ok ? parseConfirmation(body) : null;
      if (!parsed || parsed.entity !== requestEntity) {
        throw new Error(importError(body, `The selected ${entityLabel(requestEntity)} could not be imported.`));
      }
      if (parsed.created > 0) void onImportConfirmed();
      if (requestGenerationRef.current !== generation) return;
      setLastConfirmation(parsed);
      setPreview(null);
      setSelectedRows(new Set());
      setClientMatches({});
      clearClientSearch();
      setLiveMessage(
        `${parsed.created} created, ${parsed.duplicates} duplicate${parsed.duplicates === 1 ? "" : "s"}, and ${parsed.rejected} rejected.`,
      );
      const refreshedStatus = await loadStatus(undefined, generation);
      if (requestGenerationRef.current !== generation) return;
      const projectStepNowReady = (
        (refreshedStatus?.counts.clients ?? status?.counts.clients ?? 0) > 0
        || parsed.created > 0
      );
      if (requestEntity === "projects" && refreshedStatus?.recordsExist) {
        pendingReopenFocusRef.current = generation;
        setOpened(false);
      } else if (requestEntity === "clients" && projectStepNowReady) {
        const nextGeneration = invalidatePendingRequests();
        setEntity("projects");
        requestAnimationFrame(() => {
          if (requestGenerationRef.current === nextGeneration) sourceHeadingRef.current?.focus();
        });
      } else {
        requestAnimationFrame(() => {
          if (requestGenerationRef.current === generation) sourceHeadingRef.current?.focus();
        });
      }
    } catch (caught) {
      if (requestGenerationRef.current !== generation) return;
      setError(caught instanceof Error ? caught.message : `The selected ${entityLabel(requestEntity)} could not be imported.`);
    } finally {
      if (requestGenerationRef.current === generation) setBusyAction(null);
    }
  }

  const eligibleRows = preview?.rows.filter(rowEligible) ?? [];
  const allEligibleSelected = eligibleRows.length > 0 && eligibleRows.every((row) => selectedRows.has(row.rowKey));
  const previewColumns = entity === "clients" ? CLIENT_COLUMNS : PROJECT_COLUMNS;
  const availableClientOptions = [
    ...new Map(
      [...(preview?.clientOptions ?? []), ...clientSearchResults]
        .map((client) => [client.id, client]),
    ).values(),
  ];

  return <section className={`panel settings-form-panel ${styles.card}`} aria-labelledby={headingId}>
    <div className="settings-heading">
      <div>
        <p className="eyebrow">First-run setup</p>
        <h2 id={headingId}>First-run data import</h2>
        <p>Preview existing clients first, then projects. Nothing is created until you select rows and confirm them.</p>
      </div>
      <div className={styles.headerActions}>
        {status?.simulation && <span className="status status-inactive">Simulation</span>}
        {loadState === "ready" && <span className={`status ${status?.recordsExist ? "status-connected" : "status-inactive"}`}>
          {status?.recordsExist ? "Records present" : "Ready to preview"}
        </span>}
      </div>
    </div>

    <Notice kind="gate" icon={<ShieldCheck size={18} aria-hidden="true" />}>
      <strong>Development test data only</strong>
      <span>{FIRST_RUN_IMPORT_GATE_NOTICE}</span>
      <span>Use records whose names begin with {FIRST_RUN_IMPORT_TEST_MARKER}.</span>
    </Notice>

    {loadState === "loading" && <Notice kind="source" icon={<RefreshCw size={18} aria-hidden="true" />}>
      <strong>Checking first-run import readiness…</strong>
      <span>The app is checking saved record counts and available import-role spreadsheets.</span>
    </Notice>}

    {loadState === "error" && <Notice kind="error" icon={<AlertTriangle size={18} aria-hidden="true" />}>
      <strong>Import readiness is unavailable</strong>
      <span>{error}</span>
      <button className="soft-button" type="button" onClick={() => void loadStatus()}><RefreshCw size={14} aria-hidden="true" /> Retry</button>
    </Notice>}

    {loadState === "ready" && status?.recordsExist && !opened && <div className={styles.collapsedSummary}>
      {lastConfirmation && <>
        <strong>{lastConfirmation.entity === "clients" ? "Client" : "Project"} confirmation complete</strong>
        <p>{lastConfirmation.created} created · {lastConfirmation.duplicates} duplicates skipped · {lastConfirmation.rejected} rejected</p>
      </>}
      <p>The first-run tools are hidden because saved records already exist. Reopen them only when you intend to review another test-data batch.</p>
      <ul className={styles.countList} aria-label="Existing saved record counts">
        <li>{status.counts.clients} client{status.counts.clients === 1 ? "" : "s"}</li>
        <li>{status.counts.projects} project{status.counts.projects === 1 ? "" : "s"}</li>
      </ul>
      <div><button ref={reopenButtonRef} className="soft-button" type="button" onClick={() => {
        setOpened(true);
        requestAnimationFrame(() => sourceHeadingRef.current?.focus());
      }}>Reopen import tools</button></div>
    </div>}

    {loadState === "ready" && status && opened && <div className={styles.flow}>
      <div className={styles.stepNavigation} aria-label="Import order">
        <button className={styles.stepButton} type="button" aria-current={entity === "clients" ? "step" : undefined} disabled={interactionLocked} onClick={() => chooseEntity("clients")}>
          <strong>1 · Clients</strong>
          <span>Review duplicates, then confirm selected clients.</span>
        </button>
        <button
          className={styles.stepButton}
          type="button"
          aria-current={entity === "projects" ? "step" : undefined}
          aria-describedby={!clientStepReady ? `${sourceHeadingId}-projects-locked` : undefined}
          disabled={!clientStepReady || interactionLocked}
          onClick={() => chooseEntity("projects")}
        >
          <strong>2 · Projects</strong>
          <span>{clientStepReady ? "Match every project to a saved client." : "Unlocks after at least one client is saved."}</span>
        </button>
      </div>
      {!clientStepReady && <p className="form-help" id={`${sourceHeadingId}-projects-locked`}>Projects stay locked until the client step has an existing or newly confirmed client.</p>}

      <div ref={sourceHeadingRef} tabIndex={-1} className={styles.previewHeading}>
        <h3 id={sourceHeadingId}>Choose the {entityLabel(entity)} source</h3>
        <p>Workspace spreadsheets use the clearly marked import tab. CSV files are read only for this preview and are not stored as uploads.</p>
      </div>

      {entity === "clients" && <Notice kind="source" icon={<ShieldCheck size={18} aria-hidden="true" />}>
        <strong>Client address is used for duplicate review only</strong>
        <span>The importer does not save the readable Client Address on the client record. It records only a one-way duplicate-check fingerprint for safe re-runs — it cannot be read back by inspection, but a low-entropy address stays a stable identifier, so treat it as one.</span>
      </Notice>}

      <fieldset className={styles.sourceFieldset} aria-labelledby={sourceHeadingId}>
        <legend>Import source</legend>
        <div className={styles.sourceChoices}>
          <label className={styles.sourceChoice}>
            <input type="radio" name={`first-run-source-${entity}`} value="spreadsheet" checked={sourceKind === "spreadsheet"} disabled={interactionLocked} onChange={() => chooseSource("spreadsheet")} />
            <span><strong>Workspace spreadsheet</strong><span>Read the {entity === "clients" ? "Clients Import" : "Projects Import"} tab through the existing Sheets connection.</span></span>
          </label>
          <label className={styles.sourceChoice}>
            <input type="radio" name={`first-run-source-${entity}`} value="csv" checked={sourceKind === "csv"} disabled={interactionLocked} onChange={() => chooseSource("csv")} />
            <span><strong>CSV file</strong><span>Choose a bounded local CSV as an alternative to the Workspace spreadsheet.</span></span>
          </label>
        </div>

        {sourceKind === "spreadsheet" ? <label className={styles.sourceControl}>
          Import spreadsheet
          <select value={spreadsheetKey} disabled={interactionLocked} onChange={(event) => chooseSpreadsheet(event.currentTarget.value)}>
            <option value="">{status.sources.length === 0 ? "No import-role spreadsheet is registered" : "Choose an import spreadsheet"}</option>
            {status.sources.map((source) => <option key={source.key} value={source.key} disabled={!source.ready}>
              {source.name}{source.ready ? "" : " — not ready"}
            </option>)}
          </select>
          <small>{readySpreadsheet ? `Ready: ${readySpreadsheet.name}.` : "Create or adopt an import-role spreadsheet in Google Workspace Stage 3, or use CSV."}</small>
        </label> : <label className={styles.sourceControl}>
          {entity === "clients" ? "Clients" : "Projects"} CSV file
          <input key={entity} type="file" accept=".csv,text/csv" onChange={(event) => void chooseCsvFile(event)} disabled={interactionLocked} />
          <small>{readingFile ? "Reading the selected file…" : currentCsv ? `Selected: ${currentCsv.fileName}` : "Maximum file size: 256 KB. The server still validates every row."}</small>
        </label>}
      </fieldset>

      {error && <Notice kind="error" icon={<AlertTriangle size={18} aria-hidden="true" />}>
        <strong>The import could not continue</strong>
        <span>{error}</span>
      </Notice>}

      {lastConfirmation && <Notice kind="confirmation" icon={<CheckCircle2 size={18} aria-hidden="true" />}>
        <strong>{lastConfirmation.entity === "clients" ? "Client" : "Project"} confirmation complete</strong>
        <span>{lastConfirmation.created} created · {lastConfirmation.duplicates} duplicates skipped · {lastConfirmation.rejected} rejected</span>
      </Notice>}

      {!preview && <div className={styles.actions}>
        <span className={styles.toolbarCopy}>Batch limit: {status.batchLimit} rows per confirmation.</span>
        <button className="primary-button" type="button" disabled={!canPreview || readingFile || busyAction !== null} onClick={() => void previewImport()}>
          {busyAction === "preview" ? <><RefreshCw size={15} aria-hidden="true" /> Preparing preview…</> : <><FileSpreadsheet size={15} aria-hidden="true" /> Preview {entityLabel(entity)}</>}
        </button>
      </div>}

      {preview && <div className={styles.previewSection}>
        <div ref={previewHeadingRef} tabIndex={-1} className={styles.previewHeading}>
          <h3 id={previewHeadingId}>Review {entityLabel(entity)} from {sourceLabel(preview.source)}</h3>
          <p>Duplicates, invalid rows, and rows outside the test-data boundary stay unselected. Project rows need an exact saved-client match.</p>
        </div>

        <div className={styles.previewToolbar}>
          <span className={styles.toolbarCopy}>{selectedRows.size} of {eligibleRows.length} eligible rows selected</span>
          <button className="soft-button" type="button" disabled={eligibleRows.length === 0 || interactionLocked} onClick={selectAllReady}>
            {allEligibleSelected ? "Clear selection" : "Select all ready rows"}
          </button>
        </div>

        {entity === "projects" && preview.rows.some((row) => (
          ["unmatched-client", "ambiguous-client"].includes(row.state)
        )) && <form className={styles.clientSearch} onSubmit={(event) => void searchSavedClients(event)}>
          <label>
            Find another saved client
            <input
              type="search"
              value={clientSearchQuery}
              minLength={2}
              maxLength={100}
              disabled={interactionLocked}
              onChange={(event) => setClientSearchQuery(event.currentTarget.value)}
              placeholder="Client code, name, or email"
            />
          </label>
          <button className="soft-button" type="submit" disabled={interactionLocked || clientSearchQuery.trim().length < 2}>
            {clientSearchBusy ? "Searching…" : "Search saved clients"}
          </button>
          <small>
            {preview.clientOptionsTruncated
              ? "The initial list is bounded. Search by code, name, or email to reach any saved client."
              : "Search adds bounded matches to the client choices without changing the import source."}
          </small>
          {clientSearchError && <span role="alert">{clientSearchError}</span>}
          {clientSearchMessage && <span role="status">{clientSearchMessage}</span>}
        </form>}

        {preview.rows.length === 0 ? <p className={styles.emptyPreview}>No import rows were found in this source. Add clearly marked test rows, then preview again.</p> : <OperationsDataTable columns={previewColumns} labelledBy={previewHeadingId}>
          {preview.rows.map((row) => {
            const reviewedClient = row.matchedClient
              ?? availableClientOptions.find(({ id }) => id === clientMatches[row.rowKey]);
            const presentation = rowPresentation(entity, row, reviewedClient);
            const manualClientMatch = Boolean(clientMatches[row.rowKey]);
            const state = rowStatePresentation(row, manualClientMatch);
            const eligible = rowEligible(row);
            const reasonId = `${previewHeadingId}-${row.rowKey.replace(/[^a-zA-Z0-9_-]/g, "-")}-reason`;
            return <tr key={row.rowKey} data-import-row-state={row.state}>
              <OperationsDataTableCell label="Select">
                <label className={styles.rowSelect}>
                  <span className="sr-only">Import {presentation.title}</span>
                  <input
                    type="checkbox"
                    checked={selectedRows.has(row.rowKey)}
                    disabled={!eligible || interactionLocked}
                    aria-describedby={reasonId}
                    onChange={(event) => toggleRow(row, event.currentTarget.checked)}
                  />
                </label>
              </OperationsDataTableCell>
              <OperationsDataTableCell label={entity === "clients" ? "Client" : "Project"}>
                <div className={styles.identity}><strong>{presentation.title}</strong><span>{presentation.identity}</span></div>
              </OperationsDataTableCell>
              <OperationsDataTableCell label="Imported values">
                <div className={styles.values}><strong>Source row {row.rowNumber}</strong><span>{presentation.values}</span></div>
              </OperationsDataTableCell>
              <OperationsDataTableCell label="Review state">
                <div className={styles.reviewState} id={reasonId}>
                  <strong><span className={`status ${state.ready ? "status-connected" : "status-inactive"}`}>{state.label}</span></strong>
                  <span>{state.detail}</span>
                </div>
              </OperationsDataTableCell>
              {entity === "projects" && <OperationsDataTableCell label="Client match">
                {["unmatched-client", "ambiguous-client"].includes(row.state) ? <label className={styles.clientMatch}>
                  Match to saved client
                  <select
                    aria-label={`Match ${presentation.title} to saved client`}
                    aria-describedby={reasonId}
                    value={clientMatches[row.rowKey] ?? ""}
                    onChange={(event) => setClientMatch(row, event.currentTarget.value)}
                    disabled={interactionLocked}
                  >
                    <option value="">Choose a client</option>
                    {availableClientOptions.map((client) => <option key={client.id} value={client.id}>
                      {client.code ? `${client.code} · ` : ""}{client.name}{client.email ? ` · ${client.email}` : ""}
                    </option>)}
                  </select>
                  {reviewedClient && <span>Will import under {reviewedClient.code} · {reviewedClient.name}{reviewedClient.email ? ` · ${reviewedClient.email}` : ""}</span>}
                </label> : row.matchedClient ? <div className={styles.matchedClient}>
                  <strong>{row.matchedClient.code} · {row.matchedClient.name}</strong>
                  <span>{row.matchedClient.email ?? "Saved client match"}</span>
                </div> : <span>{row.clientId ? "Matched client details unavailable — preview again" : "—"}</span>}
              </OperationsDataTableCell>}
            </tr>;
          })}
        </OperationsDataTable>}

        <div className={styles.actions}>
          <button className="soft-button" type="button" disabled={interactionLocked} onClick={() => {
            const nextGeneration = invalidatePendingRequests();
            setPreview(null);
            setSelectedRows(new Set());
            setClientMatches({});
            clearClientSearch();
            requestAnimationFrame(() => {
              if (requestGenerationRef.current === nextGeneration) sourceHeadingRef.current?.focus();
            });
          }}>Choose another source</button>
          <button className="primary-button" type="button" disabled={selectedRows.size === 0 || interactionLocked} onClick={() => void confirmImport()}>
            {busyAction === "confirm" ? <><RefreshCw size={15} aria-hidden="true" /> Confirming…</> : <><Upload size={15} aria-hidden="true" /> Confirm selected {entityLabel(entity)}</>}
          </button>
        </div>
      </div>}

    </div>}
    <p className="sr-only" role="status" aria-live="polite">{liveMessage}</p>
  </section>;
}
