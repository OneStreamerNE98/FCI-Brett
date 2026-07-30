import {
  CONTACT_PATCH_KEYS,
  normalizeContactPatch,
  type ContactPatchKey,
  type ValidatedContactPatch,
} from "../domain/contact-patch.ts";
import type {
  ClientRepository,
  ContactFieldUpdateIntent,
  ContactRow,
} from "../ports/client-repository.ts";

export const MAX_CONTACT_PATCH_BODY_BYTES = 32_000;

export type UpdateContactDependencies = Readonly<{
  repository: Pick<ClientRepository, "findContactById" | "updateContact">;
  newId: () => string;
  now: () => number;
}>;

export type ContactConflictValues = Partial<
  Pick<ContactFieldUpdateIntent["values"], ContactPatchKey>
>;

export type UpdateContactResult =
  | { ok: true; value: ContactRow }
  | {
      ok: false;
      kind: "invalid" | "forbidden" | "contact-not-found";
      message: string;
    }
  | {
      ok: false;
      kind: "conflict";
      message: string;
      currentVersion: string;
      currentValues: ContactConflictValues;
    };

const CONTACT_FIELD_LABELS = {
  name: "Name",
  email: "Email",
  phone: "Phone",
  role: "Role",
} as const satisfies Record<ContactPatchKey, string>;

function contactValues(row: ContactRow): ContactFieldUpdateIntent["values"] {
  return {
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
  };
}

function mergeContactPatch(
  current: ContactFieldUpdateIntent["values"],
  patch: ValidatedContactPatch,
): ContactFieldUpdateIntent["values"] {
  return Object.fromEntries(
    Object.entries(current).map(([key, value]) => [
      key,
      Object.hasOwn(patch, key) ? patch[key as ContactPatchKey] : value,
    ]),
  ) as ContactFieldUpdateIntent["values"];
}

function contactConflict(
  row: ContactRow,
  patch: ValidatedContactPatch,
): Extract<UpdateContactResult, { ok: false; kind: "conflict" }> {
  const values = contactValues(row);
  return {
    ok: false,
    kind: "conflict",
    message: "Contact changed since it was loaded.",
    currentVersion: row.version,
    currentValues: Object.fromEntries(
      CONTACT_PATCH_KEYS.flatMap((key) =>
        Object.hasOwn(patch, key) ? [[key, values[key]]] : []
      ),
    ) as ContactConflictValues,
  };
}

function displayValue(value: unknown) {
  return value === null || value === "" ? "Not set" : String(value);
}

export async function updateContact(
  contactId: string,
  input: unknown,
  actorId: string,
  dependencies: UpdateContactDependencies,
): Promise<UpdateContactResult> {
  if (!actorId.trim()) {
    return {
      ok: false,
      kind: "forbidden",
      message: "You do not have permission to update contacts.",
    };
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(contactId)) {
    return { ok: false, kind: "invalid", message: "Contact identifier is invalid." };
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, kind: "invalid", message: "Contact update must be valid JSON." };
  }
  const normalized = normalizeContactPatch(input as Record<string, unknown>);
  if (!normalized.ok) {
    return { ok: false, kind: "invalid", message: normalized.message };
  }

  const current = await dependencies.repository.findContactById(contactId);
  if (!current) {
    return { ok: false, kind: "contact-not-found", message: "Contact not found." };
  }
  if (normalized.value.version !== current.version) {
    return contactConflict(current, normalized.value);
  }

  const currentValues = contactValues(current);
  const values = mergeContactPatch(currentValues, normalized.value);
  const changes = CONTACT_PATCH_KEYS.flatMap((key) => {
    if (!Object.hasOwn(normalized.value, key) || currentValues[key] === values[key]) return [];
    return [
      `${CONTACT_FIELD_LABELS[key]}: ${displayValue(currentValues[key])} → ${displayValue(values[key])}`,
    ];
  });
  if (changes.length === 0) return { ok: true, value: current };

  const updatedAt = dependencies.now();
  const result = await dependencies.repository.updateContact({
    contactId,
    expectedVersion: normalized.value.version,
    values,
    updatedAt,
    updatedBy: actorId,
    activity: {
      id: dependencies.newId(),
      recordId: current.clientId,
      action: "Contact fields updated",
      actor: actorId,
      detail: changes.join("; "),
      createdAt: updatedAt,
    },
  });
  if (result.outcome === "contact-not-found") {
    return { ok: false, kind: result.outcome, message: "Contact not found." };
  }
  if (result.outcome === "conflict") {
    const latest = await dependencies.repository.findContactById(contactId);
    if (!latest) {
      return { ok: false, kind: "contact-not-found", message: "Contact not found." };
    }
    return contactConflict(latest, normalized.value);
  }
  return { ok: true, value: result.value };
}

export function contactUpdateResponse(row: ContactRow) {
  return {
    id: row.id,
    clientId: row.clientId,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    isPrimary: row.isPrimary,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}
