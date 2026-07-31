import type { MailItem, MailItemStatus } from "../domain/mail-item";

/**
 * The two terminal states a needs-review row may be retired into. Narrower than
 * MailItemStatus on purpose: `skipped-noise` and `failed` are set by the sweep, never
 * by a human retiring a row, so they must not be reachable through this path.
 */
export type MailItemReviewOutcome = "accepted" | "dismissed";

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
  /**
   * Retires a needs-review row. `outcome` records WHY it left the queue: `accepted`
   * when a typed accept produced a record, `dismissed` when a human retired it by
   * hand. Without this distinction an accepted lead is indistinguishable from a
   * manual dismissal, so the AI-11(d) activity view and its per-label accept/dismiss
   * counts would misreport every accept. Defaults to `dismissed` so existing callers
   * keep their behaviour.
   */
  dismissNeedsReview(
    id: string,
    connectionKey: string,
    updatedAt: number,
    outcome?: MailItemReviewOutcome,
  ): Promise<boolean>;
  insertIfAbsent(item: MailItem): Promise<MailItemUpsertResult>;
  upsert(item: MailItem): Promise<MailItemUpsertResult>;
}
