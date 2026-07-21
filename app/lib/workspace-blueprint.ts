export type WorkspaceBlueprintManagement = "owner" | "system";
export type WorkspaceBlueprintTemplateKind = "doc" | "sheet";
export type WorkspaceBlueprintWeekday = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";

export type WorkspaceBlueprintFolder = Readonly<{
  key: string;
  name: string;
  management: WorkspaceBlueprintManagement;
  children: readonly WorkspaceBlueprintFolder[];
}>;

export type WorkspaceBlueprintSpreadsheet = Readonly<{
  key: string;
  name: string;
  targetFolderKey: string;
  management: WorkspaceBlueprintManagement;
}>;

export type WorkspaceBlueprintTemplate = Readonly<{
  key: string;
  name: string;
  kind: WorkspaceBlueprintTemplateKind;
  targetFolderKey: string;
  management: "owner";
}>;

export type WorkspaceBlueprintGmailLabel = Readonly<{
  key: string;
  name: string;
  management: "system";
}>;

export type WorkspaceBlueprintCalendar = Readonly<{
  key: string;
  name: string;
  management: "system";
  defaultEventMinutes: number;
  workingHours: Readonly<{
    days: readonly WorkspaceBlueprintWeekday[];
    start: string;
    end: string;
  }>;
}>;

export type WorkspaceBlueprint = Readonly<{
  business: Readonly<{ displayName: string }>;
  naming: Readonly<{
    clientFolderPattern: string;
    projectFolderPattern: string;
  }>;
  drive: Readonly<{
    sharedDriveName: string;
    roots: readonly WorkspaceBlueprintFolder[];
    clientFolders: readonly WorkspaceBlueprintFolder[];
    projectFolders: readonly WorkspaceBlueprintFolder[];
  }>;
  spreadsheets: readonly WorkspaceBlueprintSpreadsheet[];
  templates: readonly WorkspaceBlueprintTemplate[];
  gmail: Readonly<{ labels: readonly WorkspaceBlueprintGmailLabel[] }>;
  calendars: readonly WorkspaceBlueprintCalendar[];
}>;

export type WorkspaceBlueprintFolderOption = Readonly<{
  key: string;
  name: string;
  path: string;
  management: WorkspaceBlueprintManagement;
}>;

/**
 * The development provisioning contract that predates the persisted blueprint.
 * Keep this export byte-compatible until SET-21 moves its remaining consumers.
 */
export const DRIVE_BLUEPRINT = {
  sharedDriveName: "FCI Operations",
  roots: [
    "00_Company Admin / Client Directory (Google Sheet)",
    "01_Client Accounts / {CLIENT_CODE} — {CLIENT_NAME} / 00_Client Profile & Master Documents",
    "02_Projects / {YEAR} / {PROJECT_NUMBER} — {PROJECT_NAME}",
    "99_Archive",
    "99_Unsorted Intake",
  ],
  projectFolders: [
    "00_Admin",
    "01_Lead & Proposal",
    "02_Contract & Submittals",
    "03_Schedule & Field",
    "04_Photos & QA",
    "05_Correspondence / Email Archive",
    "05_Correspondence / Email Attachments",
    "06_Closeout",
  ],
  gmailLabels: ["FCI/Intake", "FCI/Needs Review", "FCI/Filed"],
} as const;

export const WORKSPACE_BLUEPRINT_LIMITS = Object.freeze({
  folders: 50,
  templates: 20,
  spreadsheets: 10,
  folderDepth: 2,
});

export const WORKSPACE_BLUEPRINT_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,40}$/;
export const WORKSPACE_BLUEPRINT_NAMING_TOKENS = Object.freeze(["{code}", "{name}", "{number}", "{year}"] as const);
export const WORKSPACE_BLUEPRINT_WEEKDAYS = Object.freeze([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const satisfies readonly WorkspaceBlueprintWeekday[]);

const WEEKDAY_SET = new Set<string>(WORKSPACE_BLUEPRINT_WEEKDAYS);
const WEEKDAYS = Object.freeze(["monday", "tuesday", "wednesday", "thursday", "friday"] as const satisfies readonly WorkspaceBlueprintWeekday[]);
const OBJECT_TAG = Object.prototype.toString;

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

const SEED_WORKSPACE_BLUEPRINT: WorkspaceBlueprint = deepFreeze({
  business: { displayName: "Floor Coverings International — Cherry Hill" },
  naming: {
    clientFolderPattern: "{code} — {name}",
    projectFolderPattern: "{number} — {name}",
  },
  drive: {
    sharedDriveName: DRIVE_BLUEPRINT.sharedDriveName,
    roots: [
      {
        key: "company-admin",
        name: "00_Company Admin",
        management: "owner",
        children: [{ key: "templates", name: "Templates", management: "owner", children: [] }],
      },
      { key: "client-accounts", name: "01_Client Accounts", management: "owner", children: [] },
      { key: "projects", name: "02_Projects", management: "owner", children: [] },
      { key: "archive", name: "99_Archive", management: "owner", children: [] },
      { key: "unsorted-intake", name: "99_Unsorted Intake", management: "system", children: [] },
    ],
    clientFolders: [
      { key: "client-profile", name: "00_Client Profile & Master Documents", management: "owner", children: [] },
      { key: "project-shortcuts", name: "Projects (shortcuts only)", management: "owner", children: [] },
    ],
    projectFolders: [
      { key: "admin", name: "00_Admin", management: "owner", children: [] },
      { key: "lead-proposal", name: "01_Lead & Proposal", management: "owner", children: [] },
      { key: "contract-submittals", name: "02_Contract & Submittals", management: "owner", children: [] },
      { key: "schedule-field", name: "03_Schedule & Field", management: "owner", children: [] },
      { key: "photos-qa", name: "04_Photos & QA", management: "owner", children: [] },
      {
        key: "correspondence",
        name: "05_Correspondence",
        management: "system",
        children: [
          { key: "email-archive", name: "Email Archive", management: "system", children: [] },
          { key: "email-attachments", name: "Email Attachments", management: "system", children: [] },
        ],
      },
      { key: "closeout", name: "06_Closeout", management: "owner", children: [] },
    ],
  },
  spreadsheets: [{
    key: "client-directory",
    name: "FCI Operations Directory",
    targetFolderKey: "company-admin",
    management: "system",
  }],
  templates: [
    { key: "estimate-proposal", name: "Estimate Proposal", kind: "doc", targetFolderKey: "templates", management: "owner" },
    { key: "installation-work-order", name: "Installation Work Order", kind: "doc", targetFolderKey: "templates", management: "owner" },
    { key: "change-order", name: "Change Order", kind: "doc", targetFolderKey: "templates", management: "owner" },
    { key: "pre-install-checklist", name: "Pre-install Checklist", kind: "doc", targetFolderKey: "templates", management: "owner" },
    { key: "project-budget", name: "Project Budget", kind: "sheet", targetFolderKey: "templates", management: "owner" },
  ],
  gmail: {
    labels: [
      { key: "intake", name: DRIVE_BLUEPRINT.gmailLabels[0], management: "system" },
      { key: "needs-review", name: DRIVE_BLUEPRINT.gmailLabels[1], management: "system" },
      { key: "filed", name: DRIVE_BLUEPRINT.gmailLabels[2], management: "system" },
    ],
  },
  calendars: [
    {
      key: "client-appointments",
      name: "FCI • Client Appointments",
      management: "system",
      defaultEventMinutes: 60,
      workingHours: { days: WEEKDAYS, start: "08:00", end: "17:00" },
    },
    {
      key: "field-schedule",
      name: "FCI • Field Schedule",
      management: "system",
      defaultEventMinutes: 480,
      workingHours: { days: WEEKDAYS, start: "07:00", end: "17:00" },
    },
    {
      key: "holidays",
      name: "FCI Holidays",
      management: "system",
      defaultEventMinutes: 1_440,
      workingHours: { days: WEEKDAYS, start: "00:00", end: "23:59" },
    },
  ],
});

export class WorkspaceBlueprintValidationError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "WorkspaceBlueprintValidationError";
    this.path = path;
  }
}

function invalid(path: string, message: string): never {
  throw new WorkspaceBlueprintValidationError(path, message);
}

function object(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || OBJECT_TAG.call(value) !== "[object Object]") {
    return invalid(path, "must be an object.");
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(keys);
  const unknown = Object.keys(record).find((key) => !allowed.has(key));
  if (unknown) invalid(`${path}.${unknown}`, "is not a supported field.");
  return record;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) invalid(path, "must be an array.");
  return value;
}

function text(value: unknown, path: string, maximum = 120): string {
  if (typeof value !== "string") invalid(path, "must be text.");
  const normalized = value.trim();
  if (!normalized) invalid(path, "is required.");
  if (normalized.length > maximum) invalid(path, `must be ${maximum} characters or fewer.`);
  if (/\p{Cc}/u.test(normalized)) invalid(path, "cannot contain control characters.");
  return normalized;
}

function key(value: unknown, path: string): string {
  const normalized = text(value, path, 41);
  if (!WORKSPACE_BLUEPRINT_KEY_PATTERN.test(normalized)) {
    invalid(path, "must use 1–41 lowercase letters, numbers, or hyphens and start with a letter or number.");
  }
  return normalized;
}

function management(value: unknown, path: string): WorkspaceBlueprintManagement {
  if (value !== "owner" && value !== "system") invalid(path, "must be owner or system.");
  return value;
}

function fileName(value: unknown, path: string): string {
  return text(value, path, 120);
}

function folderName(value: unknown, path: string): string {
  const normalized = text(value, path, 120);
  if (normalized.includes("/") || normalized.includes("\\")) invalid(path, "cannot contain a path separator.");
  return normalized;
}

function namingPattern(value: unknown, path: string, allowedTokens: readonly string[], requiredTokens: readonly string[]): string {
  const normalized = text(value, path, 160);
  const tokens = [...normalized.matchAll(/\{[^{}]+\}/gu)].map((match) => match[0]);
  const withoutTokens = normalized.replace(/\{[^{}]+\}/gu, "");
  if (/[{}]/u.test(withoutTokens)) invalid(path, "contains an unmatched naming token brace.");
  const allowed = new Set(allowedTokens);
  const unsupported = tokens.find((token) => !allowed.has(token));
  if (unsupported) invalid(path, `${unsupported} is not an allowed naming token.`);
  const missing = requiredTokens.find((token) => !tokens.includes(token));
  if (missing) invalid(path, `must include ${missing}.`);
  return normalized;
}

function clock(value: unknown, path: string): string {
  const normalized = text(value, path, 5);
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(normalized)) invalid(path, "must use 24-hour HH:MM time.");
  return normalized;
}

function safeInteger(value: unknown, path: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    invalid(path, `must be a whole number from ${minimum} through ${maximum}.`);
  }
  return value as number;
}

function uniqueKey(value: string, path: string, keys: Set<string>) {
  if (keys.has(value)) invalid(path, `duplicates the key ${value}.`);
  keys.add(value);
}

function sanitizeFolder(
  value: unknown,
  path: string,
  depth: number,
  folderKeys: Set<string>,
  counter: { value: number },
): WorkspaceBlueprintFolder {
  if (depth > WORKSPACE_BLUEPRINT_LIMITS.folderDepth) invalid(path, `exceeds the maximum folder depth of ${WORKSPACE_BLUEPRINT_LIMITS.folderDepth}.`);
  const record = object(value, path, ["key", "name", "management", "children"]);
  const folderKey = key(record.key, `${path}.key`);
  uniqueKey(folderKey, `${path}.key`, folderKeys);
  counter.value += 1;
  if (counter.value > WORKSPACE_BLUEPRINT_LIMITS.folders) invalid(path, `exceeds the ${WORKSPACE_BLUEPRINT_LIMITS.folders}-folder limit.`);
  const childValues = record.children === undefined ? [] : array(record.children, `${path}.children`);
  if (depth === WORKSPACE_BLUEPRINT_LIMITS.folderDepth && childValues.length) {
    invalid(`${path}.children`, `would exceed the maximum folder depth of ${WORKSPACE_BLUEPRINT_LIMITS.folderDepth}.`);
  }
  return {
    key: folderKey,
    name: folderName(record.name, `${path}.name`),
    management: management(record.management, `${path}.management`),
    children: childValues.map((child, index) => sanitizeFolder(child, `${path}.children[${index}]`, depth + 1, folderKeys, counter)),
  };
}

function systemFolderDifference(
  expected: WorkspaceBlueprintFolder,
  actual: WorkspaceBlueprintFolder | null,
  path: string,
): string | null {
  if (!actual) return path;
  for (const field of ["key", "name", "management"] as const) {
    if (actual[field] !== expected[field]) return `${path}.${field}`;
  }
  if (actual.children.length !== expected.children.length) return `${path}.children`;
  for (const expectedChild of expected.children) {
    const difference = systemFolderDifference(
      expectedChild,
      actual.children.find((child) => child.key === expectedChild.key) ?? null,
      `${path}.children[${expectedChild.key}]`,
    );
    if (difference) return difference;
  }
  return null;
}

function assertSystemFolder(
  collection: readonly WorkspaceBlueprintFolder[],
  seedCollection: readonly WorkspaceBlueprintFolder[],
  folderKey: string,
  path: string,
) {
  const expected = seedCollection.find((folder) => folder.key === folderKey);
  if (!expected) throw new Error(`Missing seed folder ${folderKey}.`);
  const difference = systemFolderDifference(
    expected,
    collection.find((folder) => folder.key === folderKey) ?? null,
    `${path}[${folderKey}]`,
  );
  if (difference) invalid(difference, "is system-managed and cannot be changed.");
}

function assertNoUnexpectedSystemFolders(folders: readonly WorkspaceBlueprintFolder[], allowed: Set<string>, path: string) {
  for (const folder of folders) {
    if (folder.management === "system" && !allowed.has(folder.key)) {
      invalid(`${path}[${folder.key}].management`, "cannot mark an owner-defined folder as system-managed.");
    }
    assertNoUnexpectedSystemFolders(folder.children, allowed, `${path}[${folder.key}].children`);
  }
}

function sanitizeSpreadsheet(value: unknown, path: string): WorkspaceBlueprintSpreadsheet {
  const record = object(value, path, ["key", "name", "targetFolderKey", "management"]);
  return {
    key: key(record.key, `${path}.key`),
    name: fileName(record.name, `${path}.name`),
    targetFolderKey: key(record.targetFolderKey, `${path}.targetFolderKey`),
    management: management(record.management, `${path}.management`),
  };
}

function sanitizeTemplate(value: unknown, path: string): WorkspaceBlueprintTemplate {
  const record = object(value, path, ["key", "name", "kind", "targetFolderKey", "management"]);
  if (record.kind !== "doc" && record.kind !== "sheet") invalid(`${path}.kind`, "must be doc or sheet.");
  if (record.management !== "owner") invalid(`${path}.management`, "templates must be owner-managed.");
  return {
    key: key(record.key, `${path}.key`),
    name: fileName(record.name, `${path}.name`),
    kind: record.kind,
    targetFolderKey: key(record.targetFolderKey, `${path}.targetFolderKey`),
    management: "owner",
  };
}

function sanitizeGmailLabel(value: unknown, path: string): WorkspaceBlueprintGmailLabel {
  const record = object(value, path, ["key", "name", "management"]);
  if (record.management !== "system") invalid(`${path}.management`, "Gmail filing labels are system-managed.");
  return {
    key: key(record.key, `${path}.key`),
    name: fileName(record.name, `${path}.name`),
    management: "system",
  };
}

function sanitizeCalendar(value: unknown, path: string): WorkspaceBlueprintCalendar {
  const record = object(value, path, ["key", "name", "management", "defaultEventMinutes", "workingHours"]);
  if (record.management !== "system") invalid(`${path}.management`, "calendar keys are system-managed.");
  const hours = object(record.workingHours, `${path}.workingHours`, ["days", "start", "end"]);
  const days = array(hours.days, `${path}.workingHours.days`).map((day, index) => {
    if (typeof day !== "string" || !WEEKDAY_SET.has(day)) invalid(`${path}.workingHours.days[${index}]`, "must be a supported weekday.");
    return day as WorkspaceBlueprintWeekday;
  });
  if (!days.length) invalid(`${path}.workingHours.days`, "must include at least one weekday.");
  const uniqueDays = new Set(days);
  if (uniqueDays.size !== days.length) invalid(`${path}.workingHours.days`, "cannot contain duplicate weekdays.");
  const start = clock(hours.start, `${path}.workingHours.start`);
  const end = clock(hours.end, `${path}.workingHours.end`);
  if (start >= end) invalid(`${path}.workingHours`, "must end after it starts.");
  return {
    key: key(record.key, `${path}.key`),
    name: fileName(record.name, `${path}.name`),
    management: "system",
    defaultEventMinutes: safeInteger(record.defaultEventMinutes, `${path}.defaultEventMinutes`, 5, 1_440),
    workingHours: { days, start, end },
  };
}

function sameRecord(expected: unknown, actual: unknown) {
  return JSON.stringify(expected) === JSON.stringify(actual);
}

/** Returns a detached immutable copy so callers cannot mutate the process seed. */
export function seedWorkspaceBlueprint(): WorkspaceBlueprint {
  return deepFreeze(structuredClone(SEED_WORKSPACE_BLUEPRINT));
}

/**
 * Validates the complete closed blueprint contract and returns a normalized,
 * immutable value safe for persistence and later setup consumers.
 */
export function sanitizeWorkspaceBlueprint(value: unknown): WorkspaceBlueprint {
  const root = object(value, "blueprint", ["business", "naming", "drive", "spreadsheets", "templates", "gmail", "calendars"]);
  const business = object(root.business, "blueprint.business", ["displayName"]);
  const naming = object(root.naming, "blueprint.naming", ["clientFolderPattern", "projectFolderPattern"]);
  const drive = object(root.drive, "blueprint.drive", ["sharedDriveName", "roots", "clientFolders", "projectFolders"]);
  const folderKeys = new Set<string>();
  const folderCounter = { value: 0 };
  const roots = array(drive.roots, "blueprint.drive.roots").map((folder, index) => sanitizeFolder(folder, `blueprint.drive.roots[${index}]`, 1, folderKeys, folderCounter));
  const clientFolders = array(drive.clientFolders, "blueprint.drive.clientFolders").map((folder, index) => sanitizeFolder(folder, `blueprint.drive.clientFolders[${index}]`, 1, folderKeys, folderCounter));
  const projectFolders = array(drive.projectFolders, "blueprint.drive.projectFolders").map((folder, index) => sanitizeFolder(folder, `blueprint.drive.projectFolders[${index}]`, 1, folderKeys, folderCounter));

  const spreadsheetValues = array(root.spreadsheets, "blueprint.spreadsheets");
  if (spreadsheetValues.length > WORKSPACE_BLUEPRINT_LIMITS.spreadsheets) invalid("blueprint.spreadsheets", `cannot contain more than ${WORKSPACE_BLUEPRINT_LIMITS.spreadsheets} entries.`);
  const spreadsheetKeys = new Set<string>();
  const spreadsheets = spreadsheetValues.map((spreadsheet, index) => {
    const sanitized = sanitizeSpreadsheet(spreadsheet, `blueprint.spreadsheets[${index}]`);
    uniqueKey(sanitized.key, `blueprint.spreadsheets[${index}].key`, spreadsheetKeys);
    if (!folderKeys.has(sanitized.targetFolderKey)) invalid(`blueprint.spreadsheets[${index}].targetFolderKey`, `does not reference a folder key: ${sanitized.targetFolderKey}.`);
    return sanitized;
  });

  const templateValues = array(root.templates, "blueprint.templates");
  if (templateValues.length > WORKSPACE_BLUEPRINT_LIMITS.templates) invalid("blueprint.templates", `cannot contain more than ${WORKSPACE_BLUEPRINT_LIMITS.templates} entries.`);
  const templateKeys = new Set<string>();
  const templates = templateValues.map((template, index) => {
    const sanitized = sanitizeTemplate(template, `blueprint.templates[${index}]`);
    uniqueKey(sanitized.key, `blueprint.templates[${index}].key`, templateKeys);
    if (!folderKeys.has(sanitized.targetFolderKey)) invalid(`blueprint.templates[${index}].targetFolderKey`, `does not reference a folder key: ${sanitized.targetFolderKey}.`);
    return sanitized;
  });

  const gmail = object(root.gmail, "blueprint.gmail", ["labels"]);
  const gmailKeys = new Set<string>();
  const labels = array(gmail.labels, "blueprint.gmail.labels").map((label, index) => {
    const sanitized = sanitizeGmailLabel(label, `blueprint.gmail.labels[${index}]`);
    uniqueKey(sanitized.key, `blueprint.gmail.labels[${index}].key`, gmailKeys);
    return sanitized;
  });

  const calendarKeys = new Set<string>();
  const calendars = array(root.calendars, "blueprint.calendars").map((calendar, index) => {
    const sanitized = sanitizeCalendar(calendar, `blueprint.calendars[${index}]`);
    uniqueKey(sanitized.key, `blueprint.calendars[${index}].key`, calendarKeys);
    return sanitized;
  });

  const sanitized: WorkspaceBlueprint = {
    business: { displayName: text(business.displayName, "blueprint.business.displayName", 120) },
    naming: {
      clientFolderPattern: namingPattern(naming.clientFolderPattern, "blueprint.naming.clientFolderPattern", ["{code}", "{name}"], ["{code}", "{name}"]),
      projectFolderPattern: namingPattern(naming.projectFolderPattern, "blueprint.naming.projectFolderPattern", ["{name}", "{number}", "{year}"], ["{number}", "{name}"]),
    },
    drive: {
      sharedDriveName: fileName(drive.sharedDriveName, "blueprint.drive.sharedDriveName"),
      roots,
      clientFolders,
      projectFolders,
    },
    spreadsheets,
    templates,
    gmail: { labels },
    calendars,
  };

  assertSystemFolder(sanitized.drive.roots, SEED_WORKSPACE_BLUEPRINT.drive.roots, "unsorted-intake", "blueprint.drive.roots");
  assertSystemFolder(sanitized.drive.projectFolders, SEED_WORKSPACE_BLUEPRINT.drive.projectFolders, "correspondence", "blueprint.drive.projectFolders");
  const allowedSystemFolders = new Set(["unsorted-intake", "correspondence", "email-archive", "email-attachments"]);
  assertNoUnexpectedSystemFolders(sanitized.drive.roots, allowedSystemFolders, "blueprint.drive.roots");
  assertNoUnexpectedSystemFolders(sanitized.drive.clientFolders, allowedSystemFolders, "blueprint.drive.clientFolders");
  assertNoUnexpectedSystemFolders(sanitized.drive.projectFolders, allowedSystemFolders, "blueprint.drive.projectFolders");

  const seedDirectory = SEED_WORKSPACE_BLUEPRINT.spreadsheets[0];
  const directory = sanitized.spreadsheets.find((spreadsheet) => spreadsheet.key === seedDirectory.key);
  if (!directory || !sameRecord(seedDirectory, directory)) {
    invalid("blueprint.spreadsheets[client-directory]", "is system-managed and cannot be changed.");
  }
  const unexpectedSystemSpreadsheet = sanitized.spreadsheets.find((spreadsheet) => spreadsheet.management === "system" && spreadsheet.key !== "client-directory");
  if (unexpectedSystemSpreadsheet) invalid(`blueprint.spreadsheets[${unexpectedSystemSpreadsheet.key}].management`, "cannot mark an owner-defined spreadsheet as system-managed.");

  for (const seedLabel of SEED_WORKSPACE_BLUEPRINT.gmail.labels) {
    const label = sanitized.gmail.labels.find((candidate) => candidate.key === seedLabel.key);
    if (!label || !sameRecord(seedLabel, label)) invalid(`blueprint.gmail.labels[${seedLabel.key}]`, "is system-managed and cannot be changed.");
  }
  if (sanitized.gmail.labels.length !== SEED_WORKSPACE_BLUEPRINT.gmail.labels.length) invalid("blueprint.gmail.labels", "cannot add or remove system-managed filing labels.");

  for (const seedCalendar of SEED_WORKSPACE_BLUEPRINT.calendars) {
    const calendar = sanitized.calendars.find((candidate) => candidate.key === seedCalendar.key);
    if (!calendar) invalid(`blueprint.calendars[${seedCalendar.key}].key`, "is system-managed and cannot be removed or changed.");
  }
  if (sanitized.calendars.length !== SEED_WORKSPACE_BLUEPRINT.calendars.length) invalid("blueprint.calendars", "cannot add or remove system-managed calendar keys.");

  return deepFreeze(sanitized);
}

export function flattenWorkspaceBlueprintFolders(blueprint: WorkspaceBlueprint): WorkspaceBlueprintFolderOption[] {
  const output: WorkspaceBlueprintFolderOption[] = [];
  const append = (folders: readonly WorkspaceBlueprintFolder[], prefix: string) => {
    for (const folder of folders) {
      const path = prefix ? `${prefix} / ${folder.name}` : folder.name;
      output.push(Object.freeze({ key: folder.key, name: folder.name, path, management: folder.management }));
      append(folder.children, path);
    }
  };
  append(blueprint.drive.roots, "Shared Drive");
  append(blueprint.drive.clientFolders, "Each client");
  append(blueprint.drive.projectFolders, "Each project");
  return output;
}

function keyedSummary<T extends { key: string }>(before: readonly T[], after: readonly T[]) {
  const beforeByKey = new Map(before.map((item) => [item.key, item]));
  const afterByKey = new Map(after.map((item) => [item.key, item]));
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const [itemKey, item] of afterByKey) {
    const previous = beforeByKey.get(itemKey);
    if (!previous) added += 1;
    else if (!sameRecord(previous, item)) changed += 1;
  }
  for (const itemKey of beforeByKey.keys()) if (!afterByKey.has(itemKey)) removed += 1;
  return `+${added}/-${removed}/~${changed}`;
}

function flatFolders(blueprint: WorkspaceBlueprint) {
  return flattenWorkspaceBlueprintFolders(blueprint).map((folder) => ({ key: folder.key, name: folder.name, path: folder.path, management: folder.management }));
}

/** Stable, bounded audit detail for setup.blueprint_updated. */
export function summarizeWorkspaceBlueprintChanges(before: WorkspaceBlueprint, after: WorkspaceBlueprint): string {
  return [
    `folders=${keyedSummary(flatFolders(before), flatFolders(after))}`,
    `templates=${keyedSummary(before.templates, after.templates)}`,
    `spreadsheets=${keyedSummary(before.spreadsheets, after.spreadsheets)}`,
    `calendars=${keyedSummary(before.calendars, after.calendars)}`,
    `business=${sameRecord(before.business, after.business) ? "same" : "changed"}`,
    `naming=${sameRecord(before.naming, after.naming) ? "same" : "changed"}`,
    `drive=${before.drive.sharedDriveName === after.drive.sharedDriveName ? "same" : "changed"}`,
  ].join(";");
}
