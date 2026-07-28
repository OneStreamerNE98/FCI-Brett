import type { MailItem, MailItemStatus } from "../domain/mail-item";

export type MailItemUpsertResult =
  | Readonly<{ outcome: "saved" }>
  | Readonly<{ outcome: "existing-preserved" }>
  | Readonly<{ outcome: "terminal-preserved" }>
  | Readonly<{ outcome: "client-not-found" }>
  | Readonly<{ outcome: "suggested-project-not-found" }>
  | Readonly<{ outcome: "approved-project-not-found" }>;

export interface MailItemRepository {
  findById(id: string): Promise<MailItem | null>;
  findByGmailMessageId(
    connectionKey: string,
    gmailMessageId: string,
  ): Promise<MailItem | null>;
  listByStatus(
    connectionKey: string,
    status: MailItemStatus,
    limit?: number,
  ): Promise<MailItem[]>;
  listRetryableAnalysisRows(
    connectionKey: string,
    currentLabelDefinitionVersion: string,
    limit?: number,
  ): Promise<MailItem[]>;
  markCoverageComplete(connectionKey: string): Promise<void>;
  insertIfAbsent(item: MailItem): Promise<MailItemUpsertResult>;
  upsert(item: MailItem): Promise<MailItemUpsertResult>;
}
