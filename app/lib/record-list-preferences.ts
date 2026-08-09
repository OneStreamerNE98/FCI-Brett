export type RecordListPage = "leads" | "clients" | "projects";
export type RecordListSortDirection = "ascending" | "descending";
export type LeadRecordView = "board" | "list";

export const RECORD_LIST_SORT_KEYS = {
  leads: ["client", "stage", "value", "next"],
  clients: ["client", "contact", "projects"],
  projects: ["project", "status", "schedule", "value"],
} as const satisfies Record<RecordListPage, readonly string[]>;

export type RecordListSortKey<Page extends RecordListPage> = typeof RECORD_LIST_SORT_KEYS[Page][number];

export type RecordListPreferences = {
  leads: { view: LeadRecordView; sortKey: RecordListSortKey<"leads">; sortDirection: RecordListSortDirection };
  clients: { sortKey: RecordListSortKey<"clients">; sortDirection: RecordListSortDirection };
  projects: { sortKey: RecordListSortKey<"projects">; sortDirection: RecordListSortDirection };
};

export const DEFAULT_RECORD_LIST_PREFERENCES: RecordListPreferences = Object.freeze({
  leads: Object.freeze({ view: "board", sortKey: "client", sortDirection: "ascending" }),
  clients: Object.freeze({ sortKey: "client", sortDirection: "ascending" }),
  projects: Object.freeze({ sortKey: "project", sortDirection: "ascending" }),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isDirection(value: unknown): value is RecordListSortDirection {
  return value === "ascending" || value === "descending";
}

function normalizePagePreference<Page extends RecordListPage>(
  page: Page,
  value: unknown,
): RecordListPreferences[Page] {
  const fallback = DEFAULT_RECORD_LIST_PREFERENCES[page];
  if (!isRecord(value)) return { ...fallback };
  const sortKey = typeof value.sortKey === "string"
    && (RECORD_LIST_SORT_KEYS[page] as readonly string[]).includes(value.sortKey)
    ? value.sortKey as RecordListSortKey<Page>
    : fallback.sortKey;
  const sortDirection = isDirection(value.sortDirection) ? value.sortDirection : fallback.sortDirection;
  if (page === "leads") {
    return {
      view: value.view === "list" ? "list" : "board",
      sortKey,
      sortDirection,
    } as RecordListPreferences[Page];
  }
  return { sortKey, sortDirection } as RecordListPreferences[Page];
}

export function normalizeRecordListPreferences(value: unknown): RecordListPreferences {
  const record = isRecord(value) ? value : {};
  return {
    leads: normalizePagePreference("leads", record.leads),
    clients: normalizePagePreference("clients", record.clients),
    projects: normalizePagePreference("projects", record.projects),
  };
}

export function parseStoredRecordListPreferences(value: string | null | undefined): RecordListPreferences {
  if (!value) return normalizeRecordListPreferences(null);
  try {
    const stored = JSON.parse(value) as unknown;
    return normalizeRecordListPreferences(isRecord(stored) ? stored.recordLists : null);
  } catch {
    return normalizeRecordListPreferences(null);
  }
}

export function normalizeRecordListPreferencesForWrite(value: unknown): RecordListPreferences | null {
  if (!isRecord(value) || Object.keys(value).length !== 3) return null;
  for (const page of Object.keys(RECORD_LIST_SORT_KEYS) as RecordListPage[]) {
    const pageValue = value[page];
    if (!isRecord(pageValue)) return null;
    const expectedKeys = page === "leads" ? ["view", "sortKey", "sortDirection"] : ["sortKey", "sortDirection"];
    if (Object.keys(pageValue).length !== expectedKeys.length || expectedKeys.some((key) => !Object.hasOwn(pageValue, key))) return null;
    if (typeof pageValue.sortKey !== "string" || !(RECORD_LIST_SORT_KEYS[page] as readonly string[]).includes(pageValue.sortKey)) return null;
    if (!isDirection(pageValue.sortDirection)) return null;
    if (page === "leads" && pageValue.view !== "board" && pageValue.view !== "list") return null;
  }
  return normalizeRecordListPreferences(value);
}
