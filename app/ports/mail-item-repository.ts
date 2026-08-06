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
  | Readonly<{ outcome: "label-catalog-changed" }>
  | Readonly<{ outcome: "client-not-found" }>
  | Readonly<{ outcome: "suggested-project-not-found" }>
  | Readonly<{ outcome: "approved-project-not-found" }>;

export type MailItemStatusPage = Readonly<{
  items: MailItem[];
  totalCount: number;
}>;

export const RETRYABLE_EXHAUSTED_ANALYSIS_ERROR_CODES = Object.freeze([
  "analysis_failed",
  "analysis_deadline_exceeded",
  "analysis_item_failed",
  "analysis_state_read_failed",
] as const);

export type MailItemAnalysisFailureSummary = Readonly<{
  count: number;
  reason: string | null;
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
  getExhaustedAnalysisFailureSummary(
    connectionKey: string,
    currentLabelDefinitionVersion: string,
  ): Promise<MailItemAnalysisFailureSummary>;
  /**
   * Resets only exhausted provider-analysis failures with one guarded statement.
   * The persisted failed-state invariant requires at least one attempt, so adapters
   * store the minimum valid attempt plus a non-current version marker. The sweep's
   * version-aware counter therefore restarts at one after the next failed attempt.
   */
  resetExhaustedAnalysisFailures(
    connectionKey: string,
    currentLabelDefinitionVersion: string,
    updatedAt: number,
  ): Promise<number>;
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
    reviewedBy: string,
    outcome?: MailItemReviewOutcome,
    acceptedIntent?: string,
  ): Promise<boolean>;
  insertIfAbsent(item: MailItem): Promise<MailItemUpsertResult>;
  upsert(item: MailItem): Promise<MailItemUpsertResult>;
  /**
   * Persists one classifier result only while every intent slug from the
   * classifier's catalog snapshot still exists and is active. Adapters must
   * make that predicate atomic with the mail_items write, so an administrator
   * deleting an unused label cannot race an in-flight classification into an
   * uninterpretable historical row.
   */
  saveAnalysisIfLabelsActive(
    item: MailItem,
    intentSlugs: readonly string[],
    mode: "upsert" | "insert-if-absent",
  ): Promise<MailItemUpsertResult>;
}
