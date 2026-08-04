import {
  CLIENT_PATCH_KEYS,
  normalizeClientPatch,
  type ClientPatchKey,
  type ValidatedClientPatch,
} from "../domain/client-patch.ts";
import type {
  ClientFieldUpdateIntent,
  ClientRepository,
  ClientRow,
} from "../ports/client-repository.ts";
import { persistedAddress, type PersistedAddress } from "../domain/address-validation.ts";

export const MAX_CLIENT_PATCH_BODY_BYTES = 64_000;

export type UpdateClientDependencies = Readonly<{
  repository: Pick<ClientRepository, "findById" | "update">;
  newId: () => string;
  now: () => number;
}>;

export type ClientConflictValues = Partial<
  Pick<ClientFieldUpdateIntent["values"], ClientPatchKey>
>;

export type UpdateClientResult =
  | { ok: true; value: ClientRow }
  | {
      ok: false;
      kind: "invalid" | "forbidden" | "client-not-found" | "duplicate";
      message: string;
    }
  | {
      ok: false;
      kind: "conflict";
      message: string;
      currentVersion: string;
      currentValues: ClientConflictValues;
    };

const CLIENT_FIELD_LABELS = {
  name: "Name",
  status: "Status",
  industry: "Industry",
  siteAddress: "Site address",
} as const satisfies Record<ClientPatchKey, string>;

function clientValues(row: ClientRow): ClientFieldUpdateIntent["values"] {
  return {
    name: row.name,
    status: row.status,
    industry: row.industry,
    siteAddress: row.siteAddress,
    latitude: row.latitude,
    longitude: row.longitude,
    addressValidationVerdict: row.addressValidationVerdict,
  };
}

function mergeClientPatch(
  current: ClientFieldUpdateIntent["values"],
  patch: ValidatedClientPatch,
): ClientFieldUpdateIntent["values"] {
  return {
    ...current,
    ...Object.fromEntries(
      CLIENT_PATCH_KEYS.flatMap((key) =>
        Object.hasOwn(patch, key) ? [[key, patch[key]]] : []
      ),
    ),
  } as ClientFieldUpdateIntent["values"];
}

function clientConflict(
  row: ClientRow,
  patch: ValidatedClientPatch,
): Extract<UpdateClientResult, { ok: false; kind: "conflict" }> {
  const values = clientValues(row);
  return {
    ok: false,
    kind: "conflict",
    message: "Client changed since it was loaded.",
    currentVersion: row.version,
    currentValues: Object.fromEntries(
      CLIENT_PATCH_KEYS.flatMap((key) =>
        Object.hasOwn(patch, key) ? [[key, values[key]]] : []
      ),
    ) as ClientConflictValues,
  };
}

function displayValue(value: unknown) {
  return value === null || value === "" ? "Not set" : String(value);
}

export async function updateClient(
  clientId: string,
  input: unknown,
  actorId: string,
  dependencies: UpdateClientDependencies,
  trustedAddress?: PersistedAddress,
): Promise<UpdateClientResult> {
  if (!actorId.trim()) {
    return {
      ok: false,
      kind: "forbidden",
      message: "You do not have permission to update clients.",
    };
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(clientId)) {
    return { ok: false, kind: "invalid", message: "Client identifier is invalid." };
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, kind: "invalid", message: "Client update must be valid JSON." };
  }
  const normalized = normalizeClientPatch(input as Record<string, unknown>);
  if (!normalized.ok) {
    return { ok: false, kind: "invalid", message: normalized.message };
  }

  const current = await dependencies.repository.findById(clientId);
  if (!current) {
    return { ok: false, kind: "client-not-found", message: "Client not found." };
  }
  if (normalized.value.version !== current.version) {
    return clientConflict(current, normalized.value);
  }

  const currentValues = clientValues(current);
  const values = mergeClientPatch(currentValues, normalized.value);
  if (Object.hasOwn(normalized.value, "siteAddress")) {
    const address = persistedAddress(normalized.value.siteAddress ?? null, trustedAddress);
    values.siteAddress = address.address;
    values.latitude = address.latitude;
    values.longitude = address.longitude;
    values.addressValidationVerdict = address.verdict;
  }
  const changes = CLIENT_PATCH_KEYS.flatMap((key) => {
    if (!Object.hasOwn(normalized.value, key) || currentValues[key] === values[key]) return [];
    return [
      `${CLIENT_FIELD_LABELS[key]}: ${displayValue(currentValues[key])} → ${displayValue(values[key])}`,
    ];
  });
  const addressEvidenceChanged = Object.hasOwn(normalized.value, "siteAddress")
    && (
      currentValues.latitude !== values.latitude
      || currentValues.longitude !== values.longitude
      || currentValues.addressValidationVerdict !== values.addressValidationVerdict
    );
  if (addressEvidenceChanged && currentValues.siteAddress === values.siteAddress) {
    changes.push(
      `Site address review: ${displayValue(currentValues.addressValidationVerdict)} → ${displayValue(values.addressValidationVerdict)}`,
    );
  }
  if (changes.length === 0) return { ok: true, value: current };

  const updatedAt = dependencies.now();
  const result = await dependencies.repository.update({
    clientId,
    expectedVersion: normalized.value.version,
    values,
    updatedAt,
    updatedBy: actorId,
    activity: {
      id: dependencies.newId(),
      recordId: clientId,
      action: "Client fields updated",
      actor: actorId,
      detail: changes.join("; "),
      createdAt: updatedAt,
    },
  });
  if (result.outcome === "client-not-found") {
    return { ok: false, kind: result.outcome, message: "Client not found." };
  }
  if (result.outcome === "duplicate") {
    return {
      ok: false,
      kind: result.outcome,
      message: "A client with this business name already exists.",
    };
  }
  if (result.outcome === "conflict") {
    const latest = await dependencies.repository.findById(clientId);
    if (!latest) {
      return { ok: false, kind: "client-not-found", message: "Client not found." };
    }
    return clientConflict(latest, normalized.value);
  }
  return { ok: true, value: result.value };
}

export function clientUpdateResponse(row: ClientRow) {
  return {
    id: row.id,
    clientCode: row.clientCode,
    name: row.name,
    status: row.status,
    industry: row.industry,
    siteAddress: row.siteAddress,
    latitude: row.latitude,
    longitude: row.longitude,
    addressValidationVerdict: row.addressValidationVerdict,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}
