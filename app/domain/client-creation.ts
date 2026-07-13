export const CLIENT_STATUSES = ["active", "prospect", "inactive", "archived"] as const;

export type ClientStatus = typeof CLIENT_STATUSES[number];

export type NormalizedPrimaryContact = {
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
};

export type NormalizedClientCreation = {
  name: string;
  industry: string | null;
  status: ClientStatus;
  primaryContact: NormalizedPrimaryContact | null;
};

export type ClientCreationValidation =
  | { ok: true; value: NormalizedClientCreation }
  | { ok: false; message: string };

function invalidJsonDetails(): ClientCreationValidation {
  return { ok: false, message: "Client details must be valid JSON." };
}

export function normalizeClientCreation(input: unknown): ClientCreationValidation {
  if (!input || typeof input !== "object" || Array.isArray(input)) return invalidJsonDetails();

  const record = input as Record<string, unknown>;
  for (const field of ["name", "industry", "status"] as const) {
    if (record[field] !== undefined && typeof record[field] !== "string") return invalidJsonDetails();
  }

  let primaryContact: Record<string, unknown> | undefined;
  if (record.primaryContact !== undefined) {
    if (!record.primaryContact || typeof record.primaryContact !== "object" || Array.isArray(record.primaryContact)) return invalidJsonDetails();
    primaryContact = record.primaryContact as Record<string, unknown>;
    for (const field of ["name", "email", "phone", "role"] as const) {
      if (primaryContact[field] !== undefined && typeof primaryContact[field] !== "string") return invalidJsonDetails();
    }
  }

  const name = (record.name as string | undefined)?.trim();
  if (!name) return { ok: false, message: "client name is required" };
  if (name.length > 180) return { ok: false, message: "client name is too long" };

  const status = ((record.status as string | undefined)?.trim().toLowerCase() || "active") as ClientStatus;
  if (!CLIENT_STATUSES.includes(status)) return { ok: false, message: "client status is invalid" };

  const contactName = (primaryContact?.name as string | undefined)?.trim();
  return {
    ok: true,
    value: {
      name,
      industry: (record.industry as string | undefined)?.trim() || null,
      status,
      primaryContact: contactName
        ? {
            name: contactName,
            email: (primaryContact?.email as string | undefined) ?? null,
            phone: (primaryContact?.phone as string | undefined) ?? null,
            role: (primaryContact?.role as string | undefined) ?? "Primary contact",
          }
        : null,
    },
  };
}
