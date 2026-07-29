import type { MailItem, MailItemStatus } from "../domain/mail-item";

export type MailItemUpsertResult =
  | Readonly<{ outcome: "saved" }>
  | Readonly<{ outcome: "existing-preserved" }>
  | Readonly<{ outcome: "terminal-preserved" }>
  | Readonly<{ outcome: "client-not-found" }>
  | Readonly<{ outcome: "suggested-project-not-found" }>
  | Readonly<{ outcome: "approved-project-not-found" }>;

export type MailItemStatusPage = Readonly<{
  items: MailItem[];
  totalCount: number;
}>;

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
  listByStatusPage(
    connectionKey: string,
    status: MailItemStatus,
    limit?: number,
  ): Promise<MailItemStatusPage>;
  listRetryableAnalysisRows(
    connectionKey: string,
    currentLabelDefinitionVersion: string,
    limit?: number,
  ): Promise<MailItem[]>;
  markCoverageComplete(connectionKey: string): Promise<void>;
  dismissNeedsReview(
    id: string,
    connectionKey: string,
    updatedAt: number,
  ): Promise<boolean>;
  insertIfAbsent(item: MailItem): Promise<MailItemUpsertResult>;
  upsert(item: MailItem): Promise<MailItemUpsertResult>;
}
