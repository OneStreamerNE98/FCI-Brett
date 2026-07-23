import type { MailItem } from "../domain/mail-item";

export type MailItemUpsertResult =
  | Readonly<{ outcome: "saved" }>
  | Readonly<{ outcome: "client-not-found" }>
  | Readonly<{ outcome: "suggested-project-not-found" }>
  | Readonly<{ outcome: "approved-project-not-found" }>;

export interface MailItemRepository {
  findById(id: string): Promise<MailItem | null>;
  listByStatus(status: string, limit?: number): Promise<MailItem[]>;
  upsert(item: MailItem): Promise<MailItemUpsertResult>;
}
