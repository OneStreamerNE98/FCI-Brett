export const USER_PREFERENCE_KEYS = Object.freeze([
  "displayTimezone",
  "replySignature",
  "notificationPreferences",
  "pageLayouts",
] as const);

const USER_PREFERENCE_KEY_SET = new Set<string>(USER_PREFERENCE_KEYS);

export function isUserPreferenceUpdate(value: unknown): value is Record<string, unknown> {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length > 0
    && Object.keys(value).every((key) => USER_PREFERENCE_KEY_SET.has(key));
}

export function normalizeUserDisplayTimezone(value: unknown) {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate || candidate.length > 80 || /[\u0000-\u001f\u007f]/.test(candidate)) return null;
  try {
    return Intl.DateTimeFormat("en-US", { timeZone: candidate }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

export function normalizeUserReplySignature(value: unknown) {
  if (typeof value !== "string" || value.length > 2_000) return null;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return null;
  return value.replace(/\r\n?/g, "\n");
}
