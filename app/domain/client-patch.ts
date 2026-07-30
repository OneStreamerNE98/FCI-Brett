import {
  CLIENT_STATUSES,
  type ClientStatus,
} from "./client-creation.ts";
import { normalizeClientIndustry } from "./client-industry.ts";
import { normalizeClientDisplayName } from "./client-name-key.ts";
import { normalizeRecordVersion } from "./record-version.ts";

export const CLIENT_PATCH_KEYS = ["name", "status", "industry"] as const;

export type ClientPatchKey = typeof CLIENT_PATCH_KEYS[number];

export type ValidatedClientPatch = Partial<{
  name: string;
  status: ClientStatus;
  industry: string | null;
}> & {
  version: string;
};

export type ClientPatchValidation =
  | { ok: true; value: ValidatedClientPatch }
  | { ok: false; message: string };

const CLIENT_PATCH_KEY_SET = new Set<string>([...CLIENT_PATCH_KEYS, "version"]);

export function normalizeClientPatch(
  body: Record<string, unknown>,
): ClientPatchValidation {
  if (
    Object.keys(body).some((key) => !CLIENT_PATCH_KEY_SET.has(key))
    || !CLIENT_PATCH_KEYS.some((key) => Object.hasOwn(body, key))
  ) {
    return { ok: false, message: "Client update must contain at least one supported field." };
  }

  const version = normalizeRecordVersion(body.version);
  if (!version) {
    return { ok: false, message: "Client version must be a positive whole number." };
  }
  const patch: ValidatedClientPatch = { version };

  if (Object.hasOwn(body, "name")) {
    const value = normalizeClientDisplayName(body.name);
    if (!value) {
      return { ok: false, message: "Client name must be 180 characters or fewer." };
    }
    patch.name = value;
  }
  if (Object.hasOwn(body, "status")) {
    const value = typeof body.status === "string"
      ? body.status.trim().toLowerCase()
      : "";
    if (!CLIENT_STATUSES.includes(value as ClientStatus)) {
      return { ok: false, message: "Client status is invalid." };
    }
    patch.status = value as ClientStatus;
  }
  if (Object.hasOwn(body, "industry")) {
    const value = normalizeClientIndustry(body.industry);
    if (value === undefined) {
      return { ok: false, message: "Client industry is invalid." };
    }
    patch.industry = value;
  }
  return { ok: true, value: patch };
}
