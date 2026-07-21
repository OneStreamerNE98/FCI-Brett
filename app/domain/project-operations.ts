export const PROJECT_OPERATION_ACTIONS = ["record-installation-dates", "record-follow-up-result"] as const;
export const CALLBACK_NOTE_MAX_LENGTH = 1_000;
export const FLOORING_OPERATIONS_TIME_ZONE = "America/New_York";

const MAX_DATE_TIMESTAMP = 8_640_000_000_000_000;
const INVALID_NOTE_CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export type ProjectOperationAction = typeof PROJECT_OPERATION_ACTIONS[number];

export type NormalizedInstallationDates = {
  action: "record-installation-dates";
  projectId: string;
  installationStartedAt: number;
  installationCompletedAt: number;
};

export type NormalizedFollowUpResult = {
  action: "record-follow-up-result";
  projectId: string;
  hadCallback: boolean;
  callbackNote: string | null;
};

export type NormalizedProjectOperation = NormalizedInstallationDates | NormalizedFollowUpResult;

export type ProjectOperationValidation =
  | { ok: true; value: NormalizedProjectOperation }
  | { ok: false; message: string };

function normalizeProjectId(value: unknown) {
  if (typeof value !== "string") return null;
  const projectId = value.trim();
  return projectId && projectId.length <= 128 && !/[\s\u0000-\u001f\u007f]/.test(projectId)
    ? projectId
    : null;
}

function isDateTimestamp(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_DATE_TIMESTAMP;
}

function hasOnlyKeys(record: Record<string, unknown>, keys: readonly string[]) {
  const allowed = new Set(keys);
  return Object.keys(record).every((key) => allowed.has(key));
}

export function normalizeProjectOperation(input: unknown): ProjectOperationValidation {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, message: "Project action must be valid JSON." };
  }

  const record = input as Record<string, unknown>;
  if (!(PROJECT_OPERATION_ACTIONS as readonly unknown[]).includes(record.action)) {
    return { ok: false, message: "project action is invalid" };
  }

  const projectId = normalizeProjectId(record.projectId);
  if (!projectId) return { ok: false, message: "projectId is invalid" };

  if (record.action === "record-installation-dates") {
    if (!hasOnlyKeys(record, ["action", "projectId", "installationStartedAt", "installationCompletedAt"])) {
      return { ok: false, message: "Only installation dates can be changed by this action." };
    }
    if (!isDateTimestamp(record.installationStartedAt) || !isDateTimestamp(record.installationCompletedAt)) {
      return { ok: false, message: "installation dates must be valid millisecond timestamps" };
    }
    if (record.installationCompletedAt < record.installationStartedAt) {
      return { ok: false, message: "installation completion must be on or after installation start" };
    }
    return {
      ok: true,
      value: {
        action: record.action,
        projectId,
        installationStartedAt: record.installationStartedAt,
        installationCompletedAt: record.installationCompletedAt,
      },
    };
  }

  if (!hasOnlyKeys(record, ["action", "projectId", "hadCallback", "callbackNote"])) {
    return { ok: false, message: "Only the follow-up result can be changed by this action." };
  }
  if (typeof record.hadCallback !== "boolean") {
    return { ok: false, message: "hadCallback must be true or false" };
  }
  if (record.callbackNote !== undefined && record.callbackNote !== null && typeof record.callbackNote !== "string") {
    return { ok: false, message: "callback note must be text" };
  }
  const callbackNote = typeof record.callbackNote === "string" ? record.callbackNote.trim() : "";
  if (callbackNote.length > CALLBACK_NOTE_MAX_LENGTH || INVALID_NOTE_CONTROL_CHARACTERS.test(callbackNote)) {
    return { ok: false, message: `callback note must be ${CALLBACK_NOTE_MAX_LENGTH} characters or fewer and contain valid text` };
  }
  return {
    ok: true,
    value: {
      action: record.action,
      projectId,
      hadCallback: record.hadCallback,
      callbackNote: callbackNote || null,
    },
  };
}
