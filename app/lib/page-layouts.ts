export type PageLayoutAccess = "office" | "administrator";

export type PageLayoutCatalogEntry = {
  key: string;
  label: string;
  access: PageLayoutAccess;
};

/**
 * The one closed catalog for persisted page-layout keys and user-facing labels.
 * Financial child cards are intentionally not layout sections: their existing
 * authorization/redaction remains inside the parent report panels.
 */
export const PAGE_LAYOUT_SECTION_CATALOG = {
  overview: [
    { key: "metrics", label: "Overview metrics", access: "office" },
    { key: "todays-meetings", label: "Today's meetings", access: "office" },
    { key: "lead-pipeline", label: "Lead pipeline", access: "office" },
    { key: "active-projects", label: "Active projects", access: "office" },
    { key: "gmail-project-inbox", label: "Gmail project inbox", access: "office" },
  ],
  reports: [
    { key: "summary-metrics", label: "Report summary", access: "office" },
    { key: "business-kpis", label: "Business KPIs", access: "office" },
    { key: "pipeline-by-stage", label: "Pipeline by stage", access: "office" },
    { key: "projects-by-status", label: "Projects by status", access: "office" },
    { key: "clients-by-industry", label: "Clients by industry", access: "office" },
    { key: "future-reports", label: "Future reports", access: "office" },
  ],
} as const satisfies Record<string, readonly PageLayoutCatalogEntry[]>;

export type PageLayoutPage = keyof typeof PAGE_LAYOUT_SECTION_CATALOG;
export type PageLayoutSectionKey = typeof PAGE_LAYOUT_SECTION_CATALOG[PageLayoutPage][number]["key"];
export type PageLayoutSpanSize = "half" | "full";

export const PAGE_LAYOUT_RESIZABLE_SECTIONS = {
  overview: ["lead-pipeline", "active-projects", "gmail-project-inbox"],
  reports: ["pipeline-by-stage", "projects-by-status"],
} as const satisfies Record<PageLayoutPage, readonly PageLayoutSectionKey[]>;

/**
 * The curated default spans. Overview's lead pipeline is full-bleed by default, so
 * the non-editing default render, `resolveArrangedSpans`, and the editor's width
 * toggles all read one model instead of agreeing only by accident. A default span
 * must stay resizable and visible, or a default layout could not be saved back.
 */
export const PAGE_LAYOUT_DEFAULT_FULL_WIDTH = {
  overview: ["lead-pipeline"],
  reports: [],
} as const satisfies Record<PageLayoutPage, readonly PageLayoutSectionKey[]>;

export type PageLayout = {
  order: PageLayoutSectionKey[];
  hidden: PageLayoutSectionKey[];
  fullWidth: PageLayoutSectionKey[];
};

export type PageLayouts = Record<PageLayoutPage, PageLayout>;

const PAGE_LAYOUT_PAGES = Object.freeze(Object.keys(PAGE_LAYOUT_SECTION_CATALOG) as PageLayoutPage[]);
const PAGE_LAYOUT_PAGE_KEYS = new Set<string>(PAGE_LAYOUT_PAGES);
const PAGE_LAYOUT_VALUE_KEYS = new Set(["order", "hidden", "fullWidth"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>) {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isPageLayoutSectionResizable(page: PageLayoutPage, key: string) {
  return (PAGE_LAYOUT_RESIZABLE_SECTIONS[page] as readonly string[]).includes(key);
}

export function isPageLayoutCatalogEntryVisible(entry: PageLayoutCatalogEntry, isAdmin: boolean) {
  return entry.access === "office" || isAdmin;
}

export function pageLayoutSectionCatalog(page: PageLayoutPage, isAdmin: boolean): readonly PageLayoutCatalogEntry[] {
  return PAGE_LAYOUT_SECTION_CATALOG[page].filter((entry) => isPageLayoutCatalogEntryVisible(entry, isAdmin));
}

export function defaultPageLayout(page: PageLayoutPage, isAdmin: boolean): PageLayout {
  const order = pageLayoutSectionCatalog(page, isAdmin).map(({ key }) => key as PageLayoutSectionKey);
  const visible = new Set<string>(order);
  const defaultFullWidth = PAGE_LAYOUT_DEFAULT_FULL_WIDTH[page] as readonly PageLayoutSectionKey[];
  return {
    order,
    hidden: [],
    fullWidth: defaultFullWidth.filter((key) => visible.has(key) && isPageLayoutSectionResizable(page, key)),
  };
}

export function defaultPageLayouts(isAdmin: boolean): PageLayouts {
  return {
    overview: defaultPageLayout("overview", isAdmin),
    reports: defaultPageLayout("reports", isAdmin),
  };
}

function normalizePageLayoutForRead(value: unknown, page: PageLayoutPage, isAdmin: boolean): PageLayout {
  const defaults = defaultPageLayout(page, isAdmin);
  const known = new Set<string>(defaults.order);
  const layout = isRecord(value) ? value : {};
  const rawOrder = Array.isArray(layout.order) ? layout.order : [];
  const rawHidden = Array.isArray(layout.hidden) ? layout.hidden : [];
  // A layout saved before spans existed (or the `{}` column default) carries no
  // fullWidth at all and must keep the curated default. An explicit array is the
  // user's own choice and is honoured verbatim, including an empty one.
  const rawFullWidth = Array.isArray(layout.fullWidth) ? layout.fullWidth : defaults.fullWidth;
  const seenOrder = new Set<string>();
  const seenHidden = new Set<string>();
  const seenFullWidth = new Set<string>();
  const order: PageLayoutSectionKey[] = [];
  const hidden: PageLayoutSectionKey[] = [];
  const fullWidth: PageLayoutSectionKey[] = [];

  for (const key of rawOrder) {
    if (typeof key !== "string" || !known.has(key) || seenOrder.has(key)) continue;
    seenOrder.add(key);
    order.push(key as PageLayoutSectionKey);
  }
  for (const key of defaults.order) {
    if (!seenOrder.has(key)) order.push(key);
  }
  for (const key of rawHidden) {
    if (typeof key !== "string" || !known.has(key) || seenHidden.has(key)) continue;
    seenHidden.add(key);
    hidden.push(key as PageLayoutSectionKey);
  }
  for (const key of rawFullWidth) {
    if (
      typeof key !== "string"
      || !known.has(key)
      || !isPageLayoutSectionResizable(page, key)
      || seenFullWidth.has(key)
    ) continue;
    seenFullWidth.add(key);
    fullWidth.push(key as PageLayoutSectionKey);
  }

  return { order, hidden, fullWidth };
}

/**
 * Tolerant storage reader. Each page widens independently against today's catalog,
 * preserving valid saved order/visibility while dropping stale or inaccessible keys.
 */
export function normalizePageLayoutsForRead(value: unknown, isAdmin: boolean): PageLayouts {
  const record = isRecord(value) ? value : {};
  return {
    overview: normalizePageLayoutForRead(record.overview, "overview", isAdmin),
    reports: normalizePageLayoutForRead(record.reports, "reports", isAdmin),
  };
}

export function parseStoredPageLayouts(value: string | null | undefined, isAdmin: boolean): PageLayouts {
  if (!value) return defaultPageLayouts(isAdmin);
  try {
    return normalizePageLayoutsForRead(JSON.parse(value), isAdmin);
  } catch {
    return defaultPageLayouts(isAdmin);
  }
}

function normalizePageLayoutForWrite(value: unknown, page: PageLayoutPage, isAdmin: boolean): PageLayout | null {
  if (!isRecord(value) || !hasOnlyKeys(value, PAGE_LAYOUT_VALUE_KEYS)) return null;
  if (!Array.isArray(value.order) || !Array.isArray(value.hidden) || !Array.isArray(value.fullWidth)) return null;
  if (
    value.order.some((key) => typeof key !== "string")
    || value.hidden.some((key) => typeof key !== "string")
    || value.fullWidth.some((key) => typeof key !== "string")
  ) return null;

  const defaults = defaultPageLayout(page, isAdmin);
  const known = new Set<string>(defaults.order);
  const orderValues = value.order as string[];
  const hiddenValues = value.hidden as string[];
  const fullWidthValues = value.fullWidth as string[];
  if (
    orderValues.some((key) => !known.has(key))
    || hiddenValues.some((key) => !known.has(key))
    || fullWidthValues.some((key) => !known.has(key) || !isPageLayoutSectionResizable(page, key))
  ) return null;
  if (
    new Set(orderValues).size !== orderValues.length
    || new Set(hiddenValues).size !== hiddenValues.length
    || new Set(fullWidthValues).size !== fullWidthValues.length
  ) return null;

  const order = orderValues as PageLayoutSectionKey[];
  const present = new Set<string>(order);
  return {
    order: [...order, ...defaults.order.filter((key) => !present.has(key))],
    hidden: hiddenValues as PageLayoutSectionKey[],
    fullWidth: fullWidthValues as PageLayoutSectionKey[],
  };
}

/** Strict request validator: unknown catalog or object keys are never ignored on write. */
export function normalizePageLayoutsForWrite(value: unknown, isAdmin: boolean): PageLayouts | null {
  if (!isRecord(value) || !hasOnlyKeys(value, PAGE_LAYOUT_PAGE_KEYS) || PAGE_LAYOUT_PAGES.some((page) => !Object.hasOwn(value, page))) return null;
  const overview = normalizePageLayoutForWrite(value.overview, "overview", isAdmin);
  const reports = normalizePageLayoutForWrite(value.reports, "reports", isAdmin);
  return overview && reports ? { overview, reports } : null;
}

/**
 * Replaces only sections visible to the actor. Future administrator-only entries
 * therefore survive a save made after a user's access changes.
 */
export function mergePageLayoutsForWrite(storedValue: string | null | undefined, submitted: PageLayouts, isAdmin: boolean): PageLayouts {
  const stored = parseStoredPageLayouts(storedValue, true);
  const merged = {} as PageLayouts;
  for (const page of PAGE_LAYOUT_PAGES) {
    const visibleKeys = new Set(pageLayoutSectionCatalog(page, isAdmin).map(({ key }) => key));
    merged[page] = {
      order: [
        ...submitted[page].order,
        ...stored[page].order.filter((key) => !visibleKeys.has(key)),
      ],
      hidden: [
        ...submitted[page].hidden,
        ...stored[page].hidden.filter((key) => !visibleKeys.has(key)),
      ],
      fullWidth: [
        ...submitted[page].fullWidth,
        ...stored[page].fullWidth.filter((key) => !visibleKeys.has(key)),
      ],
    };
  }
  return merged;
}

export function isDefaultPageLayout(layout: PageLayout, page: PageLayoutPage, isAdmin: boolean) {
  const defaults = defaultPageLayout(page, isAdmin);
  const defaultFullWidth = new Set<string>(defaults.fullWidth);
  return layout.hidden.length === 0
    && layout.fullWidth.length === defaultFullWidth.size
    && layout.fullWidth.every((key) => defaultFullWidth.has(key))
    && layout.order.length === defaults.order.length
    && layout.order.every((key, index) => key === defaults.order[index]);
}

/**
 * Resolves the arranged grid in DOM order. A half-width section remains half
 * only when the next section can share its row; every unpaired half is promoted
 * to full so the grid never leaves a visual hole.
 */
export function resolveArrangedSpans<Key extends PageLayoutSectionKey>(
  page: PageLayoutPage,
  keys: readonly Key[],
  fullWidth: readonly PageLayoutSectionKey[],
): Array<{ key: Key; size: PageLayoutSpanSize }> {
  const requestedFullWidth = new Set<PageLayoutSectionKey>(fullWidth);
  const spans = keys.map((key) => ({
    key,
    size: (
      !isPageLayoutSectionResizable(page, key)
      || requestedFullWidth.has(key)
    ) ? "full" : "half",
  } satisfies { key: Key; size: PageLayoutSpanSize }));

  for (let index = 0; index < spans.length; index += 1) {
    if (spans[index].size !== "half") continue;
    if (spans[index + 1]?.size === "half") {
      index += 1;
      continue;
    }
    spans[index] = { ...spans[index], size: "full" };
  }
  return spans;
}
