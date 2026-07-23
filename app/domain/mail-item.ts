export type MailItem = Readonly<{
  id: string;
  gmailMessageId: string | null;
  gmailThreadId: string | null;
  clientId: string | null;
  suggestedProjectId: string | null;
  approvedProjectId: string | null;
  status: string;
  matchReason: string | null;
  emailDriveFileId: string | null;
  createdAt: number;
  updatedAt: number;
}>;

const POSTGRES_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Keeps D1 relationship IDs admissible by the PostgreSQL UUID columns. */
export function isMailItemRelationshipId(value: unknown): value is string {
  return typeof value === "string" && POSTGRES_UUID_PATTERN.test(value);
}

function nullableText(value: unknown) {
  return typeof value === "string" ? value : null;
}

function requiredText(value: unknown, label: string) {
  if (typeof value !== "string" || !value) throw new Error(`${label} is invalid`);
  return value;
}

function timestamp(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} is invalid`);
  return value;
}

/** Converts either D1 snake-case rows or port-shaped rows to one domain shape. */
export function normalizeStoredMailItem(row: Record<string, unknown>): MailItem {
  return Object.freeze({
    id: requiredText(row.id, "Mail item ID"),
    gmailMessageId: nullableText(row.gmailMessageId ?? row.gmail_message_id),
    gmailThreadId: nullableText(row.gmailThreadId ?? row.gmail_thread_id),
    clientId: nullableText(row.clientId ?? row.client_id),
    suggestedProjectId: nullableText(row.suggestedProjectId ?? row.suggested_project_id),
    approvedProjectId: nullableText(row.approvedProjectId ?? row.approved_project_id),
    status: requiredText(row.status, "Mail item status"),
    matchReason: nullableText(row.matchReason ?? row.match_reason),
    emailDriveFileId: nullableText(row.emailDriveFileId ?? row.email_drive_file_id),
    createdAt: timestamp(row.createdAt ?? row.created_at, "Mail item created_at"),
    updatedAt: timestamp(row.updatedAt ?? row.updated_at, "Mail item updated_at"),
  });
}
