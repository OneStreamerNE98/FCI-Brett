export const LAUNCH_CHECKLIST_ITEMS = Object.freeze([
  {
    itemId: "test-records-only",
    label: "Only FCI TEST — DO NOT USE records were used",
    description: "Confirms the development copy contains test records only.",
  },
  {
    itemId: "records-survive-reload",
    label: "Clients, projects, and meeting evidence persisted after reload",
    description: "Confirms the core development records remained connected after leaving and returning.",
  },
  {
    itemId: "gmail-review-first",
    label: "Gmail stayed review-first and the reply remained an unsent draft",
    description: "Confirms one exact project was reviewed before copying and no reply was sent.",
  },
  {
    itemId: "assistant-citations-opened",
    label: "Every assistant citation was opened and checked against saved evidence",
    description: "Confirms generated answers were reviewed against their cited records.",
  },
] as const);

export type LaunchChecklistItemId = typeof LAUNCH_CHECKLIST_ITEMS[number]["itemId"];

export type LaunchChecklistAttestation = Readonly<{
  checked: boolean;
  actorEmail: string | null;
  checkedAt: number | null;
}>;

export type LaunchChecklist = Readonly<Record<LaunchChecklistItemId, LaunchChecklistAttestation>>;

const LAUNCH_CHECKLIST_ITEM_IDS = new Set<string>(
  LAUNCH_CHECKLIST_ITEMS.map(({ itemId }) => itemId),
);

const EMPTY_ATTESTATION: LaunchChecklistAttestation = Object.freeze({
  checked: false,
  actorEmail: null,
  checkedAt: null,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeStoredAttestation(value: unknown): LaunchChecklistAttestation {
  if (
    !isRecord(value)
    || value.checked !== true
    || typeof value.actorEmail !== "string"
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value.actorEmail)
    || typeof value.checkedAt !== "number"
    || !Number.isSafeInteger(value.checkedAt)
    || value.checkedAt <= 0
  ) {
    return EMPTY_ATTESTATION;
  }
  return Object.freeze({
    checked: true,
    actorEmail: value.actorEmail.trim().toLowerCase(),
    checkedAt: value.checkedAt,
  });
}

/** Missing catalog entries widen to unchecked; stored future keys are never exposed. */
export function normalizeLaunchChecklist(value: unknown): LaunchChecklist {
  const stored = isRecord(value) ? value : {};
  return Object.freeze(Object.fromEntries(
    LAUNCH_CHECKLIST_ITEMS.map(({ itemId }) => [
      itemId,
      normalizeStoredAttestation(stored[itemId]),
    ]),
  ) as Record<LaunchChecklistItemId, LaunchChecklistAttestation>);
}

export function parseLaunchChecklistUpdate(
  value: unknown,
): Readonly<{ itemId: LaunchChecklistItemId; checked: boolean }> | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (
    keys.length !== 2
    || !keys.includes("itemId")
    || !keys.includes("checked")
    || typeof value.itemId !== "string"
    || !LAUNCH_CHECKLIST_ITEM_IDS.has(value.itemId)
    || typeof value.checked !== "boolean"
  ) {
    return null;
  }
  return Object.freeze({
    itemId: value.itemId as LaunchChecklistItemId,
    checked: value.checked,
  });
}

/**
 * Writes only one attestation while preserving every sibling settings key and
 * every future launch-checklist key that this source version does not know yet.
 */
export function mergeLaunchChecklistIntoSettings(
  settings: Readonly<Record<string, unknown>>,
  update: Readonly<{ itemId: LaunchChecklistItemId; checked: boolean }>,
  actorEmail: string,
  checkedAt: number,
) {
  const storedChecklist = isRecord(settings.launchChecklist)
    ? settings.launchChecklist
    : {};
  const nextChecklist: Record<string, unknown> = { ...storedChecklist };
  if (update.checked) {
    nextChecklist[update.itemId] = Object.freeze({
      checked: true,
      actorEmail: actorEmail.trim().toLowerCase(),
      checkedAt,
    });
  } else {
    delete nextChecklist[update.itemId];
  }
  return Object.freeze({
    ...settings,
    launchChecklist: Object.freeze(nextChecklist),
  });
}
