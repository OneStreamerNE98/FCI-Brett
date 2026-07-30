import { normalizeRecordVersion } from "./record-version.ts";
import {
  normalizeContactEmail,
  normalizeContactName,
  normalizeContactPhone,
  normalizeContactRole,
} from "./contact-fields.ts";

export const CONTACT_PATCH_KEYS = ["name", "email", "phone", "role"] as const;

export type ContactPatchKey = typeof CONTACT_PATCH_KEYS[number];

export type ValidatedContactPatch = Partial<{
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
}> & {
  version: string;
};

export type ContactPatchValidation =
  | { ok: true; value: ValidatedContactPatch }
  | { ok: false; message: string };

const CONTACT_PATCH_KEY_SET = new Set<string>([...CONTACT_PATCH_KEYS, "version"]);
export function normalizeContactPatch(
  body: Record<string, unknown>,
): ContactPatchValidation {
  if (
    Object.keys(body).some((key) => !CONTACT_PATCH_KEY_SET.has(key))
    || !CONTACT_PATCH_KEYS.some((key) => Object.hasOwn(body, key))
  ) {
    return { ok: false, message: "Contact update must contain at least one supported field." };
  }

  const version = normalizeRecordVersion(body.version);
  if (!version) {
    return { ok: false, message: "Contact version must be a positive whole number." };
  }
  const patch: ValidatedContactPatch = { version };

  if (Object.hasOwn(body, "name")) {
    const value = normalizeContactName(body.name);
    if (value === undefined) {
      return { ok: false, message: "Contact name must be 180 characters or fewer." };
    }
    patch.name = value;
  }
  if (Object.hasOwn(body, "email")) {
    const value = normalizeContactEmail(body.email);
    if (value === undefined) {
      return { ok: false, message: "Contact email is invalid." };
    }
    patch.email = value;
  }
  if (Object.hasOwn(body, "phone")) {
    const value = normalizeContactPhone(body.phone);
    if (value === undefined) {
      return { ok: false, message: "Contact phone is invalid." };
    }
    patch.phone = value;
  }
  if (Object.hasOwn(body, "role")) {
    const value = normalizeContactRole(body.role);
    if (value === undefined) {
      return { ok: false, message: "Contact role must be 120 characters or fewer." };
    }
    patch.role = value;
  }
  return { ok: true, value: patch };
}
