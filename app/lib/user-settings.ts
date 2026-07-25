export const USER_NOTIFICATION_PREFERENCE_CATALOG = [
  {
    key: "lead.created",
    label: "New leads",
    description: "Choose whether a future personal notification should flag newly added leads.",
  },
  {
    key: "gmail.filing_review_needed",
    label: "Filing reviews",
    description: "Choose whether a future personal notification should flag Gmail items awaiting review.",
  },
  {
    key: "calendar.schedule_changed",
    label: "Schedule changes",
    description: "Choose whether a future personal notification should flag operational schedule changes.",
  },
  {
    key: "project.warranty_follow_up_due",
    label: "Warranty follow-ups",
    description: "Choose whether a future personal notification should flag due closeout or warranty follow-ups.",
  },
  {
    key: "task.assigned",
    label: "Task assignments",
    description: "Choose whether a future personal notification should flag tasks assigned to you.",
  },
] as const;

export type UserNotificationPreferenceKey = typeof USER_NOTIFICATION_PREFERENCE_CATALOG[number]["key"];
export type UserNotificationPreferences = Record<UserNotificationPreferenceKey, boolean>;

export type UserSettingsPreferences = {
  displayTimezone: string;
  replySignature: string;
  notificationPreferences: UserNotificationPreferences;
};

const USER_NOTIFICATION_PREFERENCE_KEYS = USER_NOTIFICATION_PREFERENCE_CATALOG.map(({ key }) => key);
const USER_NOTIFICATION_PREFERENCE_KEY_SET = new Set<string>(USER_NOTIFICATION_PREFERENCE_KEYS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function defaultUserNotificationPreferences(): UserNotificationPreferences {
  return {
    "lead.created": false,
    "gmail.filing_review_needed": false,
    "calendar.schedule_changed": false,
    "project.warranty_follow_up_due": false,
    "task.assigned": false,
  };
}

export function defaultUserSettingsPreferences(): UserSettingsPreferences {
  return {
    displayTimezone: "America/New_York",
    replySignature: "",
    notificationPreferences: defaultUserNotificationPreferences(),
  };
}

/**
 * Widens stored or server-returned preferences onto the current closed catalog.
 * Missing current keys default off and unknown future/stale keys are ignored, while
 * malformed values for a current key still fail closed.
 */
export function normalizeUserNotificationPreferences(value: unknown): UserNotificationPreferences | null {
  if (!isRecord(value)) return null;
  const preferences = defaultUserNotificationPreferences();
  for (const key of USER_NOTIFICATION_PREFERENCE_KEYS) {
    if (!Object.hasOwn(value, key)) continue;
    if (typeof value[key] !== "boolean") return null;
    preferences[key] = value[key];
  }
  return preferences;
}

/** Writes remain exact even though reads widen legacy catalogs. */
export function parseUserNotificationPreferencesUpdate(value: unknown): UserNotificationPreferences | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (
    keys.length !== USER_NOTIFICATION_PREFERENCE_KEYS.length
    || keys.some((key) => !USER_NOTIFICATION_PREFERENCE_KEY_SET.has(key))
  ) return null;
  return normalizeUserNotificationPreferences(value);
}

export function parseStoredUserNotificationPreferences(value: string | null | undefined): UserNotificationPreferences {
  if (!value) return defaultUserNotificationPreferences();
  try {
    return normalizeUserNotificationPreferences(JSON.parse(value)) ?? defaultUserNotificationPreferences();
  } catch {
    return defaultUserNotificationPreferences();
  }
}
