import {
  FLOORING_CATEGORIES,
  PROJECT_STATUSES,
  type FlooringCategory,
  type ProjectStatus,
} from "./project-creation.ts";
import { normalizeRecordVersion } from "./record-version.ts";
import {
  normalizeProjectSegment,
  type ProjectSegment,
} from "./project-segment.ts";
import { normalizeAddressText } from "./address-validation.ts";

export const PROJECT_PATCH_KEYS = [
  "name",
  "status",
  "site",
  "clientId",
  "estimatedValue",
  "flooringCategory",
  "squareFeet",
  "contractValue",
  "segment",
] as const;

export const PROJECT_ADMIN_EDIT_KEYS = [
  "status",
  "estimatedValue",
  "contractValue",
] as const satisfies readonly (typeof PROJECT_PATCH_KEYS)[number][];

export type ProjectPatchKey = typeof PROJECT_PATCH_KEYS[number];

export type ValidatedProjectPatch = Partial<{
  name: string;
  status: ProjectStatus;
  site: string | null;
  clientId: string;
  estimatedValue: number | null;
  flooringCategory: FlooringCategory | null;
  squareFeet: number | null;
  contractValue: number | null;
  segment: ProjectSegment | null;
}> & {
  version: string;
};

export type ProjectPatchValidation =
  | { ok: true; value: ValidatedProjectPatch }
  | { ok: false; message: string };

const PROJECT_PATCH_KEY_SET = new Set<string>([...PROJECT_PATCH_KEYS, "version"]);
const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function nullableWholeNumber(
  value: unknown,
  options: { positive?: boolean } = {},
): number | null | undefined {
  if (value === null || value === "") return null;
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || (options.positive ? value <= 0 : value < 0)
  ) {
    return undefined;
  }
  return value;
}

export function normalizeProjectPatch(
  body: Record<string, unknown>,
): ProjectPatchValidation {
  if (
    Object.keys(body).some((key) => !PROJECT_PATCH_KEY_SET.has(key))
    || !PROJECT_PATCH_KEYS.some((key) => Object.hasOwn(body, key))
  ) {
    return { ok: false, message: "Only supported project fields can be updated." };
  }

  const version = normalizeRecordVersion(body.version);
  if (!version) {
    return { ok: false, message: "Project version must be a positive whole number." };
  }
  const patch: ValidatedProjectPatch = { version };

  if (Object.hasOwn(body, "name")) {
    if (typeof body.name !== "string") {
      return { ok: false, message: "Project name must be 180 characters or fewer." };
    }
    const value = body.name.trim();
    if (!value || value.length > 180) {
      return { ok: false, message: "Project name must be 180 characters or fewer." };
    }
    patch.name = value;
  }
  if (Object.hasOwn(body, "status")) {
    const value = typeof body.status === "string"
      ? body.status.trim().toLowerCase()
      : "";
    if (!PROJECT_STATUSES.includes(value as ProjectStatus)) {
      return { ok: false, message: "Project status is invalid." };
    }
    patch.status = value as ProjectStatus;
  }
  if (Object.hasOwn(body, "site")) {
    const site = normalizeAddressText(body.site);
    if (site === undefined) return { ok: false, message: "Project site must be 280 characters or fewer." };
    patch.site = site;
  }
  if (Object.hasOwn(body, "clientId")) {
    const value = typeof body.clientId === "string" ? body.clientId.trim() : "";
    if (!PROJECT_ID_PATTERN.test(value)) {
      return { ok: false, message: "Project client is invalid." };
    }
    patch.clientId = value;
  }
  if (Object.hasOwn(body, "estimatedValue")) {
    const value = nullableWholeNumber(body.estimatedValue);
    if (value === undefined) {
      return {
        ok: false,
        message: "Project estimated value must be a non-negative whole number.",
      };
    }
    patch.estimatedValue = value;
  }
  if (Object.hasOwn(body, "flooringCategory")) {
    const value = typeof body.flooringCategory === "string"
      ? body.flooringCategory.trim().toLowerCase()
      : body.flooringCategory === null || body.flooringCategory === ""
        ? null
        : undefined;
    if (
      value === undefined
      || value !== null && !FLOORING_CATEGORIES.includes(value as FlooringCategory)
    ) {
      return { ok: false, message: "Project flooring category is invalid." };
    }
    patch.flooringCategory = value as FlooringCategory | null;
  }
  if (Object.hasOwn(body, "squareFeet")) {
    const value = nullableWholeNumber(body.squareFeet, { positive: true });
    if (value === undefined) {
      return {
        ok: false,
        message: "Project square feet must be a positive whole number.",
      };
    }
    patch.squareFeet = value;
  }
  if (Object.hasOwn(body, "contractValue")) {
    const value = nullableWholeNumber(body.contractValue);
    if (value === undefined) {
      return {
        ok: false,
        message: "Project contract value must be a non-negative whole number.",
      };
    }
    patch.contractValue = value;
  }
  if (Object.hasOwn(body, "segment")) {
    const value = body.segment === null || body.segment === ""
      ? null
      : normalizeProjectSegment(body.segment);
    if (value === null && body.segment !== null && body.segment !== "") {
      return { ok: false, message: "Project segment is invalid." };
    }
    patch.segment = value;
  }
  return { ok: true, value: patch };
}
